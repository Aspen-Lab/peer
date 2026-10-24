import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

// P11-28 (owner item 8; round 1 Theme B readers r1, r2; ruling §1h.123 (c)): the Summary's blocks and the answers' block draw the marks of the highlights
// anchored to them. Each mounts the painter (`BlockMarks`, which draws nothing itself) inside its own element, under the id the selection reports for it:
// `SummaryBlock` for every block the page wraps (the report's: What is new, the proposal, the method, the results, …), `Deck` for the skim line, the TL;DR
// block, and `ForYourQuestions` for the answers. The markup of every block stays what it was (the painter renders nothing), which `summary-ids.test.tsx` holds.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import { BlockMarks } from "@/components/notes/block-marks";
import { ANSWERS_BLOCK_ID } from "@/components/notes/note-tags";
import type { PaperReport } from "@/lib/papers/report";
import { hookRuntime } from "@/test-support/hook-runtime";
import { elements } from "@/test-support/question-session";
import { ForYourQuestions } from "./for-your-questions";
import { SummaryBlock } from "./paper-words";

const source = (file: string) => readFileSync(resolve(__dirname, file), "utf8").replace(/\s+/g, " ");

describe("SummaryBlock mounts the painter inside the block's own element", () => {
  it("under the block's id, after what the block draws", () => {
    const out = SummaryBlock({ id: "summary-method", children: "Words" }) as never;
    const painters = elements(out).filter((e) => e.type === BlockMarks);
    expect(painters).toHaveLength(1);
    expect(painters[0].props).toEqual({ id: "summary-method" });
    expect(elements(out)[0].props.id).toBe("summary-method");
  });

  it("draws nothing around nothing, painter included: a block the page does not draw has nothing to mark", () => {
    for (const nothing of [null, undefined, false]) expect(SummaryBlock({ id: "summary-method", children: nothing as never })).toBeNull();
    expect(SummaryBlock({ id: "summary-method" })).toBeNull();
  });
});

describe("the blocks the words file draws itself", () => {
  const words = source("./paper-words.tsx");

  it("the skim line and the TL;DR block mount the painter under their ids", () => {
    expect(words).toContain("<BlockMarks id={SUMMARY_ID.skim} />");
    expect(words).toContain("<BlockMarks id={SUMMARY_ID.tldr} />");
  });

  it("the lead claim and the abstract are SummaryBlocks: the painter comes with them", () => {
    expect(words).toContain("<SummaryBlock id={SUMMARY_ID.claim}");
    expect(words).toContain("<SummaryBlock id={SUMMARY_ID.abstract}");
    expect(words).toContain("<BlockMarks id={id} />");
  });
});

describe("the answers' block mounts the painter inside its section", () => {
  const report: Pick<PaperReport, "forYourQuestions"> = {
    forYourQuestions: [{ question: "Does the layer hold water?", verdict: "answered", answers: [], readNext: [] }],
  };

  it("under the answers' id", async () => {
    let tree: unknown = null;
    await hookRuntime.mount(() => (tree = ForYourQuestions({ report, map: undefined })));
    const painters = elements(tree as never).filter((e) => e.type === BlockMarks);
    expect(painters).toHaveLength(1);
    expect(painters[0].props).toEqual({ id: ANSWERS_BLOCK_ID });
    expect(elements(tree as never)[0].props.id).toBe(ANSWERS_BLOCK_ID);
  });

  it("only with answers to mark: no report, no block, no painter", async () => {
    let tree: unknown = "unset";
    await hookRuntime.mount(() => (tree = ForYourQuestions({ report: {}, map: undefined })));
    expect(tree).toBeNull();
  });
});
