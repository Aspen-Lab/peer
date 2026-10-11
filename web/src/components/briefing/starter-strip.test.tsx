import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// P7-16 (R12): the sample card on the home page had one way into the longer
// setup, an 11.5px grey "is here." at the bottom of a sentence, and no word
// anywhere about a key. It now has two real buttons. Rendered to static
// markup, like the rest of the briefing's components (this repo has no DOM).

const profileState = vi.hoisted(() => ({
  updateTopics: vi.fn(),
  completeOnboarding: vi.fn(),
}));

vi.mock("@/store/profile", () => ({
  useProfileStore: (selector?: (state: typeof profileState) => unknown) =>
    selector ? selector(profileState) : profileState,
}));

import { STARTER_TOPICS } from "@/lib/feed/starter-topics";
import { ADD_KEY_HREF } from "@/lib/navigation/add-key-destination";
import { StarterStrip } from "./starter-strip";

const html = renderToStaticMarkup(createElement(StarterStrip));

/** The opening tag and the text of the one link whose text is `label`. */
function linkLabelled(label: string): { tag: string; text: string } | null {
  for (const match of html.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/g)) {
    const text = match[2].replace(/<[^>]*>/g, "").trim();
    if (text === label) return { tag: match[1], text };
  }
  return null;
}

describe("StarterStrip — the buttons (P7-16, R12)", () => {
  it("has a 'Set up Peer' button that goes to the walkthrough", () => {
    const link = linkLabelled("Set up Peer");
    expect(link).not.toBeNull();
    expect(link!.tag).toContain('href="/welcome"');
  });

  it("has an 'Add a key' button that goes to the key step, by the shared constant", () => {
    const link = linkLabelled("Add a key");
    expect(link).not.toBeNull();
    expect(link!.tag).toContain(`href="${ADD_KEY_HREF}"`);
    expect(ADD_KEY_HREF).toBe("/welcome?step=ai");
  });

  it("they are real buttons on the card's own hairline, not running text", () => {
    for (const label of ["Set up Peer", "Add a key"]) {
      const { tag } = linkLabelled(label)!;
      expect(tag).toContain("h-10");
      expect(tag).toContain("shadow-[inset_0_0_0_1px_var(--color-border-strong)]");
      expect(tag).not.toContain("underline");
    }
  });

  it("the old grey 'is here.' link is gone, and the card links to the wizard only through the two buttons", () => {
    expect(html).not.toContain("is here.");
    const hrefs = [...html.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs.sort()).toEqual(["/welcome", ADD_KEY_HREF].sort());
  });
});

describe("StarterStrip — what it already did, unchanged", () => {
  it("offers the six fields as buttons, and a field of the reader's own", () => {
    for (const topic of STARTER_TOPICS) expect(html).toContain(`<span class="truncate">${topic}</span>`);
    expect(STARTER_TOPICS).toHaveLength(6);
    expect(html).toContain('aria-label="or type your field"');
    expect(html).toContain('aria-label="Use this"');
  });

  it("still says the papers are a sample", () => {
    expect(html).toContain("A sample, until you say otherwise");
  });
});
