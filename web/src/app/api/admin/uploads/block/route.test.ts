import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { figurePdf } from "@/lib/figures/figure-pdf.test-helper";

// P1-03b (§1f.16): this file writes its fixtures straight into the upload
// directory, which a fresh checkout does not have, so it passed or failed
// depending on whether another test file had created the shared one first.
// It gets its own directory, set before `upload-store` reads it — the same
// shape `lib/papers/full-text.test.ts` uses — and removes it afterwards, so
// it neither depends on nor writes into `.local-data/uploads`.
const uploadDir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "peer-block-route-test-"));
  process.env.PEER_PRIVATE_UPLOAD_DIR = dir;
  return dir;
});

// P12-69: a removal of an upload's kept figure folder that fails on demand, for the one test that needs a
// folder that will not go. Only a path under `figure-cuts` is touched; every other removal is the real one.
const fault = vi.hoisted(() => ({ rm: false }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rm: (...args: Parameters<typeof actual.rm>) =>
      fault.rm && String(args[0]).includes("figure-cuts") ? Promise.reject(new Error("rm failed")) : actual.rm(...args),
  };
});

afterAll(async () => {
  delete process.env.PEER_PRIVATE_UPLOAD_DIR;
  await rm(uploadDir, { recursive: true, force: true });
});
import {
  docPath,
  metaPath,
  pdfPath,
  readUploadDoc,
  readUploadFigureCut,
  readUploadMeta,
  readUploadPageFile,
  sha16,
  uploadDocKey,
  writeUploadDoc,
  writeUploadFigureCut,
  writeUploadMeta,
  writeUploadPageFile,
} from "@/lib/papers/upload-store";
import { ownedUpload } from "@/lib/papers/upload-access";

import { POST } from "./route";

function call(body: unknown, headers: HeadersInit = {}): Promise<Response> {
  const req = new Request("http://localhost/api/admin/uploads/block", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return POST(req);
}

describe("POST /api/admin/uploads/block", () => {
  const originalToken = process.env.ADMIN_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = originalToken;
  });

  // 9-19 (A9-06): the route must not even reveal it exists when the
  // operator has not configured it — matches the purge-uploads route's own
  // pattern.
  it("404s when ADMIN_TOKEN is unset, before ever checking the body or a token", async () => {
    delete process.env.ADMIN_TOKEN;
    const res = await call({ hash16: "0".repeat(16) }, { authorization: "Bearer anything-at-all" });
    expect(res.status).toBe(404);
  });

  it("401s on a wrong token, even a correctly-shaped bearer header", async () => {
    process.env.ADMIN_TOKEN = "correct-token";
    const res = await call({ hash16: "0".repeat(16) }, { authorization: "Bearer wrong-token" });
    expect(res.status).toBe(401);
  });

  it("401s with no Authorization header at all", async () => {
    process.env.ADMIN_TOKEN = "correct-token";
    const res = await call({ hash16: "0".repeat(16) });
    expect(res.status).toBe(401);
  });

  it("400s on a malformed hash16", async () => {
    process.env.ADMIN_TOKEN = "correct-token";
    const res = await call({ hash16: "not-a-valid-hash" }, { authorization: "Bearer correct-token" });
    expect(res.status).toBe(400);
  });

  it("404s when no upload exists for a well-shaped hash16", async () => {
    process.env.ADMIN_TOKEN = "correct-token";
    const res = await call(
      { hash16: sha16(Buffer.from("9-19: never uploaded")) },
      { authorization: "Bearer correct-token" },
    );
    expect(res.status).toBe(404);
  });

  it("blocks a real upload: unlinks the PDF, keeps a minimal meta, and the asset then fails ownedUpload for its own owner", async () => {
    process.env.ADMIN_TOKEN = "correct-token";
    const hash16 = sha16(Buffer.from("9-19: block fixture"));
    const ownerKey = "owner-under-test";
    await writeFile(pdfPath(hash16), Buffer.from("%PDF-1.4 fixture"), { mode: 0o600 });
    await writeUploadMeta(hash16, {
      hash16,
      fileName: "paper.pdf",
      title: "A Real Paper",
      uploadedAt: "2026-09-15T00:00:00.000Z",
      textStatus: "ok",
      status: "ready",
      revision: 1,
      ownerKey,
      documentKey: "doc-key-under-test",
      preferenceSignals: [{ key: "text:x", label: "x", source: "uploaded_article" }],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    try {
      const res = await call({ hash16 }, { authorization: "Bearer correct-token" });
      expect(res.status).toBe(200);
      const body = await res.json();
      // 9-22 (A9-02): no sibling shares this documentKey, so the response
      // says it is safe to retract the shared ledger evidence too.
      expect(body).toEqual({ blocked: true, hash16, retractEvidence: true, documentKey: "doc-key-under-test" });

      expect(existsSync(pdfPath(hash16))).toBe(false);

      const stored = await readUploadMeta(hash16);
      expect(stored?.status).toBe("blocked");
      expect(stored?.ownerKey).toBe(ownerKey);
      expect(stored?.documentKey).toBe("doc-key-under-test");
      expect(stored?.blockedAt).toEqual(expect.any(String));
      expect(stored?.preferenceSignals).toEqual([]);
      // Minimal, not merely hidden: title/fileName are actually dropped.
      expect(stored?.title).toBe("");
      expect(stored?.fileName).toBe("");

      // The real authorization gate a private route calls, not a mock of
      // it: a blocked asset must fail exactly like a deleted or expired one.
      expect(await ownedUpload(hash16, ownerKey)).toBeNull();
    } finally {
      await rm(pdfPath(hash16), { force: true });
      await rm(metaPath(hash16), { force: true });
    }
  });

  // 9-22 (A9-02): reproduces A's own throwaway repro as a real, persisted
  // test — two live, `ready` assets sharing one documentKey (the same-DOI-
  // merge case). Blocking one must NOT claim it is safe to retract the
  // document's shared evidence while the other copy is still live.
  it("does not offer to retract evidence when another ready copy of the same document is still live", async () => {
    process.env.ADMIN_TOKEN = "correct-token";
    const ownerKey = "owner-under-test-9-22";
    const documentKey = "shared-doi-doc-key";
    const blockedHash = sha16(Buffer.from("9-22: block target"));
    const survivingHash = sha16(Buffer.from("9-22: surviving sibling"));
    await writeFile(pdfPath(blockedHash), Buffer.from("%PDF-1.4 fixture a"), { mode: 0o600 });
    await writeFile(pdfPath(survivingHash), Buffer.from("%PDF-1.4 fixture b"), { mode: 0o600 });
    const base = {
      fileName: "paper.pdf", title: "A Real Paper", uploadedAt: "2026-09-15T00:00:00.000Z",
      textStatus: "ok" as const, status: "ready" as const, revision: 1, ownerKey, documentKey,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
    await writeUploadMeta(blockedHash, { ...base, hash16: blockedHash });
    await writeUploadMeta(survivingHash, { ...base, hash16: survivingHash });

    try {
      const res = await call({ hash16: blockedHash }, { authorization: "Bearer correct-token" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.retractEvidence).toBe(false);
      // The sibling is untouched — still ready, still on disk.
      expect((await readUploadMeta(survivingHash))?.status).toBe("ready");
      expect(existsSync(pdfPath(survivingHash))).toBe(true);
    } finally {
      await rm(pdfPath(blockedHash), { force: true });
      await rm(metaPath(blockedHash), { force: true });
      await rm(pdfPath(survivingHash), { force: true });
      await rm(metaPath(survivingHash), { force: true });
    }
  });

  // P0-02 (spec D0, manager ruling §1d.2): the text Peer read out of the
  // upload is kept in a sidecar beside it. A takedown removes that too —
  // the PDF is no longer the only per-upload file on disk.
  it("removes the extracted-text sidecar along with the PDF", async () => {
    process.env.ADMIN_TOKEN = "correct-token";
    const hash16 = sha16(Buffer.from("p0-02: block removes the sidecar"));
    const ownerKey = "owner-under-test-p0-02";
    await writeFile(pdfPath(hash16), Buffer.from("%PDF-1.4 fixture"), { mode: 0o600 });
    await writeUploadMeta(hash16, {
      hash16, fileName: "paper.pdf", title: "A Real Paper", uploadedAt: "2026-09-15T00:00:00.000Z",
      textStatus: "ok", status: "ready", revision: 1, ownerKey, documentKey: "doc-key-p0-02",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const key = uploadDocKey(ownerKey, hash16, 1, 2);
    await writeUploadDoc(hash16, key, {
      title: "A Real Paper",
      sections: [{ id: "s0", heading: "1 Introduction", canonical: "introduction", text: "Fixture prose.", page: 1 }],
      figureCaptions: [],
      source: "pdf",
    });

    try {
      const res = await call({ hash16 }, { authorization: "Bearer correct-token" });
      expect(res.status).toBe(200);
      expect(existsSync(pdfPath(hash16))).toBe(false);
      expect(existsSync(docPath(hash16))).toBe(false);
      expect(await readUploadDoc(hash16, key)).toBeNull();
    } finally {
      await rm(pdfPath(hash16), { force: true });
      await rm(metaPath(hash16), { force: true });
      await rm(docPath(hash16), { force: true });
    }
  });

  it("is idempotent — unlinking an already-removed PDF does not throw", async () => {
    process.env.ADMIN_TOKEN = "correct-token";
    const hash16 = sha16(Buffer.from("9-19: already blocked fixture"));
    await writeUploadMeta(hash16, {
      hash16,
      fileName: "",
      title: "",
      uploadedAt: "2026-09-15T00:00:00.000Z",
      textStatus: "empty",
      status: "blocked",
      blockedAt: "2026-09-16T00:00:00.000Z",
      ownerKey: "owner-under-test",
      documentKey: "doc-key-under-test",
      preferenceSignals: [],
    });
    // No PDF on disk at all — a re-block (or a block after the file was
    // already removed some other way) must not 500.
    try {
      const res = await call({ hash16 }, { authorization: "Bearer correct-token" });
      expect(res.status).toBe(200);
    } finally {
      await rm(metaPath(hash16), { force: true });
    }
  });

  // P12-69 (§1h.441; C P12-61's note 1): P12-61 keeps the pictures cut from an upload, and the page files
  // they were cut from, in a folder beside it. They are derived from the PDF being taken down, so the
  // takedown removes them at once, as `deleteUpload` does, and not on the purge's next pass.
  describe("the pictures cut from the upload and its page files (P12-69)", () => {
    const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    /** A PNG-shaped byte string: the signature, then `fill` repeated. Never a real picture. */
    const fakePng = (fill: number) => Buffer.from([...SIGNATURE, ...new Array<number>(64).fill(fill)]);
    /** A whole (tiny, invented) PDF of one page. */
    const pagePdf = (marker: string) => figurePdf([{ text: [[marker, 72, 100, 10]] }]);
    const folder = (hash16: string) => path.join(uploadDir, "figure-cuts", hash16);

    async function keepUpload(hash16: string, ownerKey: string, documentKey: string): Promise<void> {
      await writeFile(pdfPath(hash16), Buffer.from("%PDF-1.4 fixture"), { mode: 0o600 });
      await writeUploadMeta(hash16, {
        hash16, fileName: "paper.pdf", title: "A Real Paper", uploadedAt: "2026-10-28T00:00:00.000Z",
        textStatus: "ok", status: "ready", revision: 1, ownerKey, documentKey,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
    }

    async function keepCuts(hash16: string, fill: number): Promise<void> {
      await writeUploadFigureCut(hash16, 1, "Figure 1", { png: fakePng(fill), width: 400, height: 300 });
      await writeUploadFigureCut(hash16, 2, "Figure 3", { png: fakePng(fill + 1) });
      await writeUploadPageFile(hash16, 1, pagePdf(`page one ${fill}`));
      await writeUploadPageFile(hash16, 2, pagePdf(`page two ${fill}`));
    }

    async function forget(...hashes: string[]): Promise<void> {
      fault.rm = false;
      for (const hash16 of hashes) {
        await rm(pdfPath(hash16), { force: true });
        await rm(metaPath(hash16), { force: true });
        await rm(folder(hash16), { recursive: true, force: true });
      }
    }

    it("removes the kept figure pictures and the page files with the PDF at once, and another upload's stay", async () => {
      process.env.ADMIN_TOKEN = "correct-token";
      const hash16 = sha16(Buffer.from("p12-69: block removes the cuts"));
      const other = sha16(Buffer.from("p12-69: another upload keeps its cuts"));
      await keepUpload(hash16, "owner-under-test-p12-69", "doc-key-p12-69");
      await keepUpload(other, "owner-under-test-p12-69-other", "doc-key-p12-69-other");
      await keepCuts(hash16, 10);
      await keepCuts(other, 20);
      // Before: the pictures and the page files are there to be removed.
      expect((await readUploadFigureCut(hash16, 1, "Figure 1"))?.png.byteLength).toBeGreaterThan(0);
      expect(await readUploadPageFile(hash16, 2)).not.toBeNull();
      expect(existsSync(folder(hash16))).toBe(true);

      try {
        const res = await call({ hash16 }, { authorization: "Bearer correct-token" });
        expect(res.status).toBe(200);
        expect((await res.json()).blocked).toBe(true);

        // After: no picture, no page file, no folder.
        expect(await readUploadFigureCut(hash16, 1, "Figure 1")).toBeNull();
        expect(await readUploadFigureCut(hash16, 2, "Figure 3")).toBeNull();
        expect(await readUploadPageFile(hash16, 1)).toBeNull();
        expect(await readUploadPageFile(hash16, 2)).toBeNull();
        expect(existsSync(folder(hash16))).toBe(false);
        expect(existsSync(pdfPath(hash16))).toBe(false);
        expect((await readUploadMeta(hash16))?.status).toBe("blocked");

        // Another upload's pictures and page files are not touched.
        expect((await readUploadFigureCut(other, 1, "Figure 1"))?.png[8]).toBe(20);
        expect((await readUploadFigureCut(other, 2, "Figure 3"))?.png[8]).toBe(21);
        expect(await readUploadPageFile(other, 1)).not.toBeNull();
        expect(await readUploadPageFile(other, 2)).not.toBeNull();
        expect((await readUploadMeta(other))?.status).toBe("ready");
      } finally {
        await forget(hash16, other);
      }
    });

    it("blocks an upload that has no kept pictures or page files, as before", async () => {
      process.env.ADMIN_TOKEN = "correct-token";
      const hash16 = sha16(Buffer.from("p12-69: nothing kept beside the upload"));
      await keepUpload(hash16, "owner-under-test-p12-69-none", "doc-key-p12-69-none");
      expect(existsSync(folder(hash16))).toBe(false);
      try {
        const res = await call({ hash16 }, { authorization: "Bearer correct-token" });
        expect(res.status).toBe(200);
        expect((await readUploadMeta(hash16))?.status).toBe("blocked");
        expect(existsSync(pdfPath(hash16))).toBe(false);
      } finally {
        await forget(hash16);
      }
    });

    it("logs a failure to remove them and still blocks: the PDF is gone, the record is the minimal blocked one", async () => {
      process.env.ADMIN_TOKEN = "correct-token";
      const hash16 = sha16(Buffer.from("p12-69: the folder will not go"));
      await keepUpload(hash16, "owner-under-test-p12-69-fail", "doc-key-p12-69-fail");
      await keepCuts(hash16, 30);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      fault.rm = true;
      try {
        const res = await call({ hash16 }, { authorization: "Bearer correct-token" });
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ blocked: true, hash16 });
        // The removal failed, so the folder is still there ...
        expect(existsSync(folder(hash16))).toBe(true);
        // ... it was said, and the block was not undone.
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain("figure cuts");
        expect(existsSync(pdfPath(hash16))).toBe(false);
        const stored = await readUploadMeta(hash16);
        expect(stored?.status).toBe("blocked");
        expect(stored?.title).toBe("");
        expect(stored?.preferenceSignals).toEqual([]);
      } finally {
        warn.mockRestore();
        await forget(hash16);
      }
    });
  });
});
