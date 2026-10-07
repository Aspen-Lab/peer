import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
    expect(text()).toContain("Last changed 2026-10-06");
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
    expect(page).toContain("Last changed 2026-10-06");
  });
});
