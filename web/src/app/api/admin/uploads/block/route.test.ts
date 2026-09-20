import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { metaPath, pdfPath, readUploadMeta, sha16, writeUploadMeta } from "@/lib/papers/upload-store";
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
      expect(body).toEqual({ blocked: true, hash16 });

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
});
