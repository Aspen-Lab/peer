import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultProfile, type UserProfile } from "@/types";
import { remoteProfilePayload } from "@/components/profile-sync";
import { applyQuestionTermSignal } from "@/lib/preferences/ledger";
import PrivacyPage from "./page";

// P5-02 (brief commit 3): where the words of a reader's questions go once they enter the
// preference ledger, said on /privacy and pinned to the lines of code that make each clause true.
// The ledger is part of the profile, and the profile syncs to Peer's server when signed in, so the
// terms (not the questions) go with it. Each pin below is a line a later edit has to change on
// purpose. The sentences are invented.

const TEXT =
  "When your questions on a paper settle, the specific words in them — one word at a time, in lower case, without common words and the words every question uses — are added to the small ledger Peer keeps of what interests you, at a small fraction of the weight of a like, so one question changes nothing you can see. The question itself is never added, and neither is anything from the paper. Tick “Not for recommendations” beside a question and its words are not added, or are taken out at once if they were. The ledger is part of your profile: it is kept in this browser and, when you are signed in, sent to Peer's server and stored against your account with the rest of your profile, so these words go with it, each filed under a marker that stands for the paper, not its name. The next sync replaces your account's copy, and signing out clears it from this browser.";

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), "utf8");
const squash = (text: string) => text.replace(/\s+/g, " ");
const QUESTION = "Does annealing coarsen the grain boundaries?";
const PAPER = "openalex:W424242";

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

describe("/privacy — what your questions teach Peer (P5-02)", () => {
  const html = renderToStaticMarkup(createElement(PrivacyPage));

  it("has the sentence, word for word, once, as an entry of its own between 'Your standing questions' and 'Your questions'", () => {
    const standing = html.indexOf(">Your standing questions<");
    const label = html.indexOf(">What your questions teach Peer<");
    const questions = html.indexOf(">Your questions<");
    expect(standing).toBeGreaterThan(0);
    expect(label).toBeGreaterThan(standing);
    expect(questions).toBeGreaterThan(label);
    const escaped = TEXT.replace(/'/g, "&#x27;");
    expect(html.slice(label, questions)).toContain(`<p>${escaped}</p>`);
    expect(html.split(escaped).length - 1).toBe(1);
  });

  it("is true of the sync: the ledger is in the payload, with the terms and neither the question nor the paper's id", () => {
    const ledger = applyQuestionTermSignal({}, PAPER, ["annealing", "grain"], "2026-10-07T00:00:00.000Z");
    const profile: UserProfile = { ...defaultProfile, preferenceLedger: ledger };
    const payload = JSON.stringify(remoteProfilePayload(profile));
    expect(payload).toContain("annealing");
    expect(payload).toContain("\"questions\"");
    expect(payload).not.toContain(QUESTION);
    expect(payload).not.toContain("W424242");
    // The payload's own destructure does not remove the ledger.
    const sync = squash(read("src/components/profile-sync.tsx"));
    expect(sync).toContain("jevApiKey, standingQuestions, ...rest } = profile;");
  });

  it("the server keeps what arrives: the PUT replaces the ledger with its cleaned form, and cleaning keeps the evidence", () => {
    expect(squash(read("src/app/api/profile/route.ts"))).toContain("row.preference_ledger = cleanPreferenceLedger(p.preferenceLedger);");
    expect(squash(read("src/lib/preferences/ledger.ts"))).toContain("...cleanedQuestionEvidence(entry.questions),");
  });

  it("only the terms are handed to the ledger: the field passes questionTerms' result, never a question", () => {
    const field = squash(read("src/components/reader/question-field.tsx"));
    expect(field).toContain("recordQuestionTerms(paperId, questionTerms(settledQuestions(entry), notForRecommendations(entry)));");
    expect(squash(read("src/store/profile.ts"))).toContain("recordQuestionTerms: (paperId, terms) =>");
    expect(squash(read("src/lib/preferences/ledger.ts"))).toContain("export function applyQuestionTermSignal(ledger: PreferenceLedger | undefined, paperId: string, terms: readonly string[]");
  });

  it("the paper is a marker, not its id: the ledger writes questionSourceKey and nothing of the id", () => {
    const ledger = squash(read("src/lib/preferences/ledger.ts"));
    expect(ledger).toContain("const source = questionSourceKey(paperId);");
    expect(ledger).not.toMatch(/questions: \{[^}]*paperId[^}]*\}/);
    const users = sourceFiles(join(root, "src"))
      .filter((file) => /questionSourceKey/.test(readFileSync(file, "utf8")))
      .map((file) => relative(root, file).split("\\").join("/"))
      .sort();
    // The type names it in a comment; only the ledger calls it.
    expect(users).toEqual(["src/lib/preferences/ledger.ts", "src/types/index.ts"]);
  });

  it("the tick is what keeps a question out, and the label says so", () => {
    const field = squash(read("src/components/reader/question-field.tsx"));
    expect(field).toContain("onChange={(event) => onMark(index, event.target.checked)}");
    expect(field).toContain("{ASK.notForRecs}");
    expect(squash(read("src/lib/preferences/question-terms.ts"))).toContain("if (out.has(question.trim().toLocaleLowerCase())) continue;");
  });

  it("signing out clears the ledger with the profile: logOut resets to a default with none", () => {
    expect(squash(read("src/store/profile.ts"))).toContain("set({ profile: defaultProfile, lastSynced: null, syncedAccountId: null, });");
    expect(defaultProfile.preferenceLedger ?? {}).toEqual({});
  });

  it("no log line prints a question or a term: none of the files that carry them has a console call", () => {
    for (const file of [
      "src/components/reader/question-field.tsx",
      "src/lib/preferences/question-terms.ts",
      "src/lib/preferences/ledger.ts",
      "src/store/reading-questions.ts",
    ]) {
      expect(read(file)).not.toMatch(/console\./);
    }
  });
});
