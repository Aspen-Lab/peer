import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P9-52 (A P9-W3's N5, §6 item 5): on a phone (390 x 844, touch) the "Remove question N" × was 7 x 16 px and the
// "Not for recommendations" checkbox 13 x 13 px. Where there is no hover (`hover: none`) the × is a 44 x 44 target
// (a lone glyph: the floor in both directions) and the checkbox's row is at least 44 px tall (the label is the box,
// so a tap anywhere on the row ticks it; the checkbox itself stays the native 13 px control); with a mouse nothing
// moves. Layout is not computed in this node environment: the boxes are in the checkpoint
// (docs/reading-helper-abc/P9-52-C-*.md), and this file pins the classes that make them.
// No DOM: the field runs on the minimal hook runtime and its elements are read, as the sibling files do. Invented words.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import type { ReactElement, ReactNode } from "react";
import { hookRuntime } from "@/test-support/hook-runtime";
import { defaultProfile } from "@/types";
import { useProfileStore } from "@/store/profile";
import { useReadingQuestionsStore } from "@/store/reading-questions";
import { ASK } from "./copy";
import { QuestionField } from "./question-field";

const PAPER = "openalex:W52";
const AT = "2026-10-12T00:00:00.000Z";
const A = "Does a denser planting clean more water than sand?";
const B = "How long must the water stay inside a bed?";

type Props = Record<string, unknown> & { children?: ReactNode };
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props>;
  return [element, ...elements(element.props.children)];
}
const classesOf = (el: ReactElement<Props> | undefined) => String(el?.props.className ?? "").split(/\s+/).filter(Boolean);

async function field() {
  const mounted = await hookRuntime.mount(() => QuestionField({ paperId: PAPER, examples: [] }));
  const all = elements(mounted.value);
  const removes = all.filter((el) => el.type === "button" && String(el.props["aria-label"] ?? "").startsWith("Remove question"));
  const boxes = all.filter((el) => el.type === "input" && el.props.type === "checkbox");
  const rows = all.filter((el) => el.type === "label" && elements(el.props.children).some((c) => c.props.type === "checkbox"));
  return { mounted, all, removes, boxes, rows };
}

beforeEach(() => {
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
  useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
  useProfileStore.setState({ profile: { ...defaultProfile } });
  useReadingQuestionsStore.getState().set(PAPER, [A, B], false, AT);
});
afterEach(() => vi.unstubAllGlobals());

const TOUCH_H = "[@media(hover:none)]:min-h-11";
const TOUCH_W = "[@media(hover:none)]:min-w-11";

describe("the × beside a question is a 44 x 44 target where there is no hover (P9-52, N5)", () => {
  it("is at least 44 px tall and 44 px wide where there is no hover: a lone glyph, 7 px wide in the mouse's box", async () => {
    const { removes, mounted } = await field();

    expect(removes.map((el) => el.props["aria-label"])).toEqual([ASK.remove(1), ASK.remove(2)]);
    for (const el of removes) {
      expect(classesOf(el)).toContain(TOUCH_H);
      expect(classesOf(el)).toContain(TOUCH_W);
    }
    mounted.unmount();
  });

  it("is still the same glyph, the same name and the same quiet colour: only the hit area grew", async () => {
    const { removes, mounted } = await field();

    for (const el of removes) {
      expect(el.props.children).toBe("×");
      expect(el.props.type).toBe("button");
      expect(classesOf(el)).toEqual(expect.arrayContaining(["annotation", "shrink-0", "text-text-faint", "hover:text-heading"]));
    }
    mounted.unmount();
  });
});

describe("the 'Not for recommendations' row is a 44 px target where there is no hover (P9-52, N5)", () => {
  it("makes the row (the label that holds the checkbox) at least 44 px tall where there is no hover", async () => {
    const { rows, mounted } = await field();

    expect(rows).toHaveLength(2);
    for (const el of rows) {
      expect(JSON.stringify(el.props.children)).toContain(ASK.notForRecs);
      expect(classesOf(el)).toContain(TOUCH_H);
      // The row is the whole line's width already (`basis-full`), so the 44 px of width is there without a floor.
      expect(classesOf(el)).toContain("basis-full");
    }
    mounted.unmount();
  });

  it("leaves the checkbox the native control it was: no size, no restyle, the same name and state", async () => {
    const { boxes, mounted } = await field();

    expect(boxes).toHaveLength(2);
    for (const box of boxes) {
      expect(box.props.className).toBeUndefined();
      expect(box.props.checked).toBe(false);
    }
    expect(boxes.map((box) => box.props["aria-label"])).toEqual([ASK.notForRecsFor(1), ASK.notForRecsFor(2)]);
    mounted.unmount();
  });
});

describe("a mouse's question box is the one it was (P9-52, rule 2)", () => {
  it("has no height or width floor outside hover:none on the × or the row", async () => {
    const { removes, rows, mounted } = await field();

    for (const el of [...removes, ...rows]) {
      for (const cls of classesOf(el)) {
        if (/(^|:)(min-h|min-w|h|w)-/.test(cls)) expect(cls.startsWith("[@media(hover:none)]:"), cls).toBe(true);
      }
    }
    // The lines' own layout: one wrapping row per question, the textarea taking what is left.
    const items = elements(mounted.value).filter((el) => el.type === "li");
    expect(items.map((el) => el.props.className)).toEqual(Array(2).fill("flex flex-wrap items-baseline gap-2"));
    mounted.unmount();
  });
});
