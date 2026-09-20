import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UploadMeta } from "@/lib/papers/upload-store";

const mocks = vi.hoisted(() => ({
  readUploadMeta: vi.fn(),
  deleteUpload: vi.fn(async () => undefined),
  // 9-22 (A9-02): mocked directly rather than via its own internal
  // `listUploadMeta` call — that call is same-module-internal in
  // upload-store.ts, so mocking only the exported `listUploadMeta` binding
  // would not reach it (vi.mock replaces import bindings other modules see,
  // not a function's own in-module calls). Default true (no sibling), the
  // common case; per-test overrides cover the reference-counted branch.
  hasOtherReadyDocumentCopy: vi.fn(async () => false),
}));

vi.mock("@/lib/papers/upload-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/papers/upload-store")>();
  return {
    ...actual,
    readUploadMeta: mocks.readUploadMeta,
    deleteUpload: mocks.deleteUpload,
    hasOtherReadyDocumentCopy: mocks.hasOtherReadyDocumentCopy,
  };
});

import { DELETE, GET } from "./route";

vi.mock("@/lib/papers/upload-access", async (original) => ({
  ...await original<typeof import("@/lib/papers/upload-access")>(), ownedUpload: mocks.readUploadMeta,
}));

function call(id: string) {
  const req = new Request(`http://localhost/api/papers/upload/${id}`);
  return GET(req, { params: Promise.resolve({ id }) });
}

// 9-11: a real browser always sends this on a same-origin fetch; the CSRF
// gate itself is exercised separately, with no headers at all.
function deleteCall(id: string, headers: HeadersInit = { "sec-fetch-site": "same-origin" }) {
  const req = new Request(`http://localhost/api/papers/upload/${id}`, { method: "DELETE", headers });
  return DELETE(req, { params: Promise.resolve({ id }) });
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
      textStatus: "ok",
    };
    mocks.readUploadMeta.mockResolvedValueOnce(meta);

    const res = await call("0123456789abcdef");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("upload:0123456789abcdef");
    expect(body.title).toBe("A Real Paper");
  });
});

describe("DELETE /api/papers/upload/[id]", () => {
  beforeEach(() => {
    mocks.readUploadMeta.mockClear();
    mocks.deleteUpload.mockClear();
    mocks.hasOtherReadyDocumentCopy.mockClear();
    mocks.hasOtherReadyDocumentCopy.mockResolvedValue(false);
  });

  it("9-11: refuses a DELETE with neither Origin nor Sec-Fetch-Site header, before ever reading the record", async () => {
    // The live-confirmed CSRF gap (A9-01): a bare curl DELETE with no
    // fetch-metadata headers previously succeeded and actually deleted the
    // asset. It must now be refused before any disk access.
    const res = await deleteCall("0123456789abcdef", {});
    expect(res.status).toBe(403);
    expect(mocks.readUploadMeta).not.toHaveBeenCalled();
    expect(mocks.deleteUpload).not.toHaveBeenCalled();
  });

  it("deletes when Sec-Fetch-Site: same-origin is present, even with no Origin header", async () => {
    const meta: UploadMeta = {
      hash16: "0123456789abcdef",
      fileName: "paper.pdf",
      title: "A Real Paper",
      uploadedAt: "2026-09-15T00:00:00.000Z",
      textStatus: "ok",
      documentKey: "doc-key",
    };
    mocks.readUploadMeta.mockResolvedValueOnce(meta);

    const res = await deleteCall("0123456789abcdef");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);
    expect(body.documentKey).toBe("doc-key");
    expect(mocks.deleteUpload).toHaveBeenCalledWith(meta);
    // No ownerKey on this fixture — the reference-count check is skipped
    // entirely and evidence is safe to retract by default.
    expect(body.retractEvidence).toBe(true);
    expect(mocks.hasOtherReadyDocumentCopy).not.toHaveBeenCalled();
  });

  // 9-22 (A9-02): reproduces A's own throwaway repro as a real, persisted
  // test at the route level — two live copies sharing one documentKey; only
  // the LAST deletion may say it is safe to retract the shared evidence.
  it("9-22: does not offer to retract evidence while another ready copy of the document is live", async () => {
    const meta: UploadMeta = {
      hash16: "0123456789abcdef",
      fileName: "paper.pdf",
      title: "A Real Paper",
      uploadedAt: "2026-09-15T00:00:00.000Z",
      textStatus: "ok",
      ownerKey: "owner-under-test",
      documentKey: "shared-doi-doc-key",
    };
    mocks.readUploadMeta.mockResolvedValueOnce(meta);
    mocks.hasOtherReadyDocumentCopy.mockResolvedValueOnce(true);

    const res = await deleteCall("0123456789abcdef");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.retractEvidence).toBe(false);
    expect(mocks.hasOtherReadyDocumentCopy).toHaveBeenCalledWith("owner-under-test", "shared-doi-doc-key", "0123456789abcdef");
  });

  it("9-22: offers to retract evidence once no other ready copy of the document remains", async () => {
    const meta: UploadMeta = {
      hash16: "0123456789abcdef",
      fileName: "paper.pdf",
      title: "A Real Paper",
      uploadedAt: "2026-09-15T00:00:00.000Z",
      textStatus: "ok",
      ownerKey: "owner-under-test",
      documentKey: "shared-doi-doc-key",
    };
    mocks.readUploadMeta.mockResolvedValueOnce(meta);
    mocks.hasOtherReadyDocumentCopy.mockResolvedValueOnce(false);

    const res = await deleteCall("0123456789abcdef");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.retractEvidence).toBe(true);
  });
});
