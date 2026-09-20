import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ZERO_SCORES, type Persona } from "@/lib/persona/axes";

// 8-02/S24: PersonaResult calls useRouter() (for the new Esc-to-home
// effect) purely for its `.push` reference — renderToStaticMarkup never
// runs effects, but the hook itself throws without an AppRouterContext
// provider (confirmed by reading next/navigation's source: the context
// default is `null` and useRouter throws on that). Stubbed here rather
// than wrapping the render in a real provider, matching this repo's other
// page tests that stub the store instead of mounting real providers.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { PersonaResult } from "./result";

const persona: Persona = {
  name: "The Bench Operator",
  tagline: "Hands on the instrument, eyes on the data.",
  blurb: "You trust what you can measure.",
  look: "Lab coat, safety goggles pushed up, coffee gone cold.",
};

describe("PersonaResult", () => {
  it("renders two identical 'Back to main' links, top and bottom", () => {
    const html = renderToStaticMarkup(
      createElement(PersonaResult, { scores: ZERO_SCORES, persona, onRestart: () => {} }),
    );

    // Two <a> elements carry the aria-label (attribute occurrence); each
    // also renders the same string as its visible text (content
    // occurrence) — 4 total substring hits is the correct count for 2
    // links, not a duplicate-render bug.
    expect(html.split("← Back to main").length - 1).toBe(4);
    const tags = html.match(/<a\b[^>]*aria-label="← Back to main"[^>]*>/g) ?? [];
    expect(tags.length).toBe(2);
    // Both go home, with the identical label the spec requires.
    for (const tag of tags) expect(tag).toContain('href="/"');
  });
});
