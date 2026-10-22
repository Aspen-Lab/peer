import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P11-17b rule 3 (C P11-14's defect (c), second half; B P11-03 §4 C-2): the notes' blue square leads to a Summary block or to the answers' block, as it
// leads to a body paragraph. The Summary's blocks stand only under the "Summary" tab, the paper's paragraphs only under "Paper digestion", the answers
// under both: so `goToPassage` asks the Summary's host (`registerSummaryHost`, the page's) to bring the Summary back for a Summary block, the paper's
// host for a paragraph, and neither for the answers (a tab switch there would take the reader off the tab they are on for nothing). The hook the page
// calls (`useSummaryHost`) runs on the staged hook runtime (no DOM in this suite). Every text is invented.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { stagedRuntime } = await import("@/test-support/staged-runtime");
  return { ...actual, ...stagedRuntime.hooks };
});

import { stagedRuntime } from "@/test-support/staged-runtime";
import { ANSWERS_BLOCK_ID, FLASH_MS, SUMMARY_ID_PREFIX, goToPassage, registerPassageHost, registerSummaryHost, useSummaryHost } from "./note-tags";

const anchorAt = (paragraphId: string, over: Record<string, unknown> = {}) => ({ paperId: "p1", paragraphId, quote: "an invented passage", n: 2, ...over });
const SUMMARY_ANCHOR = anchorAt(`${SUMMARY_ID_PREFIX}proposal`);
const ANSWERS_ANCHOR = anchorAt(ANSWERS_BLOCK_ID);
const PAPER_ANCHOR = anchorAt("paper-section-1-p0", { start: 0, end: 5 });

/** A page that holds the blocks named: each answers `getElementById` with a box that records the scroll and the flash. */
function pageWith(present: readonly string[]) {
  const boxes = new Map(
    present.map((id) => {
      const classes = new Set<string>();
      return [
        id,
        {
          scrollIntoView: vi.fn(),
          classes,
          classList: { add: (...c: string[]) => c.forEach((x) => classes.add(x)), remove: (...c: string[]) => c.forEach((x) => classes.delete(x)) },
          querySelectorAll: () => [],
        },
      ] as const;
    }),
  );
  return { boxes, doc: { getElementById: (id: string) => boxes.get(id) ?? null } as unknown as Document };
}

let off: Array<() => void>;
beforeEach(() => {
  off = [];
  vi.useFakeTimers();
});
afterEach(() => {
  off.forEach((stop) => stop());
  vi.useRealTimers();
});

describe("the ids", () => {
  it("are the Summary's prefix and the answers' block, apart from the paper's paragraph ids", () => {
    expect(SUMMARY_ID_PREFIX).toBe("summary-");
    expect(ANSWERS_BLOCK_ID).toBe("answers-block");
    expect(ANSWERS_BLOCK_ID.startsWith(SUMMARY_ID_PREFIX)).toBe(false);
    expect(/^paper-section-\d+-p\d+$/.test(`${SUMMARY_ID_PREFIX}proposal`)).toBe(false);
  });
});

describe("goToPassage — a Summary block", () => {
  it("scrolls to the block and flashes it, once the page has brought the Summary back", () => {
    const { boxes, doc } = pageWith([SUMMARY_ANCHOR.paragraphId]);
    const reveal = vi.fn((run: () => void) => run());
    off.push(registerSummaryHost({ paperId: "p1", reveal }));
    const navigate = vi.fn();
    goToPassage(SUMMARY_ANCHOR, { doc, navigate });
    const block = boxes.get(SUMMARY_ANCHOR.paragraphId)!;
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(block.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
    expect(block.classes.size).toBeGreaterThan(0);
    vi.advanceTimersByTime(FLASH_MS + 1);
    expect(block.classes.size).toBe(0);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("waits for the Summary host: nothing is scrolled until it runs the jump", () => {
    const { boxes, doc } = pageWith([SUMMARY_ANCHOR.paragraphId]);
    let later: (() => void) | null = null;
    off.push(registerSummaryHost({ paperId: "p1", reveal: (run) => void (later = run) }));
    goToPassage(SUMMARY_ANCHOR, { doc, navigate: vi.fn() });
    expect(boxes.get(SUMMARY_ANCHOR.paragraphId)!.scrollIntoView).not.toHaveBeenCalled();
    later!();
    expect(boxes.get(SUMMARY_ANCHOR.paragraphId)!.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("does not ask the paper's host, which would take the reader to Paper digestion where the Summary is not", () => {
    const { doc } = pageWith([SUMMARY_ANCHOR.paragraphId]);
    const summary = vi.fn((run: () => void) => run());
    const paper = vi.fn((run: () => void) => run());
    off.push(registerSummaryHost({ paperId: "p1", reveal: summary }), registerPassageHost({ paperId: "p1", reveal: paper }));
    goToPassage(SUMMARY_ANCHOR, { doc, navigate: vi.fn() });
    expect(summary).toHaveBeenCalledTimes(1);
    expect(paper).not.toHaveBeenCalled();
  });

  it("does not use another paper's host, and goes to the paper's page at the block when the block is not on this page (the notes page)", () => {
    const { doc } = pageWith([]);
    const other = vi.fn((run: () => void) => run());
    off.push(registerSummaryHost({ paperId: "p2", reveal: other }));
    const navigate = vi.fn();
    goToPassage(SUMMARY_ANCHOR, { doc, navigate });
    expect(other).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/papers/p1#summary-proposal");
  });

  it("flashes the whole block: a Summary note has no range, so there is no mark to find", () => {
    const { boxes, doc } = pageWith([SUMMARY_ANCHOR.paragraphId]);
    off.push(registerSummaryHost({ paperId: "p1", reveal: (run) => run() }));
    goToPassage(SUMMARY_ANCHOR, { doc, navigate: vi.fn() });
    expect(boxes.get(SUMMARY_ANCHOR.paragraphId)!.classes.has("outline")).toBe(true);
    expect(boxes.get(SUMMARY_ANCHOR.paragraphId)!.classes.has("bg-accent-dim")).toBe(true);
  });
});

describe("goToPassage — the answers' block", () => {
  it("scrolls and flashes without asking either host: the answers stand under both tabs, so no tab is switched", () => {
    const { boxes, doc } = pageWith([ANSWERS_BLOCK_ID]);
    const summary = vi.fn((run: () => void) => run());
    const paper = vi.fn((run: () => void) => run());
    off.push(registerSummaryHost({ paperId: "p1", reveal: summary }), registerPassageHost({ paperId: "p1", reveal: paper }));
    const navigate = vi.fn();
    goToPassage(ANSWERS_ANCHOR, { doc, navigate });
    expect(summary).not.toHaveBeenCalled();
    expect(paper).not.toHaveBeenCalled();
    expect(boxes.get(ANSWERS_BLOCK_ID)!.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
    expect(boxes.get(ANSWERS_BLOCK_ID)!.classes.size).toBeGreaterThan(0);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("goes to the paper's page at the block when it is not on this page", () => {
    const { doc } = pageWith([]);
    const navigate = vi.fn();
    goToPassage(ANSWERS_ANCHOR, { doc, navigate });
    expect(navigate).toHaveBeenCalledWith("/papers/p1#answers-block");
  });

  it("stays on the reading page when the answers are gone from it: the page is registered, so there is nowhere else to go", () => {
    const { doc } = pageWith([]);
    off.push(registerPassageHost({ paperId: "p1", reveal: (run) => run() }));
    const navigate = vi.fn();
    goToPassage(ANSWERS_ANCHOR, { doc, navigate });
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("goToPassage — a paragraph of the paper is as it was", () => {
  it("asks the paper's host, not the Summary's", () => {
    const { boxes, doc } = pageWith(["paper-section-1-p0"]);
    const summary = vi.fn((run: () => void) => run());
    const paper = vi.fn((run: () => void) => run());
    off.push(registerSummaryHost({ paperId: "p1", reveal: summary }), registerPassageHost({ paperId: "p1", reveal: paper }));
    goToPassage(PAPER_ANCHOR, { doc, navigate: vi.fn() });
    expect(paper).toHaveBeenCalledTimes(1);
    expect(summary).not.toHaveBeenCalled();
    expect(boxes.get("paper-section-1-p0")!.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("asks the paper's host for an id of the form P11-14 had to leave behind too (`paper-section--1-p-1`): nothing is classified as a Summary by guessing", () => {
    const { doc } = pageWith([]);
    const summary = vi.fn((run: () => void) => run());
    const paper = vi.fn((run: () => void) => run());
    off.push(registerSummaryHost({ paperId: "p1", reveal: summary }), registerPassageHost({ paperId: "p1", reveal: paper }));
    goToPassage(anchorAt("paper-section--1-p-1"), { doc, navigate: vi.fn() });
    expect(paper).toHaveBeenCalledTimes(1);
    expect(summary).not.toHaveBeenCalled();
  });
});

describe("registerSummaryHost", () => {
  it("takes the host off again, and an older registration's cleanup leaves a newer host alone", () => {
    const { doc } = pageWith([SUMMARY_ANCHOR.paragraphId]);
    const first = vi.fn((run: () => void) => run());
    const second = vi.fn((run: () => void) => run());
    const stopFirst = registerSummaryHost({ paperId: "p1", reveal: first });
    const stopSecond = registerSummaryHost({ paperId: "p1", reveal: second });
    stopFirst();
    goToPassage(SUMMARY_ANCHOR, { doc, navigate: vi.fn() });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    stopSecond();
    const navigate = vi.fn();
    goToPassage(SUMMARY_ANCHOR, { doc: pageWith([]).doc, navigate });
    expect(second).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});

describe("useSummaryHost — the page's side", () => {
  let onSummary: boolean;
  let showSummary: ReturnType<typeof vi.fn>;
  const mount = (paperId = "p1") => {
    const mounted = stagedRuntime.mount(() => useSummaryHost({ paperId, onSummary, showSummary: showSummary as unknown as () => void }));
    stagedRuntime.flush();
    off.push(mounted.unmount);
    return mounted;
  };
  /** The page has re-rendered with the tab it was told to show; the passive effects of that commit run. */
  const rerender = () => {
    stagedRuntime.rerender();
    stagedRuntime.flush();
  };

  beforeEach(() => {
    onSummary = false;
    showSummary = vi.fn(() => {
      onSummary = true;
    });
  });

  it("brings the Summary tab back for a note's square, and runs the jump once the Summary is on the page", () => {
    const { boxes, doc } = pageWith([SUMMARY_ANCHOR.paragraphId]);
    mount();
    goToPassage(SUMMARY_ANCHOR, { doc, navigate: vi.fn() });
    expect(showSummary).toHaveBeenCalledTimes(1);
    // The tab has been asked for but not drawn: the block is not on the page yet, so nothing has been scrolled.
    expect(boxes.get(SUMMARY_ANCHOR.paragraphId)!.scrollIntoView).not.toHaveBeenCalled();
    rerender();
    expect(boxes.get(SUMMARY_ANCHOR.paragraphId)!.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(boxes.get(SUMMARY_ANCHOR.paragraphId)!.classes.size).toBeGreaterThan(0);
    // Taken once: the next render of the Summary jumps nowhere.
    rerender();
    rerender();
    expect(boxes.get(SUMMARY_ANCHOR.paragraphId)!.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("jumps at once, with no tab switch, when the Summary is on show already (and for a paper with no body, which has no tabs)", () => {
    onSummary = true;
    const { boxes, doc } = pageWith([SUMMARY_ANCHOR.paragraphId]);
    mount();
    goToPassage(SUMMARY_ANCHOR, { doc, navigate: vi.fn() });
    expect(showSummary).not.toHaveBeenCalled();
    expect(boxes.get(SUMMARY_ANCHOR.paragraphId)!.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("does not jump when the Summary comes on show by the reader's own pick: there is no jump waiting", () => {
    const { boxes, doc } = pageWith([SUMMARY_ANCHOR.paragraphId]);
    mount();
    onSummary = true;
    rerender();
    expect(boxes.get(SUMMARY_ANCHOR.paragraphId)!.scrollIntoView).not.toHaveBeenCalled();
    expect(doc).toBeDefined();
  });

  it("registers for its paper and unregisters with the page", () => {
    const { doc } = pageWith([SUMMARY_ANCHOR.paragraphId]);
    const mounted = mount("p2");
    goToPassage(SUMMARY_ANCHOR, { doc, navigate: vi.fn() }); // an anchor of p1: not this page's
    expect(showSummary).not.toHaveBeenCalled();
    mounted.unmount();
    goToPassage({ ...SUMMARY_ANCHOR, paperId: "p2" }, { doc, navigate: vi.fn() });
    expect(showSummary).not.toHaveBeenCalled();
  });
});
