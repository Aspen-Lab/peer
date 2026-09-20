// 9-33 (A9-08, L1): protective test for the standing instruction — no
// sentence anywhere in the upload consent flow, its status line, the
// README, or the new docs/PRIVATE_PDF_UPLOADS.md may promise that an
// upload, once accepted, is legally guaranteed. A source-text check (this
// repo's own established pattern for a claim that can't be verified by
// rendering a component — see globals.css.test.ts's 9-32 tests) over the
// four files the guide named.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// "guarantee(d)"/免责/绝对 always assert or deny something — every SENTENCE
// containing one must also contain an explicit negation. Scoped to the
// sentence, not a fixed character window: an earlier version of this test
// used a +/-120-char window and missed an injected "guaranteed to be
// legal" sentence sitting right after an unrelated, negation-dense
// paragraph (confirmed by deliberately inserting exactly that sentence and
// watching the window-based version stay green) — sentence boundaries
// don't leak the way a character window can.
const CLAIM_WORDS = /guarantee|guaranteed|免责|绝对/i;
const NEGATION = /\bnot\b|\bno\b|\bnever\b|\bcannot\b|\bdoesn't\b|\bunable\b|n['o]t able/i;

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

// Splits on sentence-ending punctuation followed by whitespace, and on
// blank lines (a markdown paragraph/list-item break) — good enough for the
// prose in these four files without a full NLP sentence splitter.
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z*`])|\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const files: Array<[string, string]> = [
  ["upload-consent-dialog.tsx", read("./upload-consent-dialog.tsx")],
  ["private-pdf-status.tsx", read("../reader/private-pdf-status.tsx")],
  ["README.md", read("../../../../README.md")],
  ["docs/PRIVATE_PDF_UPLOADS.md", read("../../../../docs/PRIVATE_PDF_UPLOADS.md")],
];

describe("no sentence promises legality (9-33/L1)", () => {
  for (const [name, content] of files) {
    it(`${name}: every sentence with "guarantee(d)"/免责/绝对 also negates it`, () => {
      const claimSentences = sentences(content).filter((s) => CLAIM_WORDS.test(s));
      for (const sentence of claimSentences) {
        expect(NEGATION.test(sentence), `no negation found in claim sentence of ${name}:\n${sentence}`).toBe(true);
      }
    });

    it(`${name}: never says an upload/it/this is legal without a denial in the same sentence`, () => {
      for (const sentence of sentences(content)) {
        const promisesLegal = /\b(this|it|your upload|uploads?)\b[^.!?]{0,40}\b(is|are)\b[^.!?]{0,40}\blegal(ly)?\b/i.test(sentence);
        if (!promisesLegal) continue;
        expect(NEGATION.test(sentence), `a sentence in ${name} calls an upload "legal" with no denial nearby:\n${sentence}`).toBe(true);
      }
    });
  }
});
