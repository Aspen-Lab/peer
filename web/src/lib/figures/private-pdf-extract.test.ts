import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { barChart, bodyText, figurePdf } from "./figure-pdf.test-helper";

// P9-28: the figure engine runs in this process, on bytes. The Python helper
// used to take a path and write its answer to a `mkdtemp` directory, so this
// suite mocked `execFile` and asserted the directories were removed. There is
// no helper, no directory and no file now; the suite proves that instead — two
// uploads extracted at the same moment each get their own figures, and nothing
// is created under the temp directory, which the test points at an empty
// directory of its own so that anything written there is seen.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, mkdtemp: vi.fn(actual.mkdtemp), writeFile: vi.fn(actual.writeFile) };
});
import { extractPdfCandidatesFromPath, tryPdfCandidates } from "./pdf-extract";

const ALICE = "Figure 1. Alice's invented chart, drawn with paths only.";
const BOB = "Figure 1. Bob's invented chart, drawn with paths only.";

/** Three pages, so two extractions started together really interleave. */
function upload(caption: string, chartX: number): Buffer {
  const prose = { text: bodyText(["Invented prose for an invented upload."], 80) };
  return figurePdf([
    prose,
    prose,
    { text: [...prose.text, [caption, 72, 440, 9]], shapes: barChart(chartX, 250) },
  ]);
}

let home = "";
let uploads = "";
let scratch = "";
const savedTmpdir = process.env.TMPDIR;

beforeAll(async () => {
  home = await mkdtemp(path.join(tmpdir(), "peer-figure-test-"));
  uploads = path.join(home, "uploads");
  scratch = path.join(home, "empty-tmp");
  await mkdir(uploads);
  await mkdir(scratch);
  await writeFile(path.join(uploads, "alice.pdf"), upload(ALICE, 110));
  await writeFile(path.join(uploads, "bob.pdf"), upload(BOB, 150));
  process.env.TMPDIR = scratch; // `os.tmpdir()` reads this on every call
});

afterAll(async () => {
  if (savedTmpdir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = savedTmpdir;
  vi.unstubAllGlobals();
  await rm(home, { recursive: true, force: true });
});

function pngOf(imageUrl: string): Buffer {
  expect(imageUrl.startsWith("data:image/png;base64,")).toBe(true);
  return Buffer.from(imageUrl.slice("data:image/png;base64,".length), "base64");
}

it("isolates concurrent users' figures and writes nothing to the temp directory", async () => {
  expect(tmpdir()).toBe(scratch); // the redirect works, so an empty scratch means something
  vi.mocked(mkdtemp).mockClear();
  vi.mocked(writeFile).mockClear();

  const [a, b] = await Promise.all([
    extractPdfCandidatesFromPath(path.join(uploads, "alice.pdf"), "publisher"),
    extractPdfCandidatesFromPath(path.join(uploads, "bob.pdf"), "publisher"),
  ]);

  expect(a.status).toBe("candidates");
  expect(b.status).toBe("candidates");
  expect(a.candidates.map((c) => c.caption)).toEqual([ALICE]);
  expect(b.candidates.map((c) => c.caption)).toEqual([BOB]);
  expect(a.candidates[0]).toMatchObject({ source: "publisher", ordinal: 0, qualityHint: "high" });
  // Each answer is its own render, not the other's: the charts sit at different x.
  expect(pngOf(a.candidates[0].imageUrl).equals(pngOf(b.candidates[0].imageUrl))).toBe(false);
  expect(pngOf(a.candidates[0].imageUrl).subarray(1, 4).toString("latin1")).toBe("PNG");

  expect(mkdtemp).not.toHaveBeenCalled();
  expect(writeFile).not.toHaveBeenCalled();
  expect(await readdir(scratch)).toEqual([]);
});

it("reads a fetched PDF from memory too: no temp directory, no file", async () => {
  vi.mocked(mkdtemp).mockClear();
  vi.mocked(writeFile).mockClear();
  const bytes = upload(BOB, 150);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "application/pdf" } })),
  );

  const result = await tryPdfCandidates("https://example.org/bob.pdf", "publisher");

  expect(result.status).toBe("candidates");
  expect(result.candidates.map((c) => c.caption)).toEqual([BOB]);
  expect(mkdtemp).not.toHaveBeenCalled();
  expect(writeFile).not.toHaveBeenCalled();
  expect(await readdir(scratch)).toEqual([]);
});

it("answers a PDF with no figure as no_figures with the engine's own reason", async () => {
  await writeFile(path.join(uploads, "prose.pdf"), figurePdf([{ text: bodyText(["Only prose."], 80) }]));

  const result = await extractPdfCandidatesFromPath(path.join(uploads, "prose.pdf"), "publisher");

  expect(result.status).toBe("no_figures");
  expect(result.candidates).toEqual([]);
  expect(result.reason).toMatch(/did not find any figure regions/);
});

it("answers a file that is not a PDF as no_figures, never as a thrown error", async () => {
  await writeFile(path.join(uploads, "broken.pdf"), "this is not a pdf");

  const result = await extractPdfCandidatesFromPath(path.join(uploads, "broken.pdf"), "publisher");

  expect(result.status).toBe("no_figures");
  expect(result.reason).toMatch(/extraction failed/);
});

it("answers a file that is not there as source_unavailable", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const result = await extractPdfCandidatesFromPath(path.join(uploads, "missing.pdf"), "publisher");

  expect(result.status).toBe("source_unavailable");
  expect(result.candidates).toEqual([]);
});
