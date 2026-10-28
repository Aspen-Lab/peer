// OWN-KEY lane 4 — the AI row of the wizard's closing summary. A reader with a
// saved key who is not signed in used to read "No key — reading without a
// model", which was false.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultProfile, type UserProfile } from "@/types";
import { aiStepSummary } from "./summary";

const keyed: UserProfile = { ...defaultProfile, feedAiProvider: "gemini", feedAiApiKey: "user-owned-test-key" };

describe("aiStepSummary", () => {
  it("a saved key, signed out: names the provider and says to sign in", () => {
    expect(aiStepSummary(keyed, "signed-out")).toBe("Gemini key saved — sign in to use it");
  });

  // L4-fix (director note N1) — CHANGED: this was "reads the same" as signed
  // out. While the check has not answered the reader may be signed in, so the
  // line states the fact and gives no instruction.
  it("a saved key while the sign-in check is unknown: 'key saved', and no 'sign in'", () => {
    expect(aiStepSummary(keyed, "unknown")).toBe("Gemini key saved");
    expect(aiStepSummary(keyed, "unknown")).not.toMatch(/sign in/i);
    expect(aiStepSummary({ ...keyed, feedAiProvider: "deepseek" }, "unknown")).toBe("DeepSeek key saved");
  });

  it("a saved key, signed in: connected, unchanged", () => {
    expect(aiStepSummary(keyed, "signed-in")).toBe("Gemini key connected");
  });

  it("a saved key where sign-in is not configured: connected, unchanged", () => {
    expect(aiStepSummary(keyed, "unconfigured")).toBe("Gemini key connected");
  });

  it("names whichever provider is saved", () => {
    expect(aiStepSummary({ ...keyed, feedAiProvider: "openai" }, "signed-out")).toBe(
      "OpenAI key saved — sign in to use it",
    );
  });

  it("no key: reading without a model, signed in or not, unchanged", () => {
    for (const auth of ["signed-in", "signed-out", "unknown", "unconfigured"] as const) {
      expect(aiStepSummary(defaultProfile, auth)).toBe("No key — reading without a model");
    }
  });

  it("a provider picked with no key pasted, or a blank key, is still no key", () => {
    expect(aiStepSummary({ ...defaultProfile, feedAiProvider: "gemini" }, "signed-out")).toBe(
      "No key — reading without a model",
    );
    expect(aiStepSummary({ ...keyed, feedAiApiKey: "   " }, "signed-in")).toBe(
      "No key — reading without a model",
    );
  });

  it("never prints any piece of the key", () => {
    const KEY = "qW8eR2tY6uI4oP0aS9dF3gH7jK1lZ5xC2vB8nM4Q";
    const line = aiStepSummary({ ...keyed, feedAiApiKey: KEY }, "signed-out");
    for (let i = 0; i + 4 <= KEY.length; i++) expect(line).not.toContain(KEY.slice(i, i + 4));
  });

  it("is what the wizard's summary row uses (source)", () => {
    const page = readFileSync(join(process.cwd(), "src/app/welcome/page.tsx"), "utf8");
    expect(page).toMatch(/case "ai":\s*return aiStepSummary\(profile, auth\);/);
  });
});

// R2-fix item 3 — at 375 px the review list cut its value with an ellipsis, so
// the AI row read "Gemini key saved — sign in t…" and lost the instruction. The
// value cell now wraps: a long value takes a second line. The list lives inside
// the page, which this repo cannot render headlessly, so the cell's classes are
// read from the source, the way the page's other tests read it.
describe("the review list's value cell wraps instead of cutting the text", () => {
  const page = readFileSync(join(process.cwd(), "src/app/welcome/page.tsx"), "utf8");
  const list = page.slice(page.indexOf("function ReviewList("), page.indexOf("function summarizeStep("));
  const cell = list.match(/<span className="([^"]*)">\s*\{row\.summary\}\s*<\/span>/);

  it("control: the cell holding {row.summary} is found inside ReviewList", () => {
    expect(list.length).toBeGreaterThan(0);
    expect(cell).not.toBeNull();
  });

  it("breaks long words and wraps: no truncate, no whitespace-nowrap, no ellipsis, no line clamp", () => {
    const classes = (cell?.[1] ?? "").split(/\s+/);
    expect(classes).toContain("break-words");
    expect(classes).toContain("min-w-0"); // lets the flex child shrink so the text can wrap
    for (const cut of ["truncate", "whitespace-nowrap", "text-ellipsis", "overflow-hidden"]) {
      expect(classes).not.toContain(cut);
    }
    expect(classes.some((c) => c.startsWith("line-clamp"))).toBe(false);
  });

  it("the row that motivated it is whole: the signed-out AI summary keeps its instruction", () => {
    expect(aiStepSummary(keyed, "signed-out")).toBe("Gemini key saved — sign in to use it");
  });
});
