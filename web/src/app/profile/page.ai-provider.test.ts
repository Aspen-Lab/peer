import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultProfile } from "@/types";
import { remoteProfilePayload, type AuthOutcome } from "@/components/profile-sync";
import { keyHomeText, showKeySignInNote } from "@/components/profile/ai-setup";
import { useProfileStore } from "@/store/profile";

// The Profile's "AI provider" row. A model runs on the reader's own key only
// while they are signed in, and the key lives in this browser alone: it is never
// synced, so it does not come with the account to another device. The row now
// says both. The key field's own note ("Peer uses your key only while you are
// signed in.", ai-setup.tsx) is tested with the component; this pins the row's
// copy and its wiring. The page renders inside a store and a router, which this
// repo cannot render headlessly, so the row is read from the source, as
// page.test.tsx reads the Paper screening row.

const source = readFileSync(join(process.cwd(), "src/app/profile/page.tsx"), "utf8");
const rowStart = source.indexOf('label="AI provider"');
const row = source.slice(rowStart, source.indexOf("</EditRow>", rowStart));

/**
 * The row's JSX text as a reader may read it: comments and tags out, a
 * condition's `{cond && (` and `)}` out (the text inside it stays), spaces
 * collapsed.
 */
const textOf = (jsx: string) =>
  jsx
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\{[^{}]*&&\s*\(/g, " ")
    .replace(/\)\}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const rowText = textOf(row);

const WHERE_THE_KEY_LIVES =
  "Your key stays in this browser only. Peer passes it on to the provider you choose and never stores it on its server, so the key does not follow your account to another device or browser: there, paste it again. Signing out removes it from this browser.";
// L2-fix item 5 (R14; L2-A D4): a copy with no sign-in has no account and no signing out.
const WHERE_THE_KEY_LIVES_NO_SIGN_IN =
  "Your key stays in this browser only. Peer passes it on to the provider you choose and never stores it on its server.";
const SIGN_IN_LINE = "Sign in under Account at the top of this page.";
const OUTCOMES: AuthOutcome[] = ["unknown", "signed-in", "signed-out", "unconfigured"];

/** The row's text as it reads in one sign-in state: the paragraph's expression filled in. */
const rowTextFor = (outcome: AuthOutcome) => textOf(row.replace("{keyHomeText(authOutcome)}", keyHomeText(outcome)));

describe("Profile page - the AI provider row says where the key lives", () => {
  it("control: the row is found, holds the key fields, and writes the paragraph from the page's auth outcome", () => {
    expect(rowStart).toBeGreaterThan(-1);
    expect(row).toContain("<AiKeyFields");
    expect(row.split("{keyHomeText(authOutcome)}")).toHaveLength(2);
    expect(source).toMatch(/import \{[^}]*\bkeyHomeText\b[^}]*\} from "@\/components\/profile\/ai-setup"/);
  });

  it.each(["unknown", "signed-in", "signed-out"] as const)(
    "%s: says the key stays in this browser, does not follow the account, and goes on sign-out",
    (outcome) => {
      expect(keyHomeText(outcome)).toBe(WHERE_THE_KEY_LIVES);
      expect(rowTextFor(outcome)).toContain(WHERE_THE_KEY_LIVES);
    },
  );

  it("no sign-in on this copy (unconfigured): keeps the browser and provider sentences, drops the account and the sign-out", () => {
    expect(keyHomeText("unconfigured")).toBe(WHERE_THE_KEY_LIVES_NO_SIGN_IN);
    expect(rowTextFor("unconfigured")).toContain(WHERE_THE_KEY_LIVES_NO_SIGN_IN);
    expect(keyHomeText("unconfigured")).not.toMatch(/account|sign(ing|ed)? (out|in)/i);
    // The row's only other sign-in words are the Account line, which is not drawn here.
    for (const provider of ["gemini", "openai", "default"] as const) {
      expect(showKeySignInNote(provider, "unconfigured")).toBe(false);
    }
  });

  it.each(OUTCOMES)("%s: says each thing once (the old 'stays in this browser' sentence is merged, not repeated)", (outcome) => {
    const text = rowTextFor(outcome);
    expect(text.split("stays in this browser")).toHaveLength(2);
    expect(text.split("passes it on to the provider")).toHaveLength(2);
    expect(text).not.toContain("does not keep it");
  });

  it("keeps the opening paragraph about the reading without a model", () => {
    expect(rowText).toContain(
      "Peer has no model of its own. Add your own key to turn on ranking by a model, relevance reasons and reports. Without one, Peer shows the reading without a model and makes no AI call.",
    );
  });

  it("names no plan, tier, price or abbreviation", () => {
    for (const outcome of OUTCOMES) {
      expect(rowTextFor(outcome)).not.toMatch(/Tier [012]|BYOK|quota|allowance|upgrade|paid|price/i);
    }
  });
});

describe("Profile page - the AI provider row tells a signed-out reader where to sign in", () => {
  it("has the line, after the key fields, inside the row", () => {
    expect(rowText).toContain(SIGN_IN_LINE);
    expect(row.indexOf(SIGN_IN_LINE)).toBeGreaterThan(row.indexOf("<AiKeyFields"));
  });

  it("shows it exactly when the key field's own note shows: a company chosen and the reader signed out", () => {
    const gate = row.indexOf("showKeySignInNote(profile.feedAiProvider, authOutcome) && (");
    expect(gate).toBeGreaterThan(-1);
    expect(row.indexOf(SIGN_IN_LINE)).toBeGreaterThan(gate);
    expect(source).toMatch(/import \{[^}]*\bshowKeySignInNote\b[^}]*\} from "@\/components\/profile\/ai-setup"/);
    // The same auth signal as the Deep report row below it.
    expect(source).toMatch(/const authOutcome = useSyncGate\(\(st\) => st\.authOutcome\);/);
  });

  it("is true: the page mounts the Account section, with the sign-in buttons, before the view and the edit rows", () => {
    const account = source.indexOf("<AccountSection");
    expect(account).toBeGreaterThan(-1);
    expect(source.split("<AccountSection")).toHaveLength(2);
    expect(account).toBeLessThan(source.indexOf("<DashboardView"));
    expect(account).toBeLessThan(source.indexOf("<EditView"));
  });
});

describe("what the row says about the key is true in code", () => {
  // An invented string, not a real key.
  const KEY = "zQ7vXk9LmW3RtB5nHc1JdY8fPa4GgS2eUo6iNq0A";

  it("the key never travels with the synced profile, so it cannot follow the account", () => {
    const payload = remoteProfilePayload({ ...defaultProfile, feedAiProvider: "gemini", feedAiApiKey: KEY });
    expect(payload).not.toHaveProperty("feedAiApiKey");
    expect(JSON.stringify(payload)).not.toContain(KEY);
  });

  it("a confirmed sign-out (logOut) removes the key from this browser's profile", () => {
    useProfileStore.setState({ profile: { ...defaultProfile, feedAiProvider: "gemini", feedAiApiKey: KEY } });
    useProfileStore.getState().logOut();
    expect(useProfileStore.getState().profile.feedAiApiKey ?? "").toBe("");
    expect(useProfileStore.getState().profile.feedAiProvider).toBe("default");
  });
});
