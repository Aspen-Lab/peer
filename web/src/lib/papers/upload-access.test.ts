import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import path from "node:path";

const mocks = vi.hoisted(() => ({ read: vi.fn(), user: vi.fn(), getCookie: vi.fn(), setCookie: vi.fn() }));
vi.mock("./upload-store", () => ({ readUploadMeta: mocks.read }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.user } }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.getCookie, set: mocks.setCookie }) }));
import { hostedUploadsEnabled, ownedUpload, sameOriginUploadRequest, uploadOwner } from "./upload-access";

beforeEach(() => {
  vi.resetAllMocks();
  for (const key of ["VERCEL", "VERCEL_ENV", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "PEER_PRIVATE_UPLOAD_DIR", "PEER_UPLOADS_ENABLED"]) vi.stubEnv(key, "");
  vi.stubEnv("NODE_ENV", "development");
});
afterEach(() => vi.unstubAllEnvs());

describe("private upload authorization", () => {
  it("rejects anonymous, foreign, legacy and expired records", async () => {
    const meta = { ownerKey: "alice", expiresAt: "2099-01-01T00:00:00Z" };
    mocks.read.mockResolvedValue(meta);
    expect(await ownedUpload("0".repeat(16), null)).toBeNull();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(await ownedUpload("0".repeat(16), "bob")).toBeNull();
    expect(await ownedUpload("0".repeat(16), "alice")).toEqual(meta);
    mocks.read.mockResolvedValue({ ...meta, ownerKey: undefined });
    expect(await ownedUpload("0".repeat(16), "alice")).toBeNull();
    mocks.read.mockResolvedValue({ ...meta, expiresAt: "2000-01-01T00:00:00Z" });
    expect(await ownedUpload("0".repeat(16), "alice")).toBeNull();
  });
  // 9-12: a record with no `status` field at all is legacy and reads as
  // "ready" (it already had to pass the ownerKey/expiresAt checks above); a
  // record that DOES carry a `status` must be exactly "ready".
  it("requires status to be exactly 'ready', but treats a missing status as legacy-ready", async () => {
    const meta = { ownerKey: "alice", expiresAt: "2099-01-01T00:00:00Z" };
    mocks.read.mockResolvedValue(meta); // no `status` field at all
    expect(await ownedUpload("0".repeat(16), "alice")).toEqual(meta);
    for (const status of ["pending", "deleted", "blocked"] as const) {
      mocks.read.mockResolvedValue({ ...meta, status });
      expect(await ownedUpload("0".repeat(16), "alice")).toBeNull();
    }
    mocks.read.mockResolvedValue({ ...meta, status: "ready" });
    expect(await ownedUpload("0".repeat(16), "alice")).toEqual({ ...meta, status: "ready" });
  });
  it("derives account ownership only from the verified server session", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
    mocks.user.mockResolvedValue({ data: { user: { id: "alice" } } });
    expect(await uploadOwner()).toBe(createHash("sha256").update("account:alice").digest("hex"));
    expect(mocks.getCookie).not.toHaveBeenCalled();
  });
  it("never grants an anonymous production owner even with a local cookie", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mocks.getCookie.mockReturnValue({ value: "12345678-1234-1234-1234-123456789abc" });
    expect(await uploadOwner(true)).toBeNull();
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });
  it("creates a private per-browser local cookie only at upload time", async () => {
    expect(await uploadOwner()).toBeNull();
    const owner = await uploadOwner(true);
    expect(owner).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.setCookie).toHaveBeenCalledWith("peer-private-uploads", expect.any(String), expect.objectContaining({ httpOnly: true, sameSite: "strict" }));
  });
  it("requires explicit production enablement and storage outside the app", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(hostedUploadsEnabled()).toBe(false);
    vi.stubEnv("PEER_UPLOADS_ENABLED", "true");
    vi.stubEnv("PEER_PRIVATE_UPLOAD_DIR", path.join(process.cwd(), "public", "uploads"));
    expect(hostedUploadsEnabled()).toBe(false);
    vi.stubEnv("PEER_PRIVATE_UPLOAD_DIR", path.resolve(process.cwd(), "..", "private-test-volume"));
    expect(hostedUploadsEnabled()).toBe(true);
  });
  it("refuses browser cross-origin mutations", () => {
    expect(sameOriginUploadRequest(new Request("http://localhost/api/papers/upload", { headers: { origin: "https://evil.example" } }))).toBe(false);
    expect(sameOriginUploadRequest(new Request("http://localhost/api/papers/upload", { headers: { origin: "http://localhost" } }))).toBe(true);
  });
  // 9-11 (A9-01): a request with neither header is not something a real
  // browser sends on a state-changing request — it must be refused, not
  // default-trusted. Reproduces the live bug (a bare curl DELETE with no
  // Origin/Sec-Fetch-Site headers previously succeeded).
  it("refuses a request with neither Origin nor Sec-Fetch-Site", () => {
    expect(sameOriginUploadRequest(new Request("http://localhost/api/papers/upload"))).toBe(false);
  });
  it("accepts Sec-Fetch-Site: same-origin alone, with no Origin header", () => {
    expect(sameOriginUploadRequest(new Request("http://localhost/api/papers/upload", { headers: { "sec-fetch-site": "same-origin" } }))).toBe(true);
  });
  it("accepts a matching Origin alone, with no Sec-Fetch-Site header", () => {
    expect(sameOriginUploadRequest(new Request("http://localhost/api/papers/upload", { headers: { origin: "http://localhost" } }))).toBe(true);
  });
  it("refuses an explicit Sec-Fetch-Site: cross-site even with a matching Origin", () => {
    expect(sameOriginUploadRequest(new Request("http://localhost/api/papers/upload", { headers: { origin: "http://localhost", "sec-fetch-site": "cross-site" } }))).toBe(false);
  });
});
