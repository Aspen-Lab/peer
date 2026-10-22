import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P11-55 (round 4, Theme A reader r1 X2; ruling §1h.160): an EMPTY question bar shows no clipped line, at any text step.
// The bar stays one row while it is empty (`fitHeight`); the textarea is `font-reading text-body`, which the text steps scale
// (`--reading-scale`, 0.85 to 1.6). At 1.6 on the 416-px column (1024 x 768, 1093 x 614) the placeholder is wider than the
// row, wraps, and its second line was cut through the middle at the bar's border. The rule: the placeholder is whole on its
// one row, or cut at the row's end with an ellipsis; no part of a second line shows.
//
// No DOM here, so what is pinned is what the markup asks of the browser: the textarea's classes are compiled by Tailwind
// itself, and the rules they make are read. A browser measured it (Chromium 141, the five windows, light and dark, both
// tabs, every step): `::placeholder { white-space: nowrap }` keeps the placeholder to one row; `overflow: hidden` and
// `text-overflow: ellipsis` on it cut that row with an ellipsis, but Chromium takes the placeholder's `text-overflow` only
// while the textarea's own is not `clip`, so the textarea says `ellipsis` too, and only while its placeholder is shown
// (`:placeholder-shown`), so a typed question is laid out exactly as before. Every placeholder is invented here.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compile } from "tailwindcss";
import { defaultProfile } from "@/types";
import { useProfileStore } from "@/store/profile";
import { useReadingQuestionsStore } from "@/store/reading-questions";
import { ASK } from "./copy";
import { QuestionField } from "./question-field";

const PAPER = "openalex:W9055";
const AT = "2026-10-21T00:00:00.000Z";

beforeEach(() => {
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
  useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
  useProfileStore.setState({ profile: { ...defaultProfile } });
});
afterEach(() => vi.unstubAllGlobals());

const render = () => renderToStaticMarkup(createElement(QuestionField, { paperId: PAPER, examples: [] }));
const textarea = (html: string) => /<textarea[^>]*>/.exec(html)![0];
const classesOf = (tag: string) => (/\sclass="([^"]*)"/.exec(tag)?.[1] ?? "").split(/\s+/).filter(Boolean);

/** What Tailwind makes of these classes: the declarations of each rule, by the selector nested under the class (`&::placeholder`)
 *  or `""` for the class's own. */
async function rulesOf(classes: string[]): Promise<Record<string, string[]>> {
  const css = (await compile("@tailwind utilities;")).build(classes);
  const out: Record<string, string[]> = {};
  const nested = /&([^{]+)\{([^}]*)\}/g;
  for (const m of css.matchAll(nested)) (out[m[1].trim()] ??= []).push(...m[2].split(";").map((d) => d.trim().replace(/\s+/g, " ")).filter(Boolean));
  const own = css.replace(nested, "").matchAll(/\{([^{}]*)\}/g);
  for (const m of own) (out[""] ??= []).push(...m[1].split(";").map((d) => d.trim().replace(/\s+/g, " ")).filter(Boolean));
  return out;
}

describe("the empty bar's placeholder never shows a clipped second line (P11-55, §1h.160)", () => {
  it("keeps the placeholder to its one row: ::placeholder is nowrap, hidden past its box, cut with an ellipsis", async () => {
    const rules = await rulesOf(classesOf(textarea(render())));
    expect(rules["::placeholder"]).toEqual(expect.arrayContaining(["white-space: nowrap", "overflow: hidden", "text-overflow: ellipsis"]));
  });

  it("asks the textarea for the ellipsis only while its placeholder is shown, so a typed question is untouched", async () => {
    const rules = await rulesOf(classesOf(textarea(render())));
    expect(rules[":placeholder-shown"]).toEqual(["text-overflow: ellipsis"]);
    // Nothing unscoped about wrapping on the textarea: typed text still wraps and grows (`fitHeight`).
    const own = (rules[""] ?? []).join(";");
    expect(own).not.toMatch(/white-space|text-overflow|text-wrap|word-break|overflow-wrap/);
  });

  it("is the same textarea, with the same classes, when the placeholder is the gist's", async () => {
    useReadingQuestionsStore.getState().set(PAPER, [], true, AT);
    const area = textarea(render());
    expect(area).toContain(`placeholder="${ASK.chips.gist}"`);
    const rules = await rulesOf(classesOf(area));
    expect(rules["::placeholder"]).toEqual(expect.arrayContaining(["white-space: nowrap", "overflow: hidden", "text-overflow: ellipsis"]));
    expect(rules[":placeholder-shown"]).toEqual(["text-overflow: ellipsis"]);
  });

  it("changes nothing else the bar had: one row, the muted ink, the data mark, the combobox role", () => {
    const area = textarea(render());
    expect(area).toContain('rows="1"');
    expect(area).toContain('data-ask-line=""');
    expect(area).toContain('role="combobox"');
    expect(classesOf(area)).toEqual(expect.arrayContaining(["placeholder:text-text-muted", "font-reading", "text-body", "overflow-hidden", "resize-none", "min-w-0", "flex-1"]));
  });
});
