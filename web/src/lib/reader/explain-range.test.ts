import { describe, expect, it } from "vitest";
import type { SelectionTarget } from "@/components/reader/paper-body";
import { boundedExplainPassage, clientExplainRange, explainRequestRange, explainTarget, EXPLAIN_SOURCE_BOUNDARY, prepareExplainSelection, sameExplainTarget } from "./explain-range";
import { explainPassage } from "@/components/reader/explain-box";

const body = [{ id: "s1" }, { id: "s2" }];
function group(quotes = ["pools", "rise"], source: "paper" | "summary" | "answer" = "paper"): SelectionTarget {
  return { sectionIndex: 0, paragraphIndex: 0, source, passage: quotes.join("\n\n"),
    segments: quotes.map((quote, i) => ({ paragraphId: source === "paper" ? `paper-section-0-p${i}` : `summary-${i}`, source, quote, start: 100 + i, end: 100 + i + quote.length, paragraphText: `captured ${quote}` })),
    explainSegments: quotes.map((quote, i) => ({ paragraphId: source === "paper" ? `paper-section-0-p${i}` : `summary-${i}`, source, start: i ? 0 : 5, end: (i ? 0 : 5) + quote.length })),
  };
}
describe("P12-12 pure bounded canonical client projection", () => {
  it("uses separate canonical offsets rather than raw highlight offsets, preserving input", () => {
    const input = group(); const snapshot = JSON.stringify(input);
    const out = prepareExplainSelection(input, body);
    expect(out.range).toEqual({ segments: [{ sectionId: "s1", paragraphIndex: 0, start: 5, end: 10 }, { sectionId: "s1", paragraphIndex: 1, start: 0, end: 4 }] });
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(out.segments).toBe(input.segments);
  });
  it.each([1250, 1180, 1199, 1200])("sends only the exact clipped prefix when boundary is at %s", (length) => {
    const input = group(["a".repeat(length), "more words ".repeat(50).trim()]);
    const out = prepareExplainSelection(input, body);
    expect(out.explainUnavailableReason).toBeUndefined();
    const sent = explainRequestRange(out)!;
    expect(sent.passage).toBe(explainPassage(input.passage));
    expect(sent.passage).toBe(boundedExplainPassage(input.passage));
    const parts = out.range!.segments;
    expect(parts.length).toBe(length < 1199 ? 2 : 1);
    expect(parts.map((part, i) => input.segments![i].quote.slice(part.start - input.explainSegments![i].start, part.end - input.explainSegments![i].start)).join(" ")).toBe(sent.passage);
    expect(parts.at(-1)!.end - parts.at(-1)!.start).toBeLessThanOrEqual(1200);
  });
  it("retains heading/caption anchor indices, section identity and repeated occurrence", () => {
    const input = group(); input.segments![0].paragraphId = input.explainSegments![0].paragraphId = "paper-section-0-p4";
    input.segments![1].paragraphId = input.explainSegments![1].paragraphId = "paper-section-1-p7";
    input.explainSegments![0].start = 17; input.explainSegments![0].end = 22;
    const out = prepareExplainSelection(input, body);
    expect(out.range!.segments).toEqual([{ sectionId: "s1", paragraphIndex: 4, start: 17, end: 22 }, { sectionId: "s2", paragraphIndex: 7, start: 0, end: 4 }]);
    expect(sameExplainTarget(out, { ...out, explainIdentity: { ...out.explainIdentity!, segments: [{ ...out.range!.segments[0], start: 3, end: 8 }, out.range!.segments[1]] } })).toBe(false);
  });
  it.each(["summary", "answer"] as const)("keeps homogeneous %s groups on labelled legacy wire route", (source) => {
    const out = prepareExplainSelection(group(undefined, source), body);
    expect(out.source).toBe(source); expect(out.range).toBeUndefined(); expect(out.explainIdentity!.source).toBe(source);
    expect(explainRequestRange(out)).toEqual({ passage: out.passage });
  });
  it("retains drawable mixed groups with an Explain-only reason and blocks requests", () => {
    const input = group(); input.segments![1].source = "summary";
    const out = prepareExplainSelection(input, body);
    expect(out.explainUnavailableReason).toBe(EXPLAIN_SOURCE_BOUNDARY); expect(out.unavailableReason).toBeUndefined();
    expect(out.segments).toBe(input.segments); expect(explainRequestRange(out)).toBeNull();
    expect(explainRequestRange(explainTarget(out))).toBeNull();
  });
  it("projects callbacks without raw paragraphText, full segment data or measurements", () => {
    const out = explainTarget(prepareExplainSelection({ ...group(), selectionStillHolds: () => true }, body));
    expect(out.range).toBeDefined(); expect(out.explainIdentity).toBeDefined(); expect(out.selectionStillHolds!()).toBe(true);
    expect(JSON.stringify(out)).not.toMatch(/paragraphText|captured|explainSegments|quote/);
  });
  it("preserves actual and synthetic single-block legacy object/path", () => {
    const input = group(["pools"]); expect(prepareExplainSelection(input, body)).toBe(input);
    expect(explainRequestRange(input)).toEqual({ passage: "pools" });
    const legacy = { sectionIndex: 0, paragraphIndex: 0, passage: "pools" }; expect(prepareExplainSelection(legacy, body)).toBe(legacy);
  });
  it("fails missing/forged canonical data instead of forwarding raw offsets", () => {
    const input = group(); delete input.explainSegments;
    expect(prepareExplainSelection(input, body).explainUnavailableReason).toBeTruthy();
    expect(prepareExplainSelection(group(), []).explainUnavailableReason).toBeTruthy();
    const bad = group(); bad.explainSegments![0].end++;
    expect(prepareExplainSelection(bad, body).explainUnavailableReason).toBeTruthy();
  });
  it("bounds metadata independently at600, section128 and safe integers", () => {
    const part = { sectionId: "s".repeat(128), paragraphIndex: 0, start: 0, end: 1 };
    expect(clientExplainRange({ segments: Array.from({ length: 600 }, () => ({ ...part })) })!.segments).toHaveLength(600);
    const malformed: unknown[] = [null, {}, { segments: [] }, { segments: [part], quote: "x" }, { segments: Array(601).fill(part) },
      ...[{ sectionId: "s".repeat(129) }, { paragraphIndex: -1 }, { start: .5 }, { end: Infinity }, { end: Number.MAX_SAFE_INTEGER + 1 }, { end: 0 }, { quote: "x" }, { paragraphText: "x" }].map((over) => ({ segments: [{ ...part, ...over }] }))];
    for (const value of malformed) expect(clientExplainRange(value)).toBeNull();
  });
  it("a601-piece full selection sends only600 one-character pieces in the bounded prefix", () => {
    const out = prepareExplainSelection(group(Array(601).fill("a")), body);
    expect(out.explainUnavailableReason).toBeUndefined();
    expect(out.range!.segments).toHaveLength(600);
    expect(explainRequestRange(out)!.passage).toHaveLength(1199);
  });
});
