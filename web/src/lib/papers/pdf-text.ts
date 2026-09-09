// Node-side wrapper around `extract_pdf_text.py`. Downloads the PDF, hands
// the bytes to the Python helper, and normalizes the result into the same
// shape as the HTML extractors.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { cleanDisplayText } from "@/lib/text/clean";
import { withInheritedBuckets } from "./html-text";
import type { ExtractedDocument, ExtractedSection, ExtractedFigureCaption } from "./html-text";

const execFileAsync = promisify(execFile);

const FETCH_TIMEOUT_MS = 12_000;
const MAX_PDF_BYTES = 18_000_000;
const MAX_STDIO_BYTES = 18_000_000;
const MAX_PDF_PAGES = 40;
const FETCH_VERSION = "2026-05-01-pdf-text";

interface ExtractorSection {
  heading?: string;
  canonical?: string;
  page?: number;
  text?: string;
}

interface ExtractorCaption {
  ordinal?: number;
  label?: string;
  caption?: string;
  page?: number;
}

interface ExtractorOutput {
  title?: string | null;
  sections?: ExtractorSection[];
  figureCaptions?: ExtractorCaption[];
  pageCount?: number;
  reason?: string | null;
}

export interface PdfTextResult {
  ok: boolean;
  doc?: ExtractedDocument;
  reason?: string;
}

function resolveHelperScript(): string | null {
  const candidates = [
    path.join(process.cwd(), "scripts", "extract_pdf_text.py"),
    path.join(process.cwd(), "web", "scripts", "extract_pdf_text.py"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function downloadPdf(url: string): Promise<{ bytes: Buffer; finalUrl: string } | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "User-Agent": "PeerBot/0.1 (+https://peer.research)",
        "X-Peer-Text-Version": FETCH_VERSION,
        Accept: "application/pdf,*/*;q=0.8",
      },
    });
    if (!res.ok) return { error: `PDF fetch returned ${res.status}` };

    const lengthHeader = Number.parseInt(res.headers.get("content-length") ?? "", 10);
    if (Number.isFinite(lengthHeader) && lengthHeader > MAX_PDF_BYTES) {
      return { error: "PDF too large for safe extraction." };
    }

    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength === 0) return { error: "PDF response was empty." };
    if (bytes.byteLength > MAX_PDF_BYTES) return { error: "PDF too large for safe extraction." };
    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
      return { error: "Response was not a PDF (likely a landing/paywall page)." };
    }
    return { bytes, finalUrl: res.url || url };
  } catch (err) {
    return { error: String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Why the helper did not run. `no-python` and `no-script` are the two the
 * reading page names: on Vercel no interpreter can be spawned, or the helper
 * script is missing from a function bundle it was not traced into, and the
 * page must say plainly that the PDF is there and this deployment cannot read
 * it, rather than "no full text" as if the paper had none. Both reach the
 * caller as a machine reason (`no-python` / `no-extractor`), never as prose.
 */
type ExtractorFailure = "no-python" | "no-script" | "failed";

async function runExtractor(
  pdfPath: string,
): Promise<{ output: ExtractorOutput } | { failure: ExtractorFailure }> {
  const helperScript = resolveHelperScript();
  if (!helperScript) return { failure: "no-script" };

  // macOS and most Linux images ship `python3` and no `python`; the old list
  // tried `python` then `py -3`, so on a Mac every PDF quietly yielded null.
  const runners = [
    ...(process.env.PYTHON_BIN
      ? [{ command: process.env.PYTHON_BIN, args: [] as string[] }]
      : []),
    { command: "python3", args: [] as string[] },
    { command: "python", args: [] as string[] },
    { command: "py", args: ["-3"] },
  ];

  for (const runner of runners) {
    try {
      const { stdout } = await execFileAsync(
        runner.command,
        [
          ...runner.args,
          helperScript,
          "--input",
          pdfPath,
          "--max-pages",
          String(MAX_PDF_PAGES),
        ],
        { timeout: 45_000, maxBuffer: MAX_STDIO_BYTES },
      );
      return { output: JSON.parse(stdout) as ExtractorOutput };
    } catch (err) {
      const message = String(err);
      if (/not recognized|ENOENT/i.test(message)) continue;
      console.warn("[papers/pdf-text] extractor failed:", err);
      return { failure: "failed" };
    }
  }
  return { failure: "no-python" };
}

function normalize(extractor: ExtractorOutput): ExtractedDocument {
  // Numbered subsections inherit their parent's bucket here too — the Python
  // extractor buckets one heading at a time, the same way the HTML one did.
  const sections: ExtractedSection[] = withInheritedBuckets(
    (extractor.sections ?? [])
    .map((section) => ({
      heading: cleanDisplayText(section.heading) || "Body",
      canonical: section.canonical || "body",
      text: cleanDisplayText(section.text),
    }))
    .filter((section) => section.text.length > 0),
  );

  const figureCaptions: ExtractedFigureCaption[] = (extractor.figureCaptions ?? [])
    .map((cap, index) => ({
      ordinal: typeof cap.ordinal === "number" ? cap.ordinal : index,
      label: cleanDisplayText(cap.label) || `Figure ${index + 1}`,
      caption: cleanDisplayText(cap.caption),
    }))
    .filter((cap) => cap.caption.length > 0);

  return {
    title: cleanDisplayText(extractor.title) || null,
    sections,
    figureCaptions,
    source: "pdf",
    pageCount: typeof extractor.pageCount === "number" ? extractor.pageCount : undefined,
    reason: extractor.reason ?? null,
  };
}

/**
 * Download a legal PDF and extract sectioned text + figure captions.
 */
export async function tryExtractPdfText(url: string): Promise<PdfTextResult> {
  const download = await downloadPdf(url);
  if ("error" in download) {
    return { ok: false, reason: download.error };
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), "peer-pdftext-"));
  const pdfPath = path.join(tempDir, "paper.pdf");

  try {
    await writeFile(pdfPath, download.bytes);
    const ran = await runExtractor(pdfPath);
    if ("failure" in ran) {
      return {
        ok: false,
        reason:
          ran.failure === "no-python"
            ? "no-python"
            : ran.failure === "no-script"
              ? "no-extractor"
              : "PDF text extractor failed on this server.",
      };
    }
    const extractor = ran.output;
    if (extractor.reason && (!extractor.sections || extractor.sections.length === 0)) {
      return { ok: false, reason: extractor.reason };
    }
    const doc = normalize(extractor);
    return { ok: true, doc };
  } catch (err) {
    return { ok: false, reason: String(err) };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
