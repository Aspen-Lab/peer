import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultProfile } from "@/types";
import { KEY_CHECK_COPY } from "@/components/profile/key-check";
import PrivacyPage from "./page";

/**
 * /privacy is "written from the code": every claim points at a table, a fetch or
 * a line. It changes in the same commit as the behaviour it describes, so these
 * cases pin the model-key claims to what the code does now.
 */

function text(): string {
  return renderToStaticMarkup(<PrivacyPage />)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ");
}

describe("/privacy after Peer stopped having a model of its own", () => {
  it("says Peer has no model of its own and that a model runs only on the reader's key", () => {
    expect(text()).toContain("Peer has no model of its own.");
    expect(text()).toContain("run only if you add your own provider key");
  });

  it("describes the path the key takes: browser, Peer's server, the chosen provider, not stored", () => {
    const page = text();
    expect(page).toContain("sends the request to Peer's server with your key attached");
    expect(page).toContain("passes it to the provider you chose");
    expect(page).toContain("is not stored");
    // Still true, and still the one line that keeps the key out of the sync.
    expect(page).toContain("void feedAiApiKey");
  });

  it("no longer claims a request goes to Google from Peer's own model", () => {
    const page = text();
    expect(page).not.toContain("When Peer's own model is used instead");
    expect(page).not.toContain("Google's Gemini API from Peer's server");
    expect(page).not.toContain("Google (Gemini) sees");
  });

  it("names the provider whose key you added, not a fixed company", () => {
    expect(text()).toContain("The model provider whose key you added sees");
  });

  it("says nothing about a record of model use, because Peer keeps none", () => {
    // There used to be a section for it ("What is recorded about model use"):
    // a row per model call in a usage table. The table, the writer and the
    // wrapper that fed it are deleted, so the section and every sentence that
    // named the row or "every call Peer pays for" are gone with them.
    const page = text();
    expect(page).not.toContain("What is recorded about model use");
    expect(page).not.toContain("Every call Peer pays for");
    expect(page).not.toContain("Every model call writes one row");
    expect(page).not.toContain("the usage row");
    expect(page).not.toContain("the row carries no account id");
    expect(page).not.toContain("no column that could hold one");
  });

  it("keeps the sections around it", () => {
    const page = text();
    expect(page).toContain("Your own model key");
    expect(page).toContain("Who else sees a request");
  });

  it("carries the date of this change", () => {
    // P4-00c (S2): this branch rewrote "Your questions" and "Explain this" on
    // 2026-10-07. Own-key lane 3 added "Check key" and where the key lives to
    // "Your own model key" on 2026-10-28, so the page carries that date now.
    expect(text()).toContain("Last changed 2026-10-28");
  });
});

/**
 * A reader's own Jev key. Jev is a bring-your-own-key option, so /privacy says
 * what the code does with it, in the same commit as the behaviour: where the key
 * lives, what leaves for Jev, and what Peer keeps. Every claim below is pinned to
 * the line that makes it true.
 */
describe("/privacy - your own Jev key", () => {
  const root = process.cwd();
  const read = (file: string) => readFileSync(join(root, file), "utf8");

  it("has a section 'Your own Jev key' right after 'Your own model key'", () => {
    const page = text();
    expect(page).toContain("Your own Jev key");
    expect(page.indexOf("Your own Jev key")).toBeGreaterThan(page.indexOf("Your own model key"));
    expect(page.indexOf("Your own Jev key")).toBeLessThan(page.indexOf("Who else sees a request"));
  });

  it("says the key stays in the browser, is kept out of everything synced, and is passed to Jev without being stored or logged", () => {
    const page = text();
    expect(page).toContain(
      "If you add a Jev key, it stays in your browser and is excluded from everything Peer syncs, the same way as a model key. Each time Peer builds your briefing its server passes the key to Jev, and does not store or log it.",
    );
  });

  it("says what Jev receives, who pays, and what Peer keeps of Jev's answers", () => {
    const page = text();
    expect(page).toContain(
      "Jev, made by TypeSafe, receives the title, abstract and venue of up to 50 candidate papers, together with the project, challenge, topics, methods and exclusions you wrote and the word meanings you selected, and bills your own account.",
    );
    expect(page).toContain(
      "Peer keeps Jev's answers for each paper against your account (the paper's id, the question, the answer, how sure Jev was, which Jev model answered, and how many tokens and how much time the call took), with no paper text and no key, until the account is removed.",
    );
  });

  it("adds the Jev sentence to 'Who else sees a request'", () => {
    expect(text()).toContain("Jev sees those papers and your project text only if you add a Jev key yourself.");
  });

  it("states no size for the improvement and no price", () => {
    const page = text();
    const jevSection = page.slice(page.indexOf("Your own Jev key"), page.indexOf("Who else sees a request"));
    expect(jevSection).not.toMatch(/\d+\s?%|percent|cents?\b|\$|\bbetter\b|sharper|faster/i);
  });

  // "Written from the code": each claim names a line that must stay true.
  it("is true to the code: the sync code voids the Jev key, the route reads it only from the request body into a closure, and the stored decision has no key field", () => {
    expect(read("src/components/profile-sync.tsx")).toContain("void jevApiKey;");

    const route = read("src/app/api/feed/route.ts");
    expect(route).toContain("parseJevApiKey((body as Record<string, unknown>).jevApiKey)");
    expect(route).not.toMatch(/console\./); // the feed route has no logging call at all

    // What Peer stores per paper: the decision payload. It has no key, no paper text.
    const types = read("src/lib/decisions/types.ts");
    const decisionResult = types.slice(types.indexOf("export interface DecisionResult"), types.indexOf("export interface DecisionProvider"));
    expect(decisionResult).not.toMatch(/apiKey|jevApiKey|title|abstract/);
    expect(read("src/lib/decisions/private-decision-cache.ts")).not.toMatch(/apiKey|jevApiKey/);

    // The sentence lists what is kept (N8b of the branch review): the paper's id, the
    // answers with their confidence, the model that answered, and the call's token
    // and time counts. Each is a field of the stored payload, and nothing else is.
    expect(decisionResult).toMatch(/paperId/);
    expect(decisionResult).toMatch(/answers/);
    expect(decisionResult).toMatch(/usage/);
    expect(decisionResult).toMatch(/modelId/);
    expect(types).toMatch(/interface DecisionUsage \{\s*inputTokens: number;\s*outputTokens: number;\s*latencyMs: number;\s*\}/);
    expect(types).toMatch(/confidence: number/);

    // What Jev receives includes the word meanings the reader selected (`senses`).
    const contract = read("src/lib/decisions/jev-contract.ts");
    expect(contract).toMatch(/senses: JevStateSense\[\]/);
    expect(contract).toMatch(/request\.senseConcepts\.map/);

    // Kept until the account is removed: the table cascades from the account.
    expect(read("supabase/migrations/20260924000400_private_decisions.sql")).toContain("on delete cascade");
  });

  it("says what the browser remembers about the last briefing: counts only, cleared when the key changes", () => {
    // The Profile row names what Jev did the last time (store/jev-screening.ts):
    // one status word and two counts, in this browser only. The page says so in
    // the same change as the behaviour.
    expect(text()).toContain(
      "Your browser also remembers, for the Profile page, how many papers Jev screened in your last briefing. It holds counts only, and it is cleared when you change or remove the key.",
    );
    const store = read("src/store/jev-screening.ts");
    expect(store).toContain('name: "peer-jev-screening"');
    expect(store).not.toMatch(/apiKey|jevApiKey|title|abstract/);
    const profile = read("src/store/profile.ts");
    expect(profile).toMatch(/updateJevApiKey:[\s\S]*useJevScreeningStore\.getState\(\)\.clear\(\)/);
    expect(profile).toMatch(/logOut:[\s\S]*useJevScreeningStore\.getState\(\)\.clear\(\)/);
  });

  it("keeps the sections around it and the date", () => {
    const page = text();
    expect(page).toContain("Your own model key");
    expect(page).toContain("Who else sees a request");
    expect(page).toContain("Last changed 2026-10-28");
  });
});

/**
 * "Check key", and where the key lives (own-key lane 3, 2026-10-28). Each sentence
 * the "Your own model key" section gained is pinned to the line that makes it
 * true, the same way as the Jev key above: read the source, assert the property.
 */
describe("/privacy - Check key and where the model key lives", () => {
  const root = process.cwd();
  const read = (file: string) => readFileSync(join(root, file), "utf8");
  /** Source with comments removed, so a sentence is pinned to code, not to a comment about it. */
  const code = (file: string) =>
    read(file)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const ROUTE = "src/app/api/ai/check-key/route.ts";
  const CHECK = "src/lib/llm/key-check.ts";

  const CHECK_SENTENCES =
    "If you press Check key, your browser sends the key to Peer's server, which makes one short request to that provider to see whether it accepts the key. Peer keeps neither the key nor the provider's answer. The server writes at most one log line for the check — the provider, the model, the token counts, how long it took and whether it worked — and never the key or anything you wrote.";
  const COUNT_SENTENCE =
    "If you are signed in, the server also counts this account's checks this hour, a number and nothing else, kept so the limit of ten checks an hour can hold.";
  const ACCOUNT_SENTENCE =
    "Your key does not travel with your account: Peer never stores it on its server, so on another device you add it again, and signing out removes it from this browser.";

  it("says both, in the model-key section, after the existing sentences (which stay)", () => {
    const page = text();
    const section = page.slice(page.indexOf("Your own model key"), page.indexOf("Your own Jev key"));
    for (const sentence of [CHECK_SENTENCES, COUNT_SENTENCE, ACCOUNT_SENTENCE]) expect(section).toContain(sentence);
    expect(section).toContain("void feedAiApiKey");
    expect(section).toContain("The key is used for that request and is not stored.");
    expect(section.indexOf(CHECK_SENTENCES)).toBeGreaterThan(section.indexOf("The key is used for that request"));
  });

  it("names the button by its own label, and the button's note says the same thing the page does", () => {
    // A label that changes in the component shows up here.
    expect(text()).toContain(`If you press ${KEY_CHECK_COPY.button}, your browser sends the key to Peer's server`);
    expect(KEY_CHECK_COPY.note).toContain("one short request to the provider");
    expect(CHECK_SENTENCES).toContain("one short request to that provider");
    // The button posts to the route these sentences are pinned to, and only there.
    const component = code("src/components/profile/key-check.tsx");
    expect(component.match(/apiFetch/g)?.length).toBeGreaterThan(0);
    expect(component).toContain('"/api/ai/check-key"');
    expect(component).toContain("body: JSON.stringify({ provider, apiKey })");
  });

  it("the check runs behind the shared gate: requireAiRequest(\"key-check\", 10) comes before resolveProvider", () => {
    const route = code(ROUTE);
    const gate = route.indexOf('requireAiRequest("key-check", 10)');
    expect(gate).toBeGreaterThan(0);
    expect(route.indexOf("resolveProvider(override)")).toBeGreaterThan(gate);
    // The gate's answer (401 signed out, 429 over the limit) is returned unchanged, first.
    expect(route).toMatch(/const gate = await requireAiRequest\("key-check", 10\);\s*if \(gate instanceof NextResponse\) return gate;/);
  });

  it("'that provider': the registry is handed the request's own provider and key, and nothing else from the body", () => {
    const route = code(ROUTE);
    expect(route).toContain("const { provider, apiKey } = body as");
    expect(route).toContain("const override = { provider, apiKey } as ProviderOverrideConfig;");
    expect(route.match(/resolveProvider\(/g)).toHaveLength(1);
  });

  it("'one short request': one testConnection per check, and each provider's is a one-line ping with a small cap", () => {
    const check = code(CHECK);
    expect(check.match(/testConnection\(\)/g)).toHaveLength(1);
    expect(code(ROUTE)).not.toContain("testConnection");
    const testBlock = (file: string) => {
      const source = code(file);
      const start = source.lastIndexOf("async testConnection()");
      return source.slice(start, source.indexOf("\n    },", start));
    };
    expect(testBlock("src/lib/llm/providers/openai.ts")).toContain("maxTokens: 32");
    expect(testBlock("src/lib/llm/providers/qwen.ts")).toContain("maxTokens: 32");
    expect(testBlock("src/lib/llm/providers/deepseek.ts")).toContain("maxTokens: 32");
    expect(testBlock("src/lib/llm/providers/anthropic.ts")).toContain("max_tokens: 10");
    // The reader's-key Gemini provider is the last `testConnection` in its file.
    const gemini = testBlock("src/lib/llm/providers/gemini.ts");
    expect(gemini).toContain("KEY_CHECK_SYSTEM_PROMPT");
    expect(gemini).toContain("maxTokens: KEY_CHECK_MAX_TOKENS");
    expect(gemini).not.toContain("DIGEST_SYSTEM_PROMPT");
  });

  it("'not the provider's answer': the response is one word, and the provider's text is read only to choose it", () => {
    const route = code(ROUTE);
    // The one success response is the word; every other is the gate's or a fixed 400.
    expect(route).toContain("return NextResponse.json({ result }, { headers: NO_STORE });");
    expect(route.match(/NextResponse\.json\(/g)).toHaveLength(2);
    expect(route).toContain('NextResponse.json({ error: "invalid_request" }');
    expect(route).not.toMatch(/\.error\b/);
    // The classifier returns literal words only, and the check returns the classifier's word.
    const check = code(CHECK);
    const classify = check.slice(check.indexOf("export function classifyKeyCheckError"), check.indexOf("export async function checkProviderKey"));
    const returns = [...classify.matchAll(/return ([^;]+);/g)].map((match) => match[1]);
    expect(returns.length).toBeGreaterThan(0);
    for (const value of returns) expect(value).toMatch(/^"(?:no-credit|rejected|busy|unreachable|error)"$/);
    expect(check).toContain('return outcome.ok === true ? "ok" : classifyKeyCheckError(outcome.error);');
  });

  it("'Peer keeps neither the key nor the provider's answer': no store, cache or log in the route or the check", () => {
    for (const file of [ROUTE, CHECK]) {
      expect(code(file)).not.toMatch(/console\.|getCounterStore|from\("|localStorage|new Map\b/);
    }
  });

  it("'at most one log line … the provider, the model, the token counts, how long it took and whether it worked … never the key or anything you wrote': the line is LlmUsage, and nothing else", () => {
    const usage = code("src/lib/llm/usage-log.ts");
    const shape = usage.slice(usage.indexOf("export interface LlmUsage"), usage.indexOf("export function logLlmUsage"));
    // provider, model, the call site's fixed name ("test" for a check), the token counts, the time, ok.
    const fields = [...shape.matchAll(/^\s*(\w+)\??:/gm)].map((match) => match[1]);
    expect(fields).toEqual(["provider", "model", "path", "inputTokens", "outputTokens", "thinkingTokens", "latencyMs", "ok"]);
    expect(shape).not.toMatch(/key|prompt|text|content|user/i);
    // The line prints those fields and nothing else.
    const writer = usage.slice(usage.indexOf("export function logLlmUsage"), usage.indexOf("export function now"));
    const printed = [...new Set([...writer.matchAll(/\bu\.(\w+)/g)].map((match) => match[1]))].sort();
    expect(printed).toEqual([...fields].sort());
    expect(writer.match(/console\.\w+\(/g)).toEqual(["console.log("]);
  });

  it("'at most one log line': every provider's check goes through its one logged call, once, and the route and the check write none of their own", () => {
    expect(code(ROUTE)).not.toMatch(/console\./);
    expect(code(CHECK)).not.toMatch(/console\./);
    const testBlock = (file: string) => {
      const source = code(file);
      const start = source.lastIndexOf("async testConnection()");
      return source.slice(start, source.indexOf("\n    },", start));
    };
    /** The body of a module-level function, up to the next top-level declaration. */
    const fn = (file: string, name: string) => {
      const source = code(file);
      const start = source.indexOf(`function ${name}(`);
      const end = /\n\}\r?\n/.exec(source.slice(start));
      return source.slice(start, start + (end?.index ?? 0));
    };
    // OpenAI, Qwen and DeepSeek: one fetch, logged once on an answer (ok or ERR); a fetch that
    // never answers (a network failure, a timeout) writes none — hence "at most".
    for (const [file, call] of [
      ["src/lib/llm/providers/openai.ts", "callOpenAIChat"],
      ["src/lib/llm/providers/qwen.ts", "callQwenChat"],
      ["src/lib/llm/providers/deepseek.ts", "callDeepseekChat"],
    ] as const) {
      expect(testBlock(file).match(new RegExp(`\\b${call}\\(`, "g"))).toHaveLength(1);
      expect(testBlock(file)).toContain(`userPrompt: '{"ping":true}'`);
      const body = fn(file, call);
      expect(body.match(/\bfetch\(/g)).toHaveLength(1);
      expect(body.match(/logLlmUsage\(/g)).toHaveLength(2);
    }
    // Anthropic: one request with retries off, logged once whichever way it goes.
    const anthropic = testBlock("src/lib/llm/providers/anthropic.ts");
    expect(anthropic).toContain("{ maxRetries: 0 }");
    expect(anthropic.match(/client\.messages\.create\(/g)).toHaveLength(1);
    expect(anthropic).toContain('logAnthropic(model, "test", response.usage, started, true);');
    expect(anthropic).toContain('logAnthropic(model, "test", undefined, started, false);');
    expect(anthropic).toContain('content: "ping"');
    expect(fn("src/lib/llm/providers/anthropic.ts", "logAnthropic")).toContain("logLlmUsage({");
    // Gemini (the reader's key): one call through `callApiModel`, which logs on either outcome.
    const gemini = testBlock("src/lib/llm/providers/gemini.ts");
    expect(gemini.match(/\bcallApiModel\(/g)).toHaveLength(1);
    expect(gemini).toContain("KEY_CHECK_USER_PROMPT");
    const geminiSource = code("src/lib/llm/providers/gemini.ts");
    const callApiModel = geminiSource.slice(geminiSource.indexOf("const callApiModel = async"), geminiSource.indexOf("const callApiVisionModel"));
    expect(callApiModel.match(/logGemini\(/g)).toHaveLength(2);
    expect(fn("src/lib/llm/providers/gemini.ts", "logGemini")).toContain("logLlmUsage({");
  });

  it("'counts this account's checks this hour … ten checks an hour': the gate's limit is 10 and its count is a number under the scope", () => {
    expect(code(ROUTE)).toContain('requireAiRequest("key-check", 10)');
    expect(code("src/lib/security/ai-request.ts")).toContain("rateKey(scope, user.id, now)");
  });

  it("'Peer never stores it on its server': the sync voids it, strips it, and the profile row has no column for it", () => {
    const sync = read("src/components/profile-sync.tsx");
    expect(sync).toContain("void feedAiApiKey;");
    expect(sync).toContain("stripCredentialFields(rest)");
    expect(read("src/lib/profile/merge.ts")).toMatch(/CREDENTIAL_LIKE_FIELDS = \[[^\]]*"feedAiApiKey"/);
    const profileRoute = code("src/app/api/profile/route.ts");
    const rowWriter = profileRoute.slice(profileRoute.indexOf("export function profilePatchToRow"), profileRoute.indexOf("// ── Handlers"));
    expect(rowWriter.length).toBeGreaterThan(0);
    expect(rowWriter).not.toMatch(/api_?key/i);
  });

  it("'signing out removes it from this browser': a confirmed sign-out runs logOut, which resets the profile to one with no key", () => {
    const sync = code("src/components/profile-sync.tsx");
    expect(sync).toMatch(/processConfirmedSignOutCookie\(\{[\s\S]*?logOut: \(\) => useProfileStore\.getState\(\)\.logOut\(\),/);
    expect(sync).toMatch(/export function processConfirmedSignOutCookie[\s\S]*?deps\.logOut\(\);/);
    const store = code("src/store/profile.ts");
    expect(store).toMatch(/logOut: \(\) => \{[\s\S]*?profile: defaultProfile,/);
    expect(defaultProfile.feedAiApiKey).toBe("");
  });
});
