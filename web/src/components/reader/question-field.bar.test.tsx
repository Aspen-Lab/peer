import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P10-03 (round P10, ruling §1h.78; the owner's review of 2026-10-13, points 2.2–2.7; rubric A1–A5, A7):
// the question field is ONE search bar labelled "What you want to learn about this paper:". One
// question, never a second line, Enter submits; a 2-px border in the heading ink on a raised surface,
// one row of at least 48 px, the Submit control inside its right end; the suggestions are a dropdown
// that is open under the bar while the field has focus and the question is not settled, and closed
// otherwise. No DOM here: the markup is checked by rendering, the gestures by a scripted reader on the
// minimal hook runtime (`test-support/question-session.ts`). Every question is invented.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultProfile } from "@/types";
import { useProfileStore } from "@/store/profile";
import { MAX_QUESTION_CHARS, useReadingQuestionsStore } from "@/store/reading-questions";
import { check, enter, focus, key, leave, optionTexts, pick, session, submit, type, wait, type Step, type SessionProps } from "@/test-support/question-session";
import { ASK, STANDING } from "./copy";
import { QuestionField, dropdownOpen, enterAction, moveActive, suggestionItems, chipGroups } from "./question-field";

const PAPER = "openalex:W9001";
const AT = "2026-10-14T00:00:00.000Z";
const A = "How do the plating variables set the grain structure of LCO?";
const B = "Which bath temperature gives the densest film?";
const EARLIER = "Why does the anode crack?";
const PROFILE_Q = "Does this help with dendrite growth?";
const STANDING_Q = "What limits the cycle life?";
const EXAMPLES = [
  { label: ASK.fromEarlier, items: [EARLIER] },
  { label: ASK.fromProfile, items: [PROFILE_Q] },
];

const render = (props: Partial<SessionProps> = {}) =>
  renderToStaticMarkup(createElement(QuestionField, { paperId: PAPER, examples: props.examples ?? [], standing: props.standing, vague: props.vague }));
const run = (script: Step[], props: Partial<SessionProps> = {}) => session(script, { paperId: PAPER, ...props });
const stored = () => useReadingQuestionsStore.getState().byPaper[PAPER];

beforeEach(() => {
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
  useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
  useProfileStore.setState({ profile: { ...defaultProfile } });
});
afterEach(() => vi.unstubAllGlobals());

describe("the label (A2, review 2.4)", () => {
  it("reads exactly 'What you want to learn about this paper:' and names the bar", () => {
    expect(ASK.heading).toBe("What you want to learn about this paper:");
    const html = render();
    expect(html).toMatch(/<label[^>]*for="ask-openalex:W9001-0"[^>]*>(?:<span[^>]*><\/span>)?What you want to learn about this paper:<\/label>/);
    expect(html).toContain('id="ask-openalex:W9001-0"');
  });

  it("the old label appears nowhere in the field, its copy or its hint", () => {
    const old = ["Before", "you read"].join(" ");
    expect(render({ examples: EXAMPLES, standing: [STANDING_Q] })).not.toContain(old);
    expect(JSON.stringify(ASK)).not.toContain(old);
    expect(STANDING.hint).not.toContain(old);
    expect(STANDING.hint).toContain("listed under the question bar");
  });
});

describe("one question, one bar (A3, A4, review 2.5, 2.6)", () => {
  it("holds exactly one textarea, one row, with the shared limit, however many questions are stored", () => {
    useReadingQuestionsStore.setState({
      byPaper: { [PAPER]: { items: [A, B, "A third question?", "A fourth question?", "A fifth question?"], gist: false, updatedAt: AT } },
      lastPaperId: PAPER,
    });
    const html = render();
    const areas = html.match(/<textarea[^>]*>/g) ?? [];
    expect(areas).toHaveLength(1);
    expect(areas[0]).toContain('rows="1"');
    expect(areas[0]).toContain(`maxLength="${MAX_QUESTION_CHARS}"`);
    expect(areas[0]).toContain('data-ask-line=""');
    // The first stored question is the one shown; the others are not drawn anywhere.
    expect(html).toContain(`>${A}</textarea>`);
    for (const other of [B, "A third question?", "A fourth question?", "A fifth question?"]) expect(html).not.toContain(other);
  });

  it("has no second line, no ×, no checkbox, no '(Up to) five questions' and no per-question control", () => {
    useReadingQuestionsStore.getState().set(PAPER, [A], false, AT);
    const html = render({ examples: EXAMPLES });
    expect(html).not.toContain("<input");
    expect(html).not.toContain("×");
    expect(html).not.toMatch(/five questions/i);
    expect(html).not.toContain(["Not for", "recommendations"].join(" "));
    expect(html).not.toContain("<ol");
    expect(html).not.toContain("<li");
    expect(JSON.stringify(ASK)).not.toMatch(/five|Not for\s+recommendations/i);
    expect(Object.keys(ASK)).not.toEqual(expect.arrayContaining(["line", "remove", "notForRecs", "notForRecsFor"]));
  });

  it("is a search bar: bordered 2 px in the heading ink, raised, at least 48 px, full width, with the Submit control inside its right end", () => {
    const html = render();
    const bar = /<div data-ask-bar=""[^>]*class="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(bar).toMatch(/\bborder-2\b/);
    expect(bar).toMatch(/\bborder-heading\b/);
    expect(bar).toMatch(/\bbg-surface\b/);
    expect(bar).toMatch(/\bmin-h-12\b/);
    expect(bar).toMatch(/\bflex\b/);
    // The bar is the full width of the column: a block-level flex box with no max-width of its own.
    expect(bar).not.toMatch(/\bmax-w-|\bw-fit\b|\binline-flex\b/);
    // The Submit control is a button in the bar, after the textarea, and the bar closes right after it:
    // it is not a row under the bar.
    expect(html).toMatch(/<div data-ask-bar=""[^>]*><textarea[^>]*><\/textarea><button[^>]*>Submit<\/button><\/div>/);
  });

  it("the placeholder is in the muted ink, not the faint one", () => {
    const area = /<textarea[^>]*>/.exec(render())![0];
    expect(area).toContain(`placeholder="${ASK.placeholder}"`);
    expect(area).toMatch(/placeholder:text-text-muted/);
    expect(area).not.toMatch(/placeholder:text-text-faint/);
  });

  it("the field's border and surface stand out from the page in light and dark (A1; measured from the tokens in globals.css)", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const hexes = (token: string) => [...css.matchAll(new RegExp(`--color-${token}:\\s*(#[0-9a-fA-F]{6})`, "g"))].map((m) => m[1]);
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (x: string, y: string) => {
      const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
      return (hi + 0.05) / (lo + 0.05);
    };
    // Four declarations each: the light :root, its restatement, the dark media block, the dark restatement.
    for (const [theme, at] of [["light", 0], ["dark", 2]] as const) {
      const heading = hexes("heading")[at];
      const bg = hexes("bg")[at];
      const surface = hexes("surface")[at];
      expect(heading, theme).toBeDefined();
      // The bar's ground is not the page's ground, and its 2-px edge is the strongest ink: 3:1 or more against the page.
      expect(surface.toLowerCase(), theme).not.toBe(bg.toLowerCase());
      expect(contrast(heading, bg), theme).toBeGreaterThanOrEqual(3);
      expect(contrast(heading, surface), theme).toBeGreaterThanOrEqual(3);
    }
    expect(hexes("heading")[0]).toBe(hexes("heading")[1]);
    expect(hexes("heading")[2]).toBe(hexes("heading")[3]);
  });

  it("Enter submits the question; Shift+Enter is no different; a pasted newline is folded", async () => {
    const prevented = { count: 0 };
    await run([
      type(`${A}\nAnd at 55 C?`),
      check(() => expect(stored().items).toEqual([`${A} And at 55 C?`])),
      key("Enter", { shiftKey: true }, prevented),
      check((view) => {
        expect(stored().settled).toEqual([`${A} And at 55 C?`]);
        expect(prevented.count).toBe(1);
        expect(view.inputs).toHaveLength(1);
      }),
    ]);
    // …and plain Enter does the same.
    useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
    await run([type(A), enter, check(() => expect(stored().settled).toEqual([A]))]);
  });

  it("Enter during an input-method composition is not a submit", async () => {
    await run([type(A), key("Enter", { nativeEvent: { isComposing: true } }), check(() => expect(stored().settled).toBeUndefined())]);
  });

  it("Enter with nothing in the bar and nothing submitted does nothing", async () => {
    await run([enter, check(() => expect(stored()).toBeUndefined())]);
  });

  it("shows its count from 401 characters", () => {
    for (const [n, shown] of [[400, false], [401, true]] as const) {
      useReadingQuestionsStore.getState().set(PAPER, ["q".repeat(n)], false, AT);
      expect(render().includes(ASK.counter(n))).toBe(shown);
    }
  });

  it("a reader who stored several questions sees the first; storage keeps the rest until the bar is first changed", async () => {
    const all = [A, B, "A third question?"];
    useReadingQuestionsStore.getState().set(PAPER, all, false, AT);
    await run([check((view) => expect(view.bar.props.value).toBe(A)), focus, leave, check(() => expect(stored().items).toEqual(all))]);
    await run([type(`${A} At 40 C?`), check(() => expect(stored().items).toEqual([`${A} At 40 C?`]))]);
  });

  it("Submit on such a paper makes the stored list the one question", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A, B, "A third question?"], false, AT);
    useReadingQuestionsStore.getState().settle(PAPER);
    await run([
      check((view) => expect(view.submit.props.disabled).toBe(false)),
      submit,
      check((view) => {
        expect(stored().items).toEqual([A]);
        expect(stored().settled).toEqual([A]);
        expect(view.submit.props.disabled).toBe(true);
      }),
    ]);
  });
});

describe("the suggestions are a dropdown (A5, review 2.7)", () => {
  const props = { examples: EXAMPLES, standing: [STANDING_Q] };

  it("lists nothing at rest: no listbox, no option, no group heading, no gist control", () => {
    useReadingQuestionsStore.getState().set(PAPER, [A], false, AT);
    for (const html of [render(props), render({ ...props, examples: [] })]) {
      expect(html).not.toContain('role="listbox"');
      expect(html).not.toContain('role="option"');
      for (const text of [ASK.fromEarlier, ASK.fromProfile, STANDING.chipGroup, EARLIER, PROFILE_Q, STANDING_Q]) expect(html).not.toContain(text);
      expect(html).not.toContain(`>${ASK.chips.gist}<`);
    }
    expect(render(props)).toContain('aria-expanded="false"');
  });

  it("the bar is a combobox for a screen reader: aria-expanded, aria-controls only while open, a hint read with it", async () => {
    const area = /<textarea[^>]*>/.exec(render(props))![0];
    expect(area).toContain('role="combobox"');
    expect(area).toContain('aria-autocomplete="list"');
    expect(area).not.toContain("aria-controls");
    expect(render(props)).toContain(`<p id="ask-openalex:W9001-hint" class="sr-only">${ASK.hint}</p>`);
    await run(
      [
        focus,
        type("g"),
        check((view) => {
          expect(view.bar.props["aria-expanded"]).toBe(true);
          expect(view.bar.props["aria-controls"]).toBe(view.listbox!.props.id);
        }),
      ],
      props,
    );
  });

  it("opens under the bar with the first typed character and nothing submitted: the groups as headings, the examples as options, the gist last and set apart", async () => {
    await run(
      [
        focus,
        // P10-21 re-aim (X-A6): the focused empty bar lists nothing; the first character opens the list.
        check((view) => expect(view.listbox).toBeUndefined()),
        type("g"),
        check((view) => {
          expect(view.listbox).toBeDefined();
          expect(view.listbox!.props["aria-label"]).toBe(ASK.suggestions);
          expect(view.headings).toEqual([STANDING.chipGroup, ASK.fromEarlier, ASK.fromProfile]);
          expect(optionTexts(view)).toEqual([STANDING_Q, EARLIER, PROFILE_Q, ASK.chips.gist]);
          const gist = view.options[view.options.length - 1];
          expect(gist.props["data-gist"]).toBe("");
          // Set apart: in a group of its own under a rule.
          const own = view.all.find((el) => el.props.role === "group" && el.props["aria-label"] === ASK.chips.gist)!;
          expect(String(own.props.className)).toMatch(/\bborder-t\b/);
          expect(view.options.slice(0, -1).every((option) => option.props["data-gist"] === undefined)).toBe(true);
        }),
      ],
      props,
    );
  });

  it("stays open while the reader types an unsettled question, and closes on Submit, on blur and on Escape", async () => {
    await run(
      [
        focus,
        type(A),
        check((view) => expect(view.listbox).toBeDefined()),
        submit,
        // After Submit the question is settled: nothing is listed, though the field still has focus.
        check((view) => {
          expect(view.listbox).toBeUndefined();
          expect(view.options).toHaveLength(0);
        }),
        type(`${A} At 50 C?`),
        check((view) => expect(view.listbox).toBeDefined()),
        key("Escape"),
        check((view) => expect(view.listbox).toBeUndefined()),
        type(`${A} At 60 C?`),
        check((view) => expect(view.listbox).toBeDefined()),
        leave,
        check((view) => expect(view.listbox).toBeUndefined()),
        focus,
        // Coming back to a question that was not submitted opens it again.
        check((view) => expect(view.listbox).toBeDefined()),
      ],
      props,
    );
  });

  it("is closed on a paper whose question was submitted until the text changes, and again when it is put back", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [A], false, AT);
    useReadingQuestionsStore.getState().settle(PAPER);
    await run(
      [
        focus,
        check((view) => expect(view.listbox).toBeUndefined()),
        type(`${A} x`),
        check((view) => expect(view.listbox).toBeDefined()),
        type(A),
        check((view) => expect(view.listbox).toBeUndefined()),
        type(""),
        // P10-21 re-aim (X-A6): cleared of a settled question the bar is empty again, and an empty bar lists nothing;
        // it was open ("something to send, so the suggestions help again") before the first character opened it.
        check((view) => expect(view.listbox).toBeUndefined()),
        type("g"),
        check((view) => expect(view.listbox).toBeDefined()),
      ],
      props,
    );
  });

  it("Down and Up move the highlight, wrapping through the bar itself; Enter on an item picks it and submits nothing", async () => {
    await run(
      [
        focus,
        type("g"),
        key("ArrowDown"),
        check((view) => {
          expect(view.options.map((o) => o.props["aria-selected"])).toEqual([true, false, false, false]);
          expect(view.bar.props["aria-activedescendant"]).toBe(view.options[0].props.id);
        }),
        key("ArrowDown"),
        key("ArrowDown"),
        key("ArrowDown"),
        check((view) => expect(view.options[3].props["aria-selected"]).toBe(true)),
        key("ArrowDown"),
        check((view) => {
          // Past the last item the highlight returns to the bar.
          expect(view.options.every((o) => o.props["aria-selected"] === false)).toBe(true);
          expect(view.bar.props["aria-activedescendant"]).toBeUndefined();
        }),
        key("ArrowUp"),
        check((view) => expect(view.options[3].props["aria-selected"]).toBe(true)),
        key("ArrowUp"),
        key("ArrowUp"),
        key("ArrowUp"),
        check((view) => expect(view.options[0].props["aria-selected"]).toBe(true)),
        key("ArrowDown"),
        enter,
        check((view) => {
          // The second item (the earlier question) is in the bar; nothing was submitted.
          expect(view.bar.props.value).toBe(EARLIER);
          expect(stored().items).toEqual([EARLIER]);
          expect(stored().settled).toBeUndefined();
          expect(view.listbox).toBeUndefined();
        }),
      ],
      props,
    );
  });

  it("Enter with nothing highlighted submits the typed question; the arrow keys are the reader's, not the page's, when nothing is listed", async () => {
    const prevented = { count: 0 };
    await run([focus, type(A), enter, check(() => expect(stored().settled).toEqual([A])), key("ArrowDown", {}, prevented), check(() => expect(prevented.count).toBe(0))], { examples: [] });
  });

  it("Escape closes the dropdown and Down opens it again", async () => {
    await run(
      [focus, type("g"), key("Escape"), check((view) => expect(view.listbox).toBeUndefined()), key("ArrowDown"), check((view) => expect(view.listbox).toBeDefined())],
      props,
    );
  });

  // The page's own Escape (`components/keyboard.tsx`, on `window`) blurs a field being typed in. The dropdown's Escape
  // closes the dropdown and stops there; Escape with nothing open is left to the page.
  it("the first Escape is the dropdown's (it stops there); with the dropdown closed Escape is left to the page", async () => {
    const stopped = { count: 0 };
    const key = (name: string): Step => ({ bar }) =>
      (bar.props.onKeyDown as (e: unknown) => void)({ key: name, preventDefault: () => {}, stopPropagation: () => void (stopped.count += 1) });
    await run(
      [
        focus,
        type("g"),
        key("Escape"),
        check((view) => {
          expect(view.listbox).toBeUndefined();
          expect(stopped.count).toBe(1);
        }),
        key("Escape"),
        check(() => expect(stopped.count).toBe(1)),
      ],
      props,
    );
  });

  it("keeps 'Just get the gist' in view: it is outside the scrolling list of examples, under a rule", async () => {
    await run(
      [
        focus,
        type("g"),
        check((view) => {
          const scroller = view.all.find((el) => String(el.props.className ?? "").includes("overflow-y-auto"))!;
          const inScroller = (node: unknown): boolean => JSON.stringify((node as { props?: unknown })?.props ?? {}, (k, v) => (k === "_owner" ? undefined : v)).includes("data-gist");
          expect(inScroller(scroller)).toBe(false);
          expect(view.options.at(-1)!.props["data-gist"]).toBe("");
          const listbox = String(view.listbox!.props.className);
          expect(listbox).toMatch(/\bflex-col\b/);
          expect(listbox).toMatch(/\bmax-h-80\b/);
        }),
      ],
      props,
    );
  });

  it("a pointer pick fills the bar, keeps focus in it (mouse down is not a blur) and submits nothing", async () => {
    const down = { prevented: 0 };
    await run(
      [
        focus,
        type("g"),
        ({ options }) => (options[2].props.onMouseDown as (e: unknown) => void)({ preventDefault: () => void (down.prevented += 1) }),
        pick(2),
        check((view) => {
          expect(down.prevented).toBe(1);
          expect(view.bar.props.value).toBe(PROFILE_Q);
          expect(stored().items).toEqual([PROFILE_Q]);
          expect(stored().settled).toBeUndefined();
          expect(view.submit.props.disabled).toBe(false);
          expect(view.listbox).toBeUndefined();
        }),
        type(`${PROFILE_Q} In air?`),
        check((view) => expect(view.listbox).toBeDefined()),
      ],
      props,
    );
  });

  it("a pick replaces what was typed and asks for the focus once, with the caret at the end (P9-19, P9-11)", async () => {
    // No DOM: the textarea is an object the ref callback is given, which records what is asked of it.
    const el = { value: "", focus: vi.fn(), setSelectionRange: vi.fn(), style: {}, scrollHeight: 0 };
    await run(
      [
        ({ bar }) => (bar.props.ref as (e: unknown) => void)(el),
        focus,
        type("Why"),
        ({ }) => void (el.value = EARLIER),
        // P10-11 re-aim (BACKLOG-72): "Why" now filters the dropdown to the one earlier question that holds it
        // (EARLIER, "Why does the anode crack?"), so it is the first item; it was the second of four, unfiltered.
        pick(0),
        check((view) => {
          expect(view.bar.props.value).toBe(EARLIER);
          expect(el.focus).toHaveBeenCalledTimes(1);
          expect(el.setSelectionRange).toHaveBeenCalledWith(EARLIER.length, EARLIER.length);
        }),
        // Later renders do not pull the focus back to the bar (the request fires once).
        leave,
        type(`${EARLIER} And at 50 C?`),
        wait(10),
        check(() => expect(el.focus).toHaveBeenCalledTimes(1)),
      ],
      props,
    );
  });

  it("picking 'Just get the gist' is the gist route: no text, the gist on, nothing submitted; again, off; typing turns it off", async () => {
    await run(
      [
        focus,
        type("g"),
        pick(3),
        check((view) => {
          expect(stored()).toEqual(expect.objectContaining({ items: [], gist: true }));
          expect(stored().settled).toBeUndefined();
          expect(view.bar.props.value).toBe("");
          // The bar says so: the gist stands where the placeholder stood.
          expect(view.bar.props.placeholder).toBe(ASK.chips.gist);
        }),
        // P10-21 re-aim (X-A6): a reader who focuses the (empty) bar again sees nothing listed; the list needs a first
        // character, and a typed character turns the gist off, so the dropdown never shows the gist as checked.
        // ("offered as a toggle, checked → pick again turns it off" was reachable only from the empty-bar list.)
        leave,
        focus,
        check((view) => expect(view.listbox).toBeUndefined()),
        type("g"),
        check((view) => {
          expect(view.options[3].props["aria-checked"]).toBe(false);
          expect(stored()).toEqual(expect.objectContaining({ items: ["g"], gist: false }));
        }),
        pick(3),
        check(() => expect(stored().gist).toBe(true)),
        type(A),
        check(() => expect(stored()).toEqual(expect.objectContaining({ items: [A], gist: false }))),
      ],
      props,
    );
  });

  it("a standing question that is the bar's text is not offered again, and a standing question is not also an earlier one", async () => {
    await run(
      [
        type(STANDING_Q),
        focus,
        check((view) => expect(optionTexts(view)).not.toContain(STANDING_Q)),
      ],
      { examples: [{ label: ASK.fromEarlier, items: [STANDING_Q, EARLIER] }], standing: [STANDING_Q] },
    );
    useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
    await run(
      [focus, type("g"), check((view) => expect(optionTexts(view).filter((t) => t === STANDING_Q)).toHaveLength(1))],
      { examples: [{ label: ASK.fromEarlier, items: [STANDING_Q, EARLIER] }], standing: [STANDING_Q] },
    );
  });

  it("is never filled in by itself: opening the page with standing questions and examples leaves the bar empty and stores nothing", async () => {
    await run([check((view) => expect(view.bar.props.value).toBe("")), focus, wait(10), check(() => expect(stored()).toBeUndefined())], props);
  });
});

describe("the pure rules of the dropdown", () => {
  it("is open with focus and a typed character unless settled, closed, or empty of items", () => {
    const base = { focused: true, text: A, settled: [] as string[], count: 3 };
    expect(dropdownOpen(base)).toBe(true);
    expect(dropdownOpen({ ...base, focused: false })).toBe(false);
    expect(dropdownOpen({ ...base, closed: true })).toBe(false);
    expect(dropdownOpen({ ...base, count: 0 })).toBe(false);
    expect(dropdownOpen({ ...base, settled: [A] })).toBe(false);
    expect(dropdownOpen({ ...base, settled: [`  ${A}  `.trim()], text: `  ${A}  ` })).toBe(false);
    expect(dropdownOpen({ ...base, settled: [B] })).toBe(true);
    // P10-21 re-aim (X-A6; it expected true for both): nothing typed lists nothing — with focus, with nothing submitted,
    // emptied after a submit, or holding only white space; the first character opens the list.
    expect(dropdownOpen({ ...base, text: "" })).toBe(false);
    expect(dropdownOpen({ ...base, text: "", settled: [A] })).toBe(false);
    expect(dropdownOpen({ ...base, text: "   " })).toBe(false);
    expect(dropdownOpen({ ...base, text: "g" })).toBe(true);
  });

  it("moves the highlight through the items and the bar, and wraps", () => {
    expect(moveActive(-1, 3, "ArrowDown")).toBe(0);
    expect(moveActive(2, 3, "ArrowDown")).toBe(-1);
    expect(moveActive(-1, 3, "ArrowUp")).toBe(2);
    expect(moveActive(0, 3, "ArrowUp")).toBe(-1);
    expect(moveActive(0, 0, "ArrowDown")).toBe(-1);
  });

  it("Enter picks a highlighted item of an open dropdown, and otherwise submits", () => {
    expect(enterAction(true, 1)).toBe("pick");
    expect(enterAction(true, -1)).toBe("submit");
    expect(enterAction(false, 1)).toBe("submit");
  });

  it("lists the groups' examples in order and the gist last, always", () => {
    expect(suggestionItems(chipGroups(EXAMPLES))).toEqual([
      { kind: "example", text: EARLIER },
      { kind: "example", text: PROFILE_Q },
      { kind: "gist", text: ASK.chips.gist },
    ]);
    expect(suggestionItems([])).toEqual([{ kind: "gist", text: ASK.chips.gist }]);
  });
});

describe("Submit (A7, §1h.77 (g))", () => {
  it("is in the bar at rest, grey and inert with nothing to send", async () => {
    expect(render()).toMatch(/<button[^>]*disabled=""[^>]*>Submit<\/button>/);
    await run([check((view) => expect(view.submit.props.disabled).toBe(true))]);
  });

  it("is enabled by a typed question, inert after the submit until the text changes, and a submit with the same text does nothing", async () => {
    let writes = 0;
    const stop = useProfileStore.subscribe((state, previous) => {
      if (state.profile.preferenceLedger !== previous.profile.preferenceLedger) writes += 1;
    });
    await run([
      type(A),
      check((view) => expect(view.submit.props.disabled).toBe(false)),
      submit,
      check((view) => {
        expect(stored().settled).toEqual([A]);
        expect(view.submit.props.disabled).toBe(true);
      }),
      // Enter with the same text, and the (inert) control's handler, change nothing.
      enter,
      submit,
      check(() => expect(writes).toBe(1)),
      type(`${A} `),
      check((view) => expect(view.submit.props.disabled).toBe(true)),
      type(`${A} At 50 C?`),
      check((view) => expect(view.submit.props.disabled).toBe(false)),
    ]);
    stop();
  });

  it("is styled grey when inert and inked when live, and keeps its 44-px floor on touch", () => {
    const button = /<button[^>]*>Submit<\/button>/.exec(render())![0];
    expect(button).toMatch(/\bbg-heading\b/);
    expect(button).toMatch(/disabled:bg-bg-secondary/);
    expect(button).toMatch(/disabled:text-text-faint/);
    expect(button).toMatch(/\[@media\(hover:none\)\]:min-h-11/);
    expect(button).toMatch(/\bannotation\b/);
  });
});
