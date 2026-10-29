// P12-61 (§1h.434) — the picture cut from an upload's figure is kept beside the
// upload, owner-private, so a later look at the same figure opens no PDF. The
// real store runs on a temp directory (the disk backend); the bucket backend
// has its own file (`upload-store.figure-cuts.bucket.test.ts`). Every byte here
// is invented: a PNG signature and filler, never a real picture, never a real PDF.

import { existsSync } from "node:fs";
import { readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const uploadDir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "peer-figure-cuts-store-test-"));
  process.env.PEER_PRIVATE_UPLOAD_DIR = dir;
  return dir;
});

// The revision is a getter, so a test can bump it the way a code change does.
const revision = vi.hoisted(() => ({ value: "4" }));
vi.mock("@/lib/figures/figure-revision", () => ({
  get FIGURE_EXTRACTION_REVISION() {
    return revision.value;
  },
}));

import { readUploadFigureCut, removeUploadFigureCuts, sha16, writeUploadFigureCut } from "./upload-store";

afterAll(async () => {
  await rm(uploadDir, { recursive: true, force: true });
});

const ONE = sha16(Buffer.from("p12-61: first invented upload"));
const TWO = sha16(Buffer.from("p12-61: second invented upload"));
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A PNG-shaped byte string: the signature, then `fill` repeated. Never a real image. */
function fakePng(fill: number, length = 64): Buffer {
  return Buffer.from([...SIGNATURE, ...new Array<number>(length).fill(fill)]);
}

const folder = (hash16: string) => path.join(uploadDir, "figure-cuts", hash16);
const objects = async (hash16: string) => (await readdir(folder(hash16)).catch(() => [])).sort();

beforeEach(async () => {
  revision.value = "4";
  await rm(uploadDir, { recursive: true, force: true });
});

describe("a kept figure cut (P12-61)", () => {
  it("is read back whole: the same bytes and the size the engine drew, owner-only on the disk, with no temp file left", async () => {
    const png = fakePng(7, 300);
    expect(await readUploadFigureCut(ONE, 2, "Figure 3")).toBeNull();

    await writeUploadFigureCut(ONE, 2, "Figure 3", { png, width: 1092, height: 448 });

    const kept = await readUploadFigureCut(ONE, 2, "Figure 3");
    expect(kept).not.toBeNull();
    expect(Buffer.compare(kept!.png, png)).toBe(0);
    expect(kept!.png.byteLength).toBe(png.byteLength);
    expect(kept).toMatchObject({ width: 1092, height: 448 });

    const names = await objects(ONE);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^p2-[0-9a-f]{16}-r4\.cut$/);
    // The label itself is never a file name; the digest of it is.
    expect(names[0]).not.toContain("Figure");
    if (process.platform !== "win32") {
      expect((await stat(path.join(folder(ONE), names[0]))).mode & 0o777).toBe(0o600);
      expect((await stat(folder(ONE))).mode & 0o777).toBe(0o700);
    }
  });

  it("keeps no size it was not told, and ignores a size that is not a positive number", async () => {
    await writeUploadFigureCut(ONE, 1, "Figure 1", { png: fakePng(1) });
    await writeUploadFigureCut(ONE, 1, "Figure 2", { png: fakePng(2), width: Number.NaN, height: -4 });
    expect(await readUploadFigureCut(ONE, 1, "Figure 1")).toMatchObject({ width: undefined, height: undefined });
    expect(await readUploadFigureCut(ONE, 1, "Figure 2")).toMatchObject({ width: undefined, height: undefined });
  });

  it("is keyed by the upload, the page and the label: another of each misses", async () => {
    await writeUploadFigureCut(ONE, 2, "Figure 3", { png: fakePng(1) });
    await writeUploadFigureCut(ONE, 2, "Figure 4", { png: fakePng(2) });

    expect((await readUploadFigureCut(ONE, 2, "Figure 3"))?.png[8]).toBe(1);
    expect((await readUploadFigureCut(ONE, 2, "Figure 4"))?.png[8]).toBe(2);
    expect(await readUploadFigureCut(ONE, 3, "Figure 3")).toBeNull();
    expect(await readUploadFigureCut(ONE, 2, "Figure 5")).toBeNull();
    expect(await readUploadFigureCut(ONE, 2, "figure 3")).toBeNull();
    expect(await readUploadFigureCut(TWO, 2, "Figure 3")).toBeNull();
  });

  it("is keyed by FIGURE_EXTRACTION_REVISION: a bumped revision never reads an older cut, and the older one is still there if the revision returns", async () => {
    await writeUploadFigureCut(ONE, 2, "Figure 3", { png: fakePng(4) });

    revision.value = "5";
    expect(await readUploadFigureCut(ONE, 2, "Figure 3")).toBeNull();
    await writeUploadFigureCut(ONE, 2, "Figure 3", { png: fakePng(5) });
    expect((await readUploadFigureCut(ONE, 2, "Figure 3"))?.png[8]).toBe(5);
    expect(await objects(ONE)).toHaveLength(2);

    revision.value = "4";
    expect((await readUploadFigureCut(ONE, 2, "Figure 3"))?.png[8]).toBe(4);
  });

  it("replaces the cut of the same key whole", async () => {
    await writeUploadFigureCut(ONE, 2, "Figure 3", { png: fakePng(1, 500), width: 10, height: 10 });
    await writeUploadFigureCut(ONE, 2, "Figure 3", { png: fakePng(2, 20), width: 20, height: 5 });
    const kept = await readUploadFigureCut(ONE, 2, "Figure 3");
    expect(kept?.png.byteLength).toBe(28);
    expect(kept).toMatchObject({ width: 20, height: 5 });
    expect(await objects(ONE)).toHaveLength(1);
  });

  const notPictures: [string, () => Uint8Array][] = [
    ["an empty picture", () => new Uint8Array(0)],
    ["bytes that are not a PNG", () => Buffer.from("<html>not a picture</html>")],
    ["a signature and nothing after it", () => Buffer.from(SIGNATURE)],
  ];
  it.each(notPictures)("refuses %s, and keeps nothing", async (_name, make) => {
    await expect(writeUploadFigureCut(ONE, 2, "Figure 3", { png: make() })).rejects.toThrow();
    expect(await objects(ONE)).toEqual([]);
    expect(await readUploadFigureCut(ONE, 2, "Figure 3")).toBeNull();
  });

  it.each([
    ["page 0", 0, "Figure 3"],
    ["a fractional page", 1.5, "Figure 3"],
    ["a negative page", -2, "Figure 3"],
    ["an empty label", 2, ""],
    ["a blank label", 2, "   "],
  ])("refuses to key a cut by %s", async (_name, page, label) => {
    await expect(writeUploadFigureCut(ONE, page, label, { png: fakePng(1) })).rejects.toThrow();
    expect(await readUploadFigureCut(ONE, page, label)).toBeNull();
    expect(await objects(ONE)).toEqual([]);
  });

  it("refuses a hash that is not an upload hash, so no name can leave the upload directory", async () => {
    await expect(writeUploadFigureCut("../../etc", 2, "Figure 3", { png: fakePng(1) })).rejects.toThrow();
    expect(await readUploadFigureCut("../../etc", 2, "Figure 3")).toBeNull();
    await expect(removeUploadFigureCuts("../../etc")).rejects.toThrow();
  });

  const tampered: [string, (png: Buffer) => Buffer][] = [
    ["a header that does not match the picture's length", (png: Buffer) => Buffer.concat([Buffer.from(`${JSON.stringify({ v: 1, bytes: png.byteLength + 1 })}\n`), png])],
    ["an object cut short", (png: Buffer) => Buffer.concat([Buffer.from(`${JSON.stringify({ v: 1, bytes: png.byteLength })}\n`), png.subarray(0, png.byteLength - 9)])],
    ["a header of another version", (png: Buffer) => Buffer.concat([Buffer.from(`${JSON.stringify({ v: 2, bytes: png.byteLength })}\n`), png])],
    ["a body that is not a PNG", () => Buffer.concat([Buffer.from(`${JSON.stringify({ v: 1, bytes: 11 })}\n`), Buffer.from("hello world")])],
    ["a header that is not JSON", (png: Buffer) => Buffer.concat([Buffer.from("not json\n"), png])],
    ["no header at all", (png: Buffer) => png],
    ["an empty object", () => Buffer.alloc(0)],
  ];
  it.each(tampered)("misses on %s, and does not throw", async (_name, tamper) => {
    await writeUploadFigureCut(ONE, 2, "Figure 3", { png: fakePng(1) });
    const [name] = await objects(ONE);
    await writeFile(path.join(folder(ONE), name), tamper(fakePng(1)));
    expect(await readUploadFigureCut(ONE, 2, "Figure 3")).toBeNull();
  });

  it("is removed whole by removeUploadFigureCuts, whatever its page, label or revision, and another upload's stays", async () => {
    await writeUploadFigureCut(ONE, 1, "Figure 1", { png: fakePng(1) });
    await writeUploadFigureCut(ONE, 2, "Figure 3", { png: fakePng(2) });
    revision.value = "5";
    await writeUploadFigureCut(ONE, 2, "Figure 3", { png: fakePng(3) });
    await writeUploadFigureCut(TWO, 1, "Figure 1", { png: fakePng(4) });

    await removeUploadFigureCuts(ONE);

    expect(existsSync(folder(ONE))).toBe(false);
    expect(await readUploadFigureCut(ONE, 2, "Figure 3")).toBeNull();
    expect((await readUploadFigureCut(TWO, 1, "Figure 1"))?.png[8]).toBe(4);
    // Removing what is not there is not an error.
    await removeUploadFigureCuts(ONE);
  });
});
