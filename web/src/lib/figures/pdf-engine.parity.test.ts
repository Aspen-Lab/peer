// P9-28 — the parity oracle. `scripts/extract_pdf_figures.py` (PyMuPDF) is the
// engine the figure rules were written against; this runs it and the MuPDF
// WASM engine on the same invented PDFs and asks for the same figures. It runs
// only where `pymupdf` imports (a developer's machine, `PYTHON_BIN` pointing
// at one) and is deleted with the script once the preview has proved the port.

import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { fixtures, pngInfo } from "./figure-pdf.test-helper";
import { extractPdfFigures } from "./pdf-engine";

const PYTHON = process.env.PYTHON_BIN || "python";
const HELPER = path.join(process.cwd(), "scripts", "extract_pdf_figures.py");
const hasPyMuPdf =
  spawnSync(PYTHON, ["-c", "import pymupdf"], { timeout: 30_000, stdio: "ignore" }).status === 0;

interface HelperFigure {
  ordinal: number;
  page: number;
  caption: string | null;
  kind: string;
  dataBase64: string;
}

let dir = "";
beforeAll(async () => {
  if (hasPyMuPdf) dir = await mkdtemp(path.join(tmpdir(), "peer-parity-"));
});
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function helperRun(name: string, pdf: Uint8Array): Promise<{ figures: HelperFigure[]; reason: string | null }> {
  const input = path.join(dir, `${name}.pdf`);
  const output = path.join(dir, `${name}.json`);
  await writeFile(input, pdf);
  const run = spawnSync(
    PYTHON,
    [HELPER, "--input", input, "--output", output, "--max-pages", "24", "--max-figures", "12"],
    { timeout: 60_000, encoding: "utf8" },
  );
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(await readFile(output, "utf8"));
}

// One test, not one per PDF: where pymupdf is absent this is one skip, not six.
it.skipIf(!hasPyMuPdf)("finds what the PyMuPDF helper finds on every invented PDF", async () => {
  for (const [name, pdf] of Object.entries(fixtures)) {
    const [helper, engine] = await Promise.all([
      helperRun(name, pdf),
      extractPdfFigures(pdf, { maxPages: 24, maxFigures: 12 }),
    ]);
    expect(
      engine.figures.map((f) => [f.ordinal, f.page, f.kind, f.caption]),
      name,
    ).toEqual(helper.figures.map((f) => [f.ordinal, f.page, f.kind, f.caption ?? ""]));
    expect(engine.reason, name).toBe(helper.reason);
    helper.figures.forEach((figure, i) => {
      const theirs = pngInfo(Buffer.from(figure.dataBase64, "base64"));
      const ours = pngInfo(engine.figures[i].png);
      expect(Math.abs(ours.width - theirs.width), `${name} #${i} width`).toBeLessThanOrEqual(2);
      expect(Math.abs(ours.height - theirs.height), `${name} #${i} height`).toBeLessThanOrEqual(2);
    });
  }
}, 120_000); // six interpreter starts, one per invented PDF
