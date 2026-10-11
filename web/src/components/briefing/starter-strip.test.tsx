import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// P7-16 (R12): the sample card on the home page had one way into the longer
// setup, an 11.5px grey "is here." at the bottom of a sentence, and no word
// anywhere about a key. It now has two real buttons. Rendered to static
// markup, like the rest of the briefing's components (this repo has no DOM).
//
// P7-16c (§1h.35 (d)): "Add a key" is offered only while there is no key. The
// store stand-in below carries a `profile` for the card to read; the predicate
// itself (`hasUserLlmOverride`) is the real one, the same the key hint reads.

const profileState = vi.hoisted(() => ({
  updateTopics: vi.fn(),
  completeOnboarding: vi.fn(),
  profile: {} as Record<string, unknown>,
}));

vi.mock("@/store/profile", () => ({
  useProfileStore: (selector?: (state: typeof profileState) => unknown) =>
    selector ? selector(profileState) : profileState,
}));

import { STARTER_TOPICS } from "@/lib/feed/starter-topics";
import { ADD_KEY_HREF } from "@/lib/navigation/add-key-destination";
import { defaultProfile } from "@/types";
import { StarterStrip } from "./starter-strip";

/** The card as a reader with this profile sees it. */
function renderFor(patch: Record<string, unknown> = {}): string {
  profileState.profile = { ...defaultProfile, ...patch };
  return renderToStaticMarkup(createElement(StarterStrip));
}

/** A reader with no key: what every test below this line that does not say otherwise reads. */
const html = renderFor();

/** The opening tag and the text of the one link in `markup` whose text is `label`. */
function linkLabelledIn(markup: string, label: string): { tag: string; text: string } | null {
  for (const match of markup.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/g)) {
    const text = match[2].replace(/<[^>]*>/g, "").trim();
    if (text === label) return { tag: match[1], text };
  }
  return null;
}

const linkLabelled = (label: string) => linkLabelledIn(html, label);

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

// P7-16c (§1h.35 (d)): a reader who has added a key and then comes back to the
// card (a key typed in the wizard, no field chosen) was still offered "Add a
// key". The button goes once a key exists; "Set up Peer" stays, and so does
// everything else on the card.
describe("StarterStrip — 'Add a key' only while there is no key (P7-16c, §1h.35 (d))", () => {
  const withKey = { feedAiProvider: "openai", feedAiApiKey: "an-invented-key-for-the-test" };

  it("with no key both buttons render", () => {
    expect(linkLabelledIn(renderFor(), "Set up Peer")).not.toBeNull();
    expect(linkLabelledIn(renderFor(), "Add a key")).not.toBeNull();
  });

  it("with a key only 'Set up Peer' renders", () => {
    const keyed = renderFor(withKey);
    expect(linkLabelledIn(keyed, "Set up Peer")!.tag).toContain('href="/welcome"');
    expect(linkLabelledIn(keyed, "Add a key")).toBeNull();
    expect(keyed).not.toContain("Add a key");
    expect(keyed).not.toContain(ADD_KEY_HREF);
    const hrefs = [...keyed.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(["/welcome"]);
  });

  it.each([
    ["a blank key", { feedAiProvider: "openai", feedAiApiKey: "   " }],
    ["an empty key", { feedAiProvider: "openai", feedAiApiKey: "" }],
    ["a key under the default provider", { feedAiProvider: "default", feedAiApiKey: "an-invented-key" }],
  ])("%s is no key: both buttons still render", (_name, patch) => {
    const markup = renderFor(patch);
    expect(linkLabelledIn(markup, "Set up Peer")).not.toBeNull();
    expect(linkLabelledIn(markup, "Add a key")).not.toBeNull();
  });

  it("the rest of the card does not change with a key: the sample line, the six fields, the field of one's own", () => {
    const keyed = renderFor(withKey);
    expect(keyed).toContain("A sample, until you say otherwise");
    for (const topic of STARTER_TOPICS) expect(keyed).toContain(`<span class="truncate">${topic}</span>`);
    expect(keyed).toContain('aria-label="or type your field"');
    expect(keyed).toContain('aria-label="Use this"');
  });

  it("reads the key with the same predicate as the key hint row: one source of truth", () => {
    const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
    const card = read("src/components/briefing/starter-strip.tsx");
    const row = read("src/components/briefing/key-hint.tsx");
    for (const source of [card, row]) {
      expect(source).toContain('import { hasUserLlmOverride } from "@/lib/feed/ai-tier";');
      expect(source).toMatch(/useProfileStore\(\(s\) => hasUserLlmOverride\(s\.profile\)\)/);
    }
  });
});
