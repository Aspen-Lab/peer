import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultProfile, type UserProfile } from "@/types";
import { remoteProfilePayload } from "@/components/profile-sync";
import { LIST_FIELDS, SINGLE_VALUE_FIELDS } from "@/lib/profile/merge";
import PrivacyPage from "./page";

// P5-01 (brief commit 3): where a reader's standing questions go, said on /privacy and pinned to
// the lines of code that make each clause true. The profile syncs to Peer's server when signed in,
// but the standing questions are left out of what is sent: they stay in this browser. The
// questions below are invented.

const STANDING_TEXT =
  "Standing questions you keep on your Profile stay in this browser. Peer's sync leaves them out, so they are never sent to its servers and signing in does not copy them into your account; signing out clears them with the rest of your profile. On a paper, one becomes a question only when you press it, and then it is like any other question you type there.";

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), "utf8");
const squash = (text: string) => text.replace(/\s+/g, " ");
const INVENTED = ["Which cohort was studied, and how large was it?", "Are negative findings reported?"];
const profile: UserProfile = { ...defaultProfile, standingQuestions: INVENTED };

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

describe("/privacy — standing questions (P5-01)", () => {
  const html = renderToStaticMarkup(createElement(PrivacyPage));

  it("has the sentence, word for word, once, as an entry of its own right before 'Your questions'", () => {
    const section = html.slice(html.indexOf(">Your standing questions<"), html.indexOf(">Your questions<"));
    expect(html.indexOf(">Your standing questions<")).toBeGreaterThan(html.indexOf(">Your notes<"));
    const escaped = STANDING_TEXT.replace(/'/g, "&#x27;");
    expect(section).toContain(`<p>${escaped}</p>`);
    expect(html.split(escaped).length - 1).toBe(1);
  });

  it("is true of the sync: the payload leaves the field out, by a line a later edit has to remove on purpose", () => {
    const payload = remoteProfilePayload(profile);
    expect(payload).not.toHaveProperty("standingQuestions");
    expect(JSON.stringify(payload)).not.toContain(INVENTED[0]);
    const sync = squash(read("src/components/profile-sync.tsx"));
    expect(sync).toContain("jevApiKey, standingQuestions, ...rest } = profile;");
    expect(sync).toContain("void standingQuestions;");
  });

  it("nothing but remoteProfilePayload feeds the one PUT of the profile", () => {
    const sync = squash(read("src/components/profile-sync.tsx"));
    expect(sync.match(/apiFetch\("\/api\/profile", \{ method: "PUT",/g)).toHaveLength(1);
    // The PUT's patch is built from the payload in every caller.
    expect(sync).toContain("const payload = remoteProfilePayload(merged) as Record<string, unknown>;");
    expect(sync).toContain("const payload = remoteProfilePayload(profile);");
    const puts = sourceFiles(join(root, "src")).filter((file) => /method: "PUT"/.test(readFileSync(file, "utf8")) && /"\/api\/profile"/.test(readFileSync(file, "utf8")));
    expect(puts.map((file) => relative(root, file))).toEqual(["src/components/profile-sync.tsx"]);
  });

  it("the account's side has no place for them: no column, not a merged field, not in the feed request", () => {
    expect(read("src/app/api/profile/route.ts")).not.toMatch(/standingQuestions|standing_questions/);
    expect(LIST_FIELDS as readonly string[]).not.toContain("standingQuestions");
    expect(SINGLE_VALUE_FIELDS as readonly string[]).not.toContain("standingQuestions");
    expect(read("src/store/feed.ts")).not.toMatch(/standingQuestions|standing_questions/);
    expect(read("src/lib/feed/intent.ts")).not.toMatch(/standingQuestions|standing_questions/);
  });

  it("signing out clears them with the profile: logOut resets to a default that has none", () => {
    expect(squash(read("src/store/profile.ts"))).toContain("set({ profile: defaultProfile, lastSynced: null, syncedAccountId: null, });");
    expect(defaultProfile).not.toHaveProperty("standingQuestions");
  });

  it("the only code that reads the field is the profile's own, the Profile page's editor and the paper page's chip group", () => {
    const users = sourceFiles(join(root, "src"))
      .filter((file) => /standingQuestions/.test(readFileSync(file, "utf8")))
      .map((file) => relative(root, file).split("\\").join("/"))
      .sort();
    expect(users).toEqual([
      "src/app/papers/[id]/page.tsx",
      "src/components/profile-sync.tsx",
      "src/components/profile/standing-questions-field.tsx",
      "src/store/profile.ts",
      "src/types/index.ts",
    ]);
  });

  it("no log line prints one: the standing questions' own files have no console call", () => {
    for (const file of ["src/components/profile/standing-questions-field.tsx", "src/components/reader/question-field.tsx"]) {
      expect(read(file)).not.toMatch(/console\./);
    }
  });
});
