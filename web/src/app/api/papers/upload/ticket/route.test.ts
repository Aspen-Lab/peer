import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  uploadOwner: vi.fn<() => Promise<string | null>>(async () => "a".repeat(64)),
  hostedUploadsEnabled: vi.fn(() => true),
  stagedUploadsAvailable: vi.fn(() => true),
  createStagedUpload: vi.fn(async (ownerKey: string) => ({
    bucket: "private-uploads",
    path: `incoming/${ownerKey}/11111111-1111-1111-1111-111111111111.pdf`,
    token: "one-time-token",
  })),
}));

vi.mock("@/lib/papers/upload-access", async (original) => ({
  ...await original<typeof import("@/lib/papers/upload-access")>(),
  uploadOwner: mocks.uploadOwner,
  hostedUploadsEnabled: mocks.hostedUploadsEnabled,
}));

vi.mock("@/lib/papers/upload-store", () => ({
  stagedUploadsAvailable: mocks.stagedUploadsAvailable,
  createStagedUpload: mocks.createStagedUpload,
}));

import { POST } from "./route";

function ask(body: unknown = { size: 1024 }, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) {
  return POST(new Request("http://localhost/api/papers/upload/ticket", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }));
}

describe("POST /api/papers/upload/ticket", () => {
  beforeEach(() => {
    mocks.uploadOwner.mockResolvedValue("a".repeat(64));
    mocks.hostedUploadsEnabled.mockReturnValue(true);
    mocks.stagedUploadsAvailable.mockReturnValue(true);
    mocks.createStagedUpload.mockClear();
  });

  it("tickets a direct upload into this owner's own staging folder when uploads live in the bucket", async () => {
    const res = await ask();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      mode: "direct",
      bucket: "private-uploads",
      path: `incoming/${"a".repeat(64)}/11111111-1111-1111-1111-111111111111.pdf`,
      token: "one-time-token",
    });
    expect(mocks.createStagedUpload).toHaveBeenCalledWith("a".repeat(64));
  });

  it("says to send the file in the form when uploads live on a disk", async () => {
    mocks.stagedUploadsAvailable.mockReturnValue(false);
    const res = await ask();
    expect(await res.json()).toEqual({ mode: "form" });
    expect(mocks.createStagedUpload).not.toHaveBeenCalled();
  });

  it("keeps the upload route's own gates: cross-site, switched off, no owner, too large", async () => {
    expect((await ask({ size: 1 }, {})).status).toBe(403);
    mocks.hostedUploadsEnabled.mockReturnValue(false);
    expect((await ask()).status).toBe(503);
    mocks.hostedUploadsEnabled.mockReturnValue(true);
    mocks.uploadOwner.mockResolvedValue(null);
    expect((await ask()).status).toBe(401);
    mocks.uploadOwner.mockResolvedValue("a".repeat(64));
    expect((await ask({ size: 26 * 1024 * 1024 })).status).toBe(413);
    expect(mocks.createStagedUpload).not.toHaveBeenCalled();
  });

  it("answers a plain failure, never a ticket, when the bucket cannot be reached", async () => {
    mocks.createStagedUpload.mockRejectedValueOnce(new Error("bucket unreachable"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await ask();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/Could not start the upload/);
  });
});
