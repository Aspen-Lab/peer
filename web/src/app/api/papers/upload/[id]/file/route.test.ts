import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  uploadFileExists: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("@/lib/papers/upload-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/papers/upload-store")>();
  return {
    ...actual,
    uploadFileExists: mocks.uploadFileExists,
  };
});

vi.mock("node:fs/promises", () => ({
  readFile: mocks.readFile,
}));

import { GET } from "./route";

function call(id: string) {
  const req = new Request(`http://localhost/api/papers/upload/${id}/file`);
  return GET(req, { params: Promise.resolve({ id }) });
}

describe("GET /api/papers/upload/[id]/file", () => {
  it("rejects an id that isn't a valid hash16 before touching the disk", async () => {
    const res = await call("../../secret");
    expect(res.status).toBe(404);
    expect(mocks.uploadFileExists).not.toHaveBeenCalled();
  });

  it("404s when no file exists for a well-shaped id", async () => {
    mocks.uploadFileExists.mockReturnValueOnce(false);
    const res = await call("0123456789abcdef");
    expect(res.status).toBe(404);
  });

  it("streams the PDF back with the right content type when it exists", async () => {
    mocks.uploadFileExists.mockReturnValueOnce(true);
    const pdfBytes = Buffer.from("%PDF-1.4 fake bytes");
    mocks.readFile.mockResolvedValueOnce(pdfBytes);

    const res = await call("0123456789abcdef");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(pdfBytes)).toBe(true);
  });
});
