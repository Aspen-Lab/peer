import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { hostedUploadsEnabled } from "@/lib/papers/upload-access";
import { GET } from "./route";

// UPLOAD-404 (§1bi.2): the route must mirror `hostedUploadsEnabled()`
// exactly — computed from the SAME real function, under the SAME env
// conditions `upload-access.test.ts` already uses for that function's own
// "requires explicit production enablement and storage outside the app"
// test, rather than restating the rule and risking the two drifting apart.
beforeEach(() => {
  for (const key of ["VERCEL", "VERCEL_ENV", "PEER_PRIVATE_UPLOAD_DIR", "PEER_UPLOADS_ENABLED"]) vi.stubEnv(key, "");
  vi.stubEnv("NODE_ENV", "development");
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/papers/upload-availability", () => {
  it("mirrors hostedUploadsEnabled() under a local-dev-shaped env (true)", async () => {
    expect(hostedUploadsEnabled()).toBe(true);
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ enabled: hostedUploadsEnabled() });
  });

  it("mirrors hostedUploadsEnabled() on production with neither env var set (false)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(hostedUploadsEnabled()).toBe(false);
    const res = await GET();
    await expect(res.json()).resolves.toEqual({ enabled: false });
  });

  it("mirrors hostedUploadsEnabled() on production with only PEER_UPLOADS_ENABLED set — still false (storage dir also required)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PEER_UPLOADS_ENABLED", "true");
    vi.stubEnv("PEER_PRIVATE_UPLOAD_DIR", path.join(process.cwd(), "public", "uploads"));
    expect(hostedUploadsEnabled()).toBe(false);
    const res = await GET();
    await expect(res.json()).resolves.toEqual({ enabled: false });
  });

  it("mirrors hostedUploadsEnabled() on production with both env vars correctly set (true)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PEER_UPLOADS_ENABLED", "true");
    vi.stubEnv("PEER_PRIVATE_UPLOAD_DIR", path.resolve(process.cwd(), "..", "private-test-volume"));
    expect(hostedUploadsEnabled()).toBe(true);
    const res = await GET();
    await expect(res.json()).resolves.toEqual({ enabled: true });
  });
});
