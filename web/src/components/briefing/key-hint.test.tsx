import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// P7-16 (R12): the row that stays after the sample card is gone. Rendered to
// static markup (this repo has no DOM). The container reads the dismissal from
// the browser, which a server render has not got: there it renders nothing, so
// a reader who dismissed the row never sees it flash back in.

const profileState = vi.hoisted(() => ({
  profile: { feedAiProvider: "default", feedAiApiKey: "" },
}));

vi.mock("@/store/profile", () => ({
  useProfileStore: (selector?: (state: typeof profileState) => unknown) =>
    selector ? selector(profileState) : profileState,
}));

import { ADD_KEY_HREF } from "@/lib/navigation/add-key-destination";
import { KeyHint, KeyHintRow } from "./key-hint";

describe("KeyHintRow — one line, a link and a way out", () => {
  const html = renderToStaticMarkup(createElement(KeyHintRow, { onDismiss: () => {} }));

  it("says what the key is for, and the whole line is the link to the key step", () => {
    expect(html).toContain(`href="${ADD_KEY_HREF}"`);
    expect(html).toContain("Add a key to turn on the model");
    const anchor = html.match(/<a\b[^>]*>([\s\S]*?)<\/a>/);
    expect(anchor?.[1].replace(/<[^>]*>/g, "").trim()).toBe("Add a key to turn on the model");
  });

  it("can be dismissed, by a button with a name", () => {
    const button = html.match(/<button\b[^>]*>/);
    expect(button).not.toBeNull();
    expect(button![0]).toContain('type="button"');
    expect(button![0]).toContain('aria-label="Dismiss"');
  });

  it("is one line: a single row, no paragraphs", () => {
    expect(html).not.toMatch(/<p[\s>]/);
    expect(html).not.toContain("<br");
  });
});

describe("KeyHint — the container", () => {
  it("renders nothing on a server render, before the browser has been asked whether it was dismissed", () => {
    expect(renderToStaticMarkup(createElement(KeyHint))).toBe("");
  });
});

describe("the home page wires the card and the row to one place", () => {
  const page = readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf8");

  it("shows the card for the sample and the row once the sample is over", () => {
    expect(page).toMatch(/\{starter \? <StarterStrip \/> : <KeyHint \/>\}/);
  });
});
