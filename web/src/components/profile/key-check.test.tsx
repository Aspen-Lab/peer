import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserAiProvider } from "@/types";
import type { AuthOutcome } from "@/components/profile-sync";
import {
  KEY_CHECK_COPY,
  KeyCheck,
  KeyCheckView,
  canCheckKey,
  keyCheckLine,
  requestKeyCheck,
  type KeyCheckStatus,
} from "./key-check";

// An invented 40-character string. It is not, and never was, a key.
const KEY = "kc-sentinel-NOT-A-KEY-0123456789abcdefgh";

/** The visible text of rendered markup: tags removed, entities decoded, whitespace collapsed. */
function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function view(
  overrides: Partial<{
    provider: UserAiProvider;
    apiKey: string;
    authOutcome: AuthOutcome;
    status: KeyCheckStatus;
  }> = {},
): string {
  return renderToStaticMarkup(
    createElement(KeyCheckView, {
      provider: "openai",
      apiKey: KEY,
      authOutcome: "signed-in",
      status: "idle",
      onCheck: () => {},
      ...overrides,
    }),
  );
}

function buttonDisabled(markup: string): boolean {
  const button = /<button[^>]*>/.exec(markup)?.[0] ?? "";
  return /\sdisabled=""/.test(button);
}

/** Every 4-character slice of the key that appears in the markup. */
function keySlicesIn(markup: string): string[] {
  const found: string[] = [];
  for (let i = 0; i + 4 <= KEY.length; i += 1) {
    const slice = KEY.slice(i, i + 4);
    if (markup.includes(slice)) found.push(slice);
  }
  return found;
}

const ANSWERS = ["ok", "rejected", "no-credit", "busy", "limited", "signed-out", "unreachable", "error"] as const;
const STATUSES: KeyCheckStatus[] = ["idle", "checking", ...ANSWERS];
const AUTH: AuthOutcome[] = ["unknown", "signed-in", "signed-out", "unconfigured"];

describe("KeyCheckView — the button, the note and the line", () => {
  it("is a button labelled Check key, with the note about what a check sends beside it", () => {
    const markup = view();
    expect(KEY_CHECK_COPY.button).toBe("Check key");
    expect(markup).toMatch(/<button[^>]*type="button"[^>]*>Check key<\/button>/);
    expect(visibleText(markup)).toContain(
      "Checking sends one short request to the provider, which may bill it to your key.",
    );
    // The note describes the button for a screen reader too.
    expect(markup).toContain('aria-describedby="ai-check-key-note"');
    expect(markup).toContain('id="ai-check-key-note"');
  });

  it.each([
    ["ok", "This key works."],
    ["rejected", "The provider did not accept this key."],
    ["no-credit", "This key works, but the provider says its account has no credit left."],
    // R2-fix item 4 — CHANGED: was "The provider is busy right now. Try again in a minute."
    ["busy", "The provider is turning requests away for now. Try again later."],
    ["limited", "Too many checks this hour. Try again later."],
    ["signed-out", "Sign in to check your key."],
    ["unreachable", "Could not reach the provider just now. Try again."],
    ["error", "The provider answered with an error. Check the key and your account on the provider's site."],
  ] as const)("says exactly what a '%s' answer means", (status, line) => {
    const markup = view({ status });
    expect(KEY_CHECK_COPY[status]).toBe(line);
    expect(keyCheckLine(status, "openai", "signed-in")).toBe(line);
    expect(markup).toContain(`<p id="ai-check-key-result" role="status" aria-live="polite"`);
    expect(visibleText(markup)).toContain(line);
  });

  it("tells the provider's own rate limit apart from this account's hourly limit", () => {
    expect(KEY_CHECK_COPY.busy).not.toBe(KEY_CHECK_COPY.limited);
    expect(KEY_CHECK_COPY.busy).toContain("The provider");
    expect(KEY_CHECK_COPY.limited).not.toContain("provider");
  });

  // R2-fix item 4: a limit on the key can reset well after a minute, so the line
  // names no wait it cannot know, and no number.
  it("the provider's 'busy' line promises no particular wait", () => {
    expect(KEY_CHECK_COPY.busy).not.toMatch(/minute|second|hour|\d/i);
    expect(KEY_CHECK_COPY.busy).toMatch(/Try again later\.$/);
  });

  it("says nothing before the first check, and that it is checking while it waits", () => {
    expect(keyCheckLine("idle", "openai", "signed-in")).toBeNull();
    const idle = visibleText(view({ status: "idle" }));
    for (const status of [...ANSWERS, "checking"] as const) expect(idle).not.toContain(KEY_CHECK_COPY[status]);
    expect(visibleText(view({ status: "checking" }))).toContain("Checking…");
  });

  it("shows one line at a time, and the result line holds nothing else", () => {
    for (const status of ANSWERS) {
      const result = /<p id="ai-check-key-result"[^>]*>([\s\S]*?)<\/p>/.exec(view({ status }))?.[1] ?? "";
      expect(visibleText(result)).toBe(KEY_CHECK_COPY[status]);
    }
  });

  // L2-fix item 4 (R14; L3-A D6, director note N3): the reason the button is disabled for a reader
  // confirmed signed out already stands beside it (the key field's note on Profile, the sign-in block
  // above it on the welcome "AI" step), so this line does not say it a third time.
  it("adds no line for a reader confirmed signed out: the button is disabled and the reason is beside it", () => {
    const markup = view({ authOutcome: "signed-out" });
    expect(buttonDisabled(markup)).toBe(true);
    expect(visibleText(markup)).not.toContain("Sign in to check your key.");
    expect(keyCheckLine("idle", "gemini", "signed-out")).toBeNull();
    // An earlier answer, given while signed in, goes with the sign-out.
    expect(visibleText(view({ authOutcome: "signed-out", status: "ok" }))).not.toContain(KEY_CHECK_COPY.ok);
    expect(keyCheckLine("ok", "gemini", "signed-out")).toBeNull();
  });

  it.each(AUTH)("says 'Sign in to check your key.' after Peer's own 401, whatever the page thought (%s)", (authOutcome) => {
    expect(keyCheckLine("signed-out", "gemini", authOutcome)).toBe("Sign in to check your key.");
    expect(visibleText(view({ authOutcome, status: "signed-out" }))).toContain("Sign in to check your key.");
  });

  it("says nothing extra while the sign-in check has not answered, or with no company chosen", () => {
    const unknown = visibleText(view({ authOutcome: "unknown" }));
    expect(buttonDisabled(view({ authOutcome: "unknown" }))).toBe(true);
    for (const status of ANSWERS) expect(unknown).not.toContain(KEY_CHECK_COPY[status]);
    expect(keyCheckLine("idle", "default", "signed-out")).toBeNull();
    expect(keyCheckLine("idle", "openai", "unknown")).toBeNull();
    expect(keyCheckLine("idle", "openai", "unconfigured")).toBeNull();
  });

  it("uses the field's id prefix, so two mounts on one page do not share ids", () => {
    const markup = view({ status: "ok" });
    const welcome = renderToStaticMarkup(
      createElement(KeyCheckView, {
        provider: "openai",
        apiKey: KEY,
        authOutcome: "signed-in",
        status: "ok",
        onCheck: () => {},
        idPrefix: "welcome-ai",
      }),
    );
    expect(markup).toContain('id="ai-check-key"');
    expect(welcome).toContain('id="welcome-ai-check-key"');
    expect(welcome).toContain('id="welcome-ai-check-key-result"');
    expect(welcome).not.toContain('id="ai-check-key"');
  });
});

describe("KeyCheckView — when the button can be pressed", () => {
  it("can be pressed with a provider, a key, and a sign-in the route accepts", () => {
    expect(buttonDisabled(view({ authOutcome: "signed-in" }))).toBe(false);
    expect(buttonDisabled(view({ authOutcome: "unconfigured" }))).toBe(false);
  });

  it("cannot be pressed before the sign-in state is known, or signed out", () => {
    expect(buttonDisabled(view({ authOutcome: "unknown" }))).toBe(true);
    expect(buttonDisabled(view({ authOutcome: "signed-out" }))).toBe(true);
  });

  it("cannot be pressed with no provider chosen, or no key typed", () => {
    expect(buttonDisabled(view({ provider: "default" }))).toBe(true);
    expect(buttonDisabled(view({ apiKey: "" }))).toBe(true);
    expect(buttonDisabled(view({ apiKey: "   \n " }))).toBe(true);
  });

  it("cannot be pressed again while a check is out, and says it is busy", () => {
    const markup = view({ status: "checking" });
    expect(buttonDisabled(markup)).toBe(true);
    expect(markup).toContain('aria-busy="true"');
    expect(view({ status: "ok" })).not.toContain("aria-busy");
  });

  it("can be pressed again after an answer, to check once more", () => {
    for (const status of ANSWERS) {
      expect(buttonDisabled(view({ status }))).toBe(false);
    }
  });

  it("canCheckKey holds the same rule", () => {
    const providers: UserAiProvider[] = ["default", "gemini", "openai", "qwen", "anthropic", "deepseek"];
    for (const provider of providers) {
      for (const authOutcome of AUTH) {
        const expected = provider !== "default" && (authOutcome === "signed-in" || authOutcome === "unconfigured");
        expect(canCheckKey(provider, KEY, authOutcome)).toBe(expected);
        expect(canCheckKey(provider, " ", authOutcome)).toBe(false);
      }
    }
  });
});

describe("KeyCheckView and KeyCheck — never render any part of the key", () => {
  it("has no 4-character slice of the key in the markup, in any state", () => {
    expect(KEY).toHaveLength(40);
    for (const status of STATUSES) {
      for (const authOutcome of AUTH) {
        expect(keySlicesIn(view({ status, authOutcome })), `${status} / ${authOutcome}`).toEqual([]);
      }
    }
  });

  it("the wrapper renders the same, with no slice of the key", () => {
    const markup = renderToStaticMarkup(createElement(KeyCheck, { provider: "openai", apiKey: KEY }));
    expect(markup).toContain(">Check key</button>");
    expect(keySlicesIn(markup)).toEqual([]);
  });
});

describe("requestKeyCheck — the request, and what each answer becomes", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const reply = (status: number, body: unknown) =>
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));

  it("posts the provider and the key in the body to /api/ai/check-key, and the key is not in the address", async () => {
    reply(200, { result: "ok" });

    await requestKeyCheck("gemini", KEY);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/ai/check-key");
    expect(url).not.toContain(KEY.slice(0, 8));
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ provider: "gemini", apiKey: KEY });
    expect(init.cache).toBe("no-store");
  });

  it.each(["ok", "rejected", "no-credit", "busy", "unreachable", "error"] as const)("passes the route's '%s' through", async (result) => {
    reply(200, { result });
    expect(await requestKeyCheck("openai", KEY)).toBe(result);
  });

  it("reads the route's own 429 (this account's hourly limit) as limited, not as the provider being busy", async () => {
    reply(429, { error: "AI request limit reached. Try again later." });
    expect(await requestKeyCheck("openai", KEY)).toBe("limited");
  });

  it("reads the route's own 401 (signed out since the page loaded) as signed-out", async () => {
    reply(401, { error: "Sign in before using an AI feature" });
    expect(await requestKeyCheck("openai", KEY)).toBe("signed-out");
  });

  it.each([
    ["a 400", 400, { error: "invalid_request" }],
    ["a 500", 500, {}],
    ["a 503", 503, { error: "AI features require sign-in configuration" }],
  ])("reads %s as unreachable", async (_name, status, body) => {
    reply(status, body);
    expect(await requestKeyCheck("openai", KEY)).toBe("unreachable");
  });

  it("reads an answer that is not one of the route's words as unreachable", async () => {
    reply(200, { result: "maybe" });
    expect(await requestKeyCheck("openai", KEY)).toBe("unreachable");
    reply(200, {});
    expect(await requestKeyCheck("openai", KEY)).toBe("unreachable");
    fetchSpy.mockResolvedValueOnce(new Response("", { status: 200 }));
    expect(await requestKeyCheck("openai", KEY)).toBe("unreachable");
  });

  it("reads a network failure as unreachable, without throwing", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await requestKeyCheck("openai", KEY)).toBe("unreachable");
  });
});

describe("KeyCheck — the wrapper (source)", () => {
  const source = readFileSync(path.join(process.cwd(), "src/components/profile/key-check.tsx"), "utf8");

  it("reads the sign-in state from the sync gate, as the Jev key row does", () => {
    expect(source).toContain("useSyncGate((s) => s.authOutcome)");
  });

  it("clears the result when the provider or the key changes, and drops an answer for a key the field no longer holds", () => {
    expect(source).toContain("if (!current) setState({ provider, apiKey, status: \"idle\" });");
    expect(source).toContain("setState((now) => (now === started ? { ...started, status: result } : now));");
  });

  it("writes no log line and keeps nothing in browser storage", () => {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/console\.|localStorage|sessionStorage|indexedDB/);
  });
});
