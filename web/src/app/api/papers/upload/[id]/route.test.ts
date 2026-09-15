import { describe, expect, it, vi } from "vitest";
import type { UploadMeta } from "@/lib/papers/upload-store";

const mocks = vi.hoisted(() => ({
  readUploadMeta: vi.fn(),
}));

vi.mock("@/lib/papers/upload-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/papers/upload-store")>();
  return {
    ...actual,
    readUploadMeta: mocks.readUploadMeta,
  };
});

import { GET } from "./route";

function call(id: string) {
  const req = new Request(`http://localhost/api/papers/upload/${id}`);
  return GET(req, { params: Promise.resolve({ id }) });
}

describe("GET /api/papers/upload/[id]", () => {
  it("rejects an id that isn't a valid hash16 before ever reading the disk", async () => {
    const res = await call("../../etc-passwd");
    expect(res.status).toBe(400);
    expect(mocks.readUploadMeta).not.toHaveBeenCalled();
  });

  it("404s when no record exists for a well-shaped id", async () => {
    mocks.readUploadMeta.mockResolvedValueOnce(null);
    const res = await call("0123456789abcdef");
    expect(res.status).toBe(404);
  });

  it("returns the mapped Paper for a real record", async () => {
    const meta: UploadMeta = {
      hash16: "0123456789abcdef",
      fileName: "paper.pdf",
      title: "A Real Paper",
      uploadedAt: "2026-09-15T00:00:00.000Z",
    };
    mocks.readUploadMeta.mockResolvedValueOnce(meta);

    const res = await call("0123456789abcdef");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("upload:0123456789abcdef");
    expect(body.title).toBe("A Real Paper");
  });
});
