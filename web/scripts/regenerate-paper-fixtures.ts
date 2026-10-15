/**
 * Regenerates the three committed paper fixtures,
 *
 *   src/lib/papers/__fixtures__/arxiv-2609.02113.doc.json   (arXiv PDF)
 *   src/lib/papers/__fixtures__/arxiv-2609.02697.doc.json   (arXiv HTML, the LaTeXML render)
 *   src/lib/papers/__fixtures__/zenodo-W7208807247.doc.json (Zenodo record's PDF)
 *
 * through the CURRENT extractors, so each carries what a live read carries:
 * a section `id` (`s0`, `s1`, … in document order), the `page` a PDF section's
 * heading sits on, and a blank line (`\n\n`) between the paragraphs inside a
 * section's `text`. The committed files predate all three (one paragraph per
 * section, no ids, no pages), so paragraph-level features — the reading map's
 * lines, a question's paragraph hits, the paragraph gists — were exercised only
 * by documents built inside tests (BACKLOG-05).
 *
 * WHERE EACH COMES FROM — the way `lib/papers/full-text.ts` reads a paper, with
 * the same functions, so a fixture is what the product would have read:
 *   - arXiv PDF   `collectSourceLinks({ arxivId })` gives `arxiv.org/pdf/<id>`;
 *                 `tryExtractPdfText(url)` is what `tryPdfLink` calls.
 *   - Zenodo      `lookupZenodoLinks(doi)` asks zenodo.org's records API for the
 *                 deposited PDF; the same `tryExtractPdfText`.
 *   - arXiv HTML  `getFullText(...)` itself (arxiv.org/html, then ar5iv, then
 *                 the PDF). That fixture has always been the HTML read
 *                 (`source: "ar5iv"`, no pages) and keeps being one — it is the
 *                 only fixture on the HTML extractor's paragraph path — so a
 *                 walk that fell through to the PDF is REFUSED here, not written.
 * The raw PDFs are held in memory only (nothing is saved beside the JSON);
 * only the extracted documents are committed. Public papers only; no key, no
 * account, nothing per-user is read or sent.
 *
 * RUN, from web/ (all three fetched and checked first; nothing is written
 * unless every one passes):
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/regenerate-paper-fixtures.ts
 *
 *   --check       read the committed fixtures, run the same shape checks, write
 *                 nothing, touch no network (exit 1 while any fixture lacks
 *                 ids, pages or paragraph breaks)
 *   --dry-run     fetch and check, print the summary, write nothing
 *   --only <name> one fixture (`arxiv-2609.02113`, `arxiv-2609.02697`,
 *                 `zenodo-W7208807247`)
 *   --out <dir>   write there instead of the fixtures directory
 *
 * `NODE_USE_ENV_PROXY=1` makes Node's built-in fetch honour HTTPS_PROXY (Node
 * >= 22.21); without a proxy it does nothing. `npx tsx` fetches tsx from npm on
 * each run: it is not a dependency of this repo, and this script is not run by
 * any gate (it needs the network). After a regeneration the tests that pinned
 * the old numbers are updated by hand, each change with a one-line reason.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getFullText } from "../src/lib/papers/full-text";
import type { ExtractedDocument, ExtractedSourceKind } from "../src/lib/papers/html-text";
import { tryExtractPdfText } from "../src/lib/papers/pdf-text";
import { collectSourceLinks, lookupZenodoLinks } from "../src/lib/papers/source-links";

type Via = "arxiv-pdf" | "arxiv-html" | "zenodo-pdf";

interface Target {
  /** The file's stem: `<name>.doc.json`. */
  name: string;
  via: Via;
  /** Bare arXiv id, for the two arXiv fixtures. */
  arxivId?: string;
  /** The record's DOI, for the Zenodo fixture. */
  doi?: string;
  /** What `ExtractedDocument.source` must be; a different one is a different
   *  fixture, not a regeneration of this one. */
  source: ExtractedSourceKind;
}

// The three public papers, as they are named in the committed `.paper.json`
// siblings (`arxiv:2609.02113`, DOI 10.5281/zenodo.22316532 for openalex
// W7208807247). Nothing else is ever fetched.
const TARGETS: readonly Target[] = [
  { name: "arxiv-2609.02113", via: "arxiv-pdf", arxivId: "2609.02113", source: "pdf" },
  { name: "arxiv-2609.02697", via: "arxiv-html", arxivId: "2609.02697", source: "ar5iv" },
  { name: "zenodo-W7208807247", via: "zenodo-pdf", doi: "10.5281/zenodo.22316532", source: "pdf" },
];

const PAUSE_BETWEEN_FETCHES_MS = 3_000;

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** Paragraphs the way the reading page counts them: runs separated by a blank line. */
function paragraphsOf(text: string): string[] {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * What a fixture must carry to be worth committing — the three things
 * BACKLOG-05 exists for, plus the source it is a fixture OF. An empty list
 * means it passes.
 */
function shapeProblems(doc: ExtractedDocument, target: Target): string[] {
  // Whole-document problems come first, so a walk that fell through to another
  // source reads as that, and a long list of per-section ones cannot hide them.
  const whole: string[] = [];
  const perSection: string[] = [];
  if (doc.source !== target.source) {
    whole.push(`source is ${JSON.stringify(doc.source)}, this fixture is ${JSON.stringify(target.source)}`);
  }
  if (doc.sections.length === 0) whole.push("no sections");
  if (!doc.sections.some((section) => paragraphsOf(section.text).length >= 2)) {
    whole.push("no section has two or more paragraphs (no blank line inside any section's text)");
  }
  if (target.source === "pdf" && !(typeof doc.pageCount === "number" && doc.pageCount > 0)) {
    whole.push("no pageCount");
  }

  doc.sections.forEach((section, index) => {
    const where = `section ${index} (${JSON.stringify(section.heading)})`;
    if (section.id !== `s${index}`) {
      perSection.push(`${where}: id is ${JSON.stringify(section.id)}, expected "s${index}"`);
    }
    if (target.source === "pdf") {
      if (typeof section.page !== "number" || !(section.page >= 1)) {
        perSection.push(`${where}: no page (a PDF section carries the page its heading sits on)`);
      }
    } else if (section.page !== undefined) {
      perSection.push(`${where}: has a page, but this fixture is the HTML read`);
    }
  });
  return [...whole, ...perSection];
}

/** One line per fixture: what a reader of the log needs to see it is the right paper. */
function summary(doc: ExtractedDocument): string {
  const paragraphs = doc.sections.reduce((sum, s) => sum + paragraphsOf(s.text).length, 0);
  const multi = doc.sections.filter((s) => paragraphsOf(s.text).length >= 2).length;
  const words = doc.sections.reduce((sum, s) => sum + s.text.split(/\s+/).filter(Boolean).length, 0);
  const pages = doc.sections.map((s) => s.page).filter((p): p is number => typeof p === "number");
  const lastPage = pages.length > 0 ? `, pages 1-${Math.max(...pages)} of ${doc.pageCount ?? "?"}` : "";
  return (
    `${doc.sections.length} sections (${multi} with 2+ paragraphs), ${paragraphs} paragraphs, ` +
    `${words} words, ${doc.figureCaptions.length} captions${lastPage}, source ${doc.source}, ` +
    `title ${JSON.stringify(doc.title ?? null)}`
  );
}

class FetchProblem extends Error {}

async function fetchDoc(target: Target): Promise<{ doc: ExtractedDocument; from: string }> {
  if (target.via === "arxiv-pdf") {
    const id = target.arxivId ?? "";
    const link = (await collectSourceLinks({ arxivId: id })).find((l) => l.kind === "pdf");
    if (!link) throw new FetchProblem(`no PDF link for arXiv ${id}`);
    const result = await tryExtractPdfText(link.url);
    if (!result.ok || !result.doc) {
      throw new FetchProblem(`${link.url}: ${result.reason ?? "no document"}${result.status ? ` (HTTP ${result.status})` : ""}`);
    }
    return { doc: result.doc, from: link.url };
  }

  if (target.via === "zenodo-pdf") {
    const doi = target.doi ?? "";
    const link = (await lookupZenodoLinks(doi))[0];
    if (!link) {
      throw new FetchProblem(`zenodo.org/api/records for ${doi} returned no PDF file (blocked, or the record has none)`);
    }
    const result = await tryExtractPdfText(link.url);
    if (!result.ok || !result.doc) {
      throw new FetchProblem(`${link.url}: ${result.reason ?? "no document"}${result.status ? ` (HTTP ${result.status})` : ""}`);
    }
    return { doc: result.doc, from: link.url };
  }

  const id = target.arxivId ?? "";
  const result = await getFullText({ paperId: `arxiv:${id}`, arxivId: id });
  if (result.status !== "ok" || !result.doc) {
    const tried = result.attempts.map((a) => `    ${a.link.url} -> ${a.outcome}`).join("\n");
    throw new FetchProblem(`getFullText(arxiv:${id}) is ${result.status}${result.reason ? `: ${result.reason}` : ""}\n${tried}`);
  }
  return { doc: result.doc, from: result.sourceLink?.url ?? "(unknown source link)" };
}

/** `JSON.stringify` the way the committed fixtures are written: one-space
 *  indent, no trailing newline. */
function serialise(doc: ExtractedDocument): string {
  return JSON.stringify(doc, null, 1);
}

function argValue(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  if (at < 0) return undefined;
  const value = args[at + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value`);
  return value;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const dryRun = args.includes("--dry-run");
  const only = argValue(args, "--only");
  const fixturesDir = resolve(process.cwd(), "src/lib/papers/__fixtures__");
  const outDir = resolve(process.cwd(), argValue(args, "--out") ?? "src/lib/papers/__fixtures__");

  const targets = only ? TARGETS.filter((t) => t.name === only) : TARGETS;
  if (targets.length === 0) {
    console.error(`--only ${only}: not one of ${TARGETS.map((t) => t.name).join(", ")}`);
    return 2;
  }

  if (check) {
    let failed = false;
    for (const target of targets) {
      const file = resolve(fixturesDir, `${target.name}.doc.json`);
      let doc: ExtractedDocument;
      try {
        doc = JSON.parse(await readFile(file, "utf8")) as ExtractedDocument;
      } catch (error) {
        console.error(`${target.name}: cannot read ${file} (run this from web/): ${String(error)}`);
        return 2;
      }
      const problems = shapeProblems(doc, target);
      console.log(`${target.name}: ${problems.length === 0 ? "ok" : `${problems.length} problem(s)`} — ${summary(doc)}`);
      for (const problem of problems.slice(0, 8)) console.log(`  - ${problem}`);
      if (problems.length > 8) console.log(`  - … and ${problems.length - 8} more`);
      if (problems.length > 0) failed = true;
    }
    return failed ? 1 : 0;
  }

  // Fetch and check everything before writing anything: one refused source
  // leaves every committed fixture exactly as it was.
  const fetched: Array<{ target: Target; doc: ExtractedDocument }> = [];
  const failures: string[] = [];
  for (const [index, target] of targets.entries()) {
    if (index > 0) await sleep(PAUSE_BETWEEN_FETCHES_MS);
    console.log(`${target.name}: fetching (${target.via}) …`);
    try {
      const { doc, from } = await fetchDoc(target);
      const problems = shapeProblems(doc, target);
      if (problems.length > 0) {
        failures.push(`${target.name}: fetched from ${from} but the document is not a usable fixture:\n    - ${problems.slice(0, 8).join("\n    - ")}`);
        continue;
      }
      console.log(`${target.name}: ${from}\n  ${summary(doc)}`);
      fetched.push({ target, doc });
    } catch (error) {
      failures.push(`${target.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failures.length > 0) {
    console.error(`\nNothing was written. ${failures.length} of ${targets.length} failed:`);
    for (const failure of failures) console.error(`  ${failure}`);
    return 1;
  }
  if (dryRun) {
    console.log("\n--dry-run: all fetched and checked; nothing written.");
    return 0;
  }

  await mkdir(outDir, { recursive: true });
  for (const { target, doc } of fetched) {
    const file = resolve(outDir, `${target.name}.doc.json`);
    await writeFile(file, serialise(doc));
    console.log(`wrote ${file}`);
  }
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
