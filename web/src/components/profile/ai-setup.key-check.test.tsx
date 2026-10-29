import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { UserAiProvider } from "@/types";
import type { AuthOutcome } from "@/components/profile-sync";

// "Check key" is mounted in `AiKeyFields`, under the key field, so it shows wherever a
// reader chooses a company and pastes a key: Profile ("AI provider") and the Welcome
// "AI" step. With "No AI" there is no key field, and no button.
//
// zustand's hook reads `getInitialState()` under renderToStaticMarkup, so this fakes
// only the hook's reading of `useSyncGate` (as `ai-setup.sign-in.test.tsx` does) and
// keeps the rest of the real module.

const h = vi.hoisted(() => ({ authOutcome: "unknown" as AuthOutcome }));

vi.mock("@/components/profile-sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/profile-sync")>();
  const hook = (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = { ...actual.useSyncGate.getState(), authOutcome: h.authOutcome };
    return selector ? selector(state) : state;
  };
  return { ...actual, useSyncGate: Object.assign(hook, actual.useSyncGate) };
});

import { AiKeyFields, KEY_SIGN_IN_NOTE } from "./ai-setup";
import { KEY_CHECK_COPY } from "./key-check";

const COMPANIES: UserAiProvider[] = ["gemini", "openai", "qwen", "anthropic", "deepseek"];
// An invented 40-character string, not a key.
const KEY = "Vq3Zr8Tm1Xw6Ky0Pj5Hs2Ln9Bd4Fg7Cx3Mz8Rt1W";

function markup(
  provider: UserAiProvider,
  apiKey: string,
  authOutcome: AuthOutcome = "signed-in",
  extra: { idPrefix?: string; emphasized?: boolean } = {},
): string {
  h.authOutcome = authOutcome;
  return renderToStaticMarkup(
    createElement(AiKeyFields, {
      provider,
      apiKey,
      onProviderChange: () => {},
      onApiKeyChange: () => {},
      ...extra,
    }),
  );
}

function buttonDisabled(html: string): boolean {
  const button = /<button[^>]*id="[^"]*-check-key"[^>]*>/.exec(html)?.[0] ?? "";
  return /\sdisabled=""/.test(button);
}

describe("AiKeyFields — the Check key button sits under the key field", () => {
  it.each(COMPANIES)("%s: the button is there, after the key input", (provider) => {
    const html = markup(provider, KEY);
    const input = html.indexOf('id="ai-key"');
    const button = html.indexOf(`>${KEY_CHECK_COPY.button}</button>`);
    expect(input).toBeGreaterThan(0);
    expect(button).toBeGreaterThan(input);
    expect(html).toContain('id="ai-check-key"');
    expect(html).toContain(KEY_CHECK_COPY.note);
  });

  it("is absent with No AI, where there is no key field", () => {
    const html = markup("default", "");
    expect(html).not.toContain('id="ai-key"');
    expect(html).not.toContain(KEY_CHECK_COPY.button);
    expect(html).not.toContain("check-key");
  });

  it("comes after the sign-in note when the reader is signed out; the note, not a second line, says why it cannot be pressed", () => {
    const html = markup("openai", KEY, "signed-out");
    const note = html.indexOf(KEY_SIGN_IN_NOTE);
    expect(note).toBeGreaterThan(0);
    expect(html.indexOf(`>${KEY_CHECK_COPY.button}</button>`)).toBeGreaterThan(note);
    expect(buttonDisabled(html)).toBe(true);
    expect(html).not.toContain(KEY_CHECK_COPY["signed-out"]);
  });

  it("can be pressed for a signed-in reader with a key typed, and not with the key field empty", () => {
    expect(buttonDisabled(markup("gemini", KEY, "signed-in"))).toBe(false);
    expect(buttonDisabled(markup("gemini", "", "signed-in"))).toBe(true);
  });

  it("takes the field's id prefix, so the Welcome step's ids do not clash with the Profile's", () => {
    const html = markup("openai", KEY, "signed-in", { idPrefix: "welcome-ai", emphasized: true });
    expect(html).toContain('id="welcome-ai-key"');
    expect(html).toContain('id="welcome-ai-check-key"');
    expect(html).not.toContain('id="ai-check-key"');
  });

  it("renders no 4-character slice of the key, in any sign-in state", () => {
    expect(KEY).toHaveLength(40);
    for (const authOutcome of ["unknown", "signed-in", "signed-out", "unconfigured"] as const) {
      const html = markup("anthropic", KEY, authOutcome);
      // The key field itself holds the value; everything the Check key block renders must not.
      const block = html.slice(html.lastIndexOf("<div", html.indexOf('id="ai-check-key"')));
      expect(block).toContain(KEY_CHECK_COPY.button);
      for (let i = 0; i + 4 <= KEY.length; i += 1) expect(block).not.toContain(KEY.slice(i, i + 4));
    }
  });
});
