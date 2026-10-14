import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ExplainAnswer } from "@/lib/papers/explain";
import type { ExplainTurn } from "@/store/explain-threads";
import { EXPLAIN, WHY_PEER_SAYS_IT } from "./copy";
import { SectionLinks } from "./evidence-quote";
import { ExplainCard, type ExplainStatus } from "./explain-box";

// P10-39 (rules 2, 3; P10-38's unsettled): "Why Peer says it" lives in copy.ts beside EXPLAIN.here, and the card reads it from there;
// in a thread on a selection in Peer's own words, Peer's later replies carry the same label as the first answer's second part (the
// paper's selections keep "Peer"). Rendered with react-dom/server. Invented text.

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const PASSAGE = "Tungsten slowed plate formation, so the rafting ratio stays low for longer.";
const answer: ExplainAnswer = { meaning: "Plate formation is the alloy's grains lining up.", here: { text: "The results report the same delay.", peer: true } };
const turns: ExplainTurn[] = [
  { role: "reader", text: "Does it hold for the cast alloy?" },
  { role: "peer", text: "The paper tests the cast alloy only once.", peer: true },
  { role: "reader", text: "And the forged one?" },
  { role: "peer", text: "Not in this paper.", peer: true },
];

const markup = (over: Partial<Parameters<typeof ExplainCard>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(
      SectionLinks,
      { headings: ["1 Introduction"] },
      createElement(ExplainCard, {
        passage: PASSAGE,
        heading: "",
        term: null,
        termWhere: null,
        canAsk: true,
        status: { kind: "answer", answer } as ExplainStatus,
        thread: { turns, draft: "", pending: false, failed: false, onDraft: () => {}, onSend: () => {} },
        onClose: () => {},
        dock: true,
        ...over,
      }),
    ),
  );
const count = (html: string, text: string) => html.split(text).length - 1;

describe("WHY_PEER_SAYS_IT — the copy lives with its kin", () => {
  it("is exported by copy.ts, beside EXPLAIN.here", () => {
    expect(WHY_PEER_SAYS_IT).toBe("Why Peer says it");
    const copy = read("src/components/reader/copy.ts");
    expect(copy).toContain('export const WHY_PEER_SAYS_IT = "Why Peer says it";');
    const end = copy.indexOf("} as const;", copy.indexOf("export const EXPLAIN = {"));
    expect(copy.indexOf("export const WHY_PEER_SAYS_IT")).toBeGreaterThan(end);
    expect(copy.indexOf("export const WHY_PEER_SAYS_IT")).toBeLessThan(end + 700);
  });

  it("is read by the card from there, not written again in the card's file", () => {
    const card = read("src/components/reader/explain-box.tsx");
    expect(card).not.toContain('"Why Peer says it"');
    expect(card).not.toMatch(/const WHY_PEER_SAYS_IT/);
    expect(card).toMatch(/import \{[^}]*WHY_PEER_SAYS_IT[^}]*\} from "\.\/copy"/);
  });
});

describe("a thread's replies name their source (rule 3)", () => {
  it.each(["summary", "answer"] as const)("labels each of Peer's replies \"Why Peer says it\" on a selection in %s, as the first answer's second part", (source) => {
    const html = markup({ source });
    expect(count(html, WHY_PEER_SAYS_IT)).toBe(1 + 2);
    expect(html).not.toContain(`>${EXPLAIN.peer}</p>`);
    expect(html).toContain(`>${EXPLAIN.you}</p>`);
    expect(count(html, `>${EXPLAIN.you}</p>`)).toBe(2);
  });

  it("keeps the reader's words and the reply's words as they were", () => {
    const html = markup({ source: "summary" });
    for (const turn of turns) expect(html).toContain(turn.text);
  });

  it("keeps \"Peer\" for the replies on a selection in the paper, marked or not", () => {
    for (const html of [markup(), markup({ source: "paper" })]) {
      expect(count(html, `>${EXPLAIN.peer}</p>`)).toBe(2);
      expect(html).not.toContain(WHY_PEER_SAYS_IT);
      expect(html).toContain(EXPLAIN.here);
    }
  });
});
