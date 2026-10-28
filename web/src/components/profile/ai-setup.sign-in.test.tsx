import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { UserAiProvider } from "@/types";
import type { AuthOutcome } from "@/components/profile-sync";

// A model runs on the reader's own key only while they are signed in
// (`aiAvailability`: a confirmed sign-out is "none" whatever key is saved). The
// Profile's Deep report row and the Jev field already say so; the model-key field
// said nothing, so a signed-out reader could paste a key and believe AI was on.
// `AiKeyFields` (Profile and the welcome wizard) now says it under the key field.
//
// zustand's React hook reads `getInitialState()` under renderToStaticMarkup (the
// server snapshot), so a `setState` before rendering never reaches the markup
// (see app/profile/reading-card.test.tsx). This fakes only the hook's reading of
// `useSyncGate` and keeps the rest of the real module.

const h = vi.hoisted(() => ({ authOutcome: "unknown" as AuthOutcome }));

vi.mock("@/components/profile-sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/profile-sync")>();
  const hook = (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = { ...actual.useSyncGate.getState(), authOutcome: h.authOutcome };
    return selector ? selector(state) : state;
  };
  return { ...actual, useSyncGate: Object.assign(hook, actual.useSyncGate) };
});

import { AiKeyFields, KEY_SIGN_IN_NOTE, showKeySignInNote } from "./ai-setup";

const OUTCOMES: AuthOutcome[] = ["unknown", "signed-in", "signed-out", "unconfigured"];
const COMPANIES: UserAiProvider[] = ["gemini", "openai", "qwen", "anthropic", "deepseek"];
// An invented string, not a real key.
const KEY = "zQ7vXk9LmW3RtB5nHc1JdY8fPa4GgS2eUo6iNq0A";

/** What a reader reads: tags and React's text-node comments out, entities decoded. */
function textOf(html: string): string {
  return html
    .replace(/<!--.*?-->/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function view(
  authOutcome: AuthOutcome,
  provider: UserAiProvider,
  apiKey: string,
  variant: "profile" | "welcome" = "profile",
): string {
  h.authOutcome = authOutcome;
  return textOf(
    renderToStaticMarkup(
      createElement(AiKeyFields, {
        provider,
        apiKey,
        onProviderChange: () => {},
        onApiKeyChange: () => {},
        idPrefix: variant === "welcome" ? "welcome-ai" : "profile-ai",
        emphasized: variant === "welcome",
        showRegistrationLink: variant === "welcome",
      }),
    ),
  );
}

describe("the model-key sign-in note - the words", () => {
  it("is one plain sentence", () => {
    expect(KEY_SIGN_IN_NOTE).toBe("Peer uses your key only while you are signed in.");
  });

  it("names no plan, tier, price or abbreviation", () => {
    expect(KEY_SIGN_IN_NOTE).not.toMatch(/Tier|BYOK|plan|upgrade|free|paid|price|quota|allowance/i);
  });
});

describe("showKeySignInNote - when the note stands", () => {
  it.each(COMPANIES)("signed out, %s chosen: shown", (provider) => {
    expect(showKeySignInNote(provider, "signed-out")).toBe(true);
  });

  it("signed out, no company chosen (no key field): not shown", () => {
    expect(showKeySignInNote("default", "signed-out")).toBe(false);
  });

  it.each(OUTCOMES.filter((outcome) => outcome !== "signed-out"))(
    "%s: never shown, whatever company is chosen (the key is used, or it is not yet known)",
    (outcome) => {
      for (const provider of ["default", ...COMPANIES] as UserAiProvider[]) {
        expect(showKeySignInNote(provider, outcome)).toBe(false);
      }
    },
  );
});

describe("AiKeyFields - the note under the key field", () => {
  it("control: the faked sign-in state reaches the component", () => {
    expect(view("signed-out", "gemini", "")).toContain(KEY_SIGN_IN_NOTE);
    expect(view("signed-in", "gemini", "")).not.toContain(KEY_SIGN_IN_NOTE);
  });

  it.each(COMPANIES)("signed out with %s chosen: shown once, with or without a key typed", (provider) => {
    for (const apiKey of ["", KEY]) {
      const text = view("signed-out", provider, apiKey);
      expect(text).toContain(KEY_SIGN_IN_NOTE);
      expect(text.split(KEY_SIGN_IN_NOTE)).toHaveLength(2);
    }
  });

  it("stands after the key field, not before it", () => {
    const text = view("signed-out", "gemini", "");
    expect(text.indexOf("API key")).toBeGreaterThan(-1);
    expect(text.indexOf(KEY_SIGN_IN_NOTE)).toBeGreaterThan(text.indexOf("API key"));
  });

  it("the welcome wizard's emphasized panel says it too", () => {
    expect(view("signed-out", "openai", "", "welcome")).toContain(KEY_SIGN_IN_NOTE);
    expect(view("signed-in", "openai", "", "welcome")).not.toContain(KEY_SIGN_IN_NOTE);
  });

  it("signed out with no company chosen: no key field, so no note", () => {
    const text = view("signed-out", "default", "");
    expect(text).not.toContain("API key");
    expect(text).not.toContain(KEY_SIGN_IN_NOTE);
  });

  it.each(OUTCOMES.filter((outcome) => outcome !== "signed-out"))("%s: no note, with or without a key", (outcome) => {
    for (const provider of COMPANIES) {
      expect(view(outcome, provider, "")).not.toContain(KEY_SIGN_IN_NOTE);
      expect(view(outcome, provider, KEY)).not.toContain(KEY_SIGN_IN_NOTE);
    }
  });

  it("never prints the key in the text a reader reads", () => {
    expect(view("signed-out", "gemini", KEY)).not.toContain(KEY);
  });

  it("reads the same signal the Deep report row and the Jev field read (useSyncGate's authOutcome)", () => {
    const source = readFileSync(join(process.cwd(), "src/components/profile/ai-setup.tsx"), "utf8");
    expect(source).toMatch(/useSyncGate\(\(s\) => s\.authOutcome\)/);
  });
});
