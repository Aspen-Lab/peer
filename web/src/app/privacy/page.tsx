// What Peer stores, who else sees it, and how to get rid of it.
//
// Written from the code rather than from a template: every claim below points
// at a table in `supabase/schema.sql`, a fetch in `lib/sources/`, or a line in
// `profile-sync.tsx`. If one of them stops being true, this page is wrong and
// has to change in the same commit.

import type { Metadata } from "next";
import Link from "next/link";
import { PageContainer } from "@/components/ui/page-container";
import { Band } from "@/components/ui/band";

export const metadata: Metadata = {
  title: "Privacy — Peer",
  description: "What Peer stores, who else sees it, and how to remove it.",
};

const SECTIONS = [
  {
    label: "Without an account",
    body: [
      "You can read a briefing without signing in, and Peer stores nothing about you on its servers when you do.",
      "Your browser keeps your topics, your settings, today's papers, the ones you have saved and the ones you have opened, so the page works on your next visit. For each paper you read it also keeps the title, the venue, the day you read it and the terms it is filed under — that is what draws your reading graph. Clearing site data removes all of it.",
    ],
  },
  {
    label: "If you sign in with GitHub",
    body: [
      "Signing in is GitHub OAuth through Supabase. Peer receives the account id and email address GitHub returns, and stores them in its own database.",
      "From then on these are stored against your account: the topics, methods, journals, school and lab you enter; the free-text project and challenges you write; your feed and digest settings; papers you save; papers you open; likes and dismissals; and digests that were sent to you.",
      "A like or a dismissal is kept as a small ledger of concepts, which is what makes tomorrow's briefing different from today's.",
      "Signing in carries what you had saved and opened in this browser into your account. Signing out clears this browser's copy, including the reading graph — which is kept only in this browser, never on Peer's servers, so it does not come back when you sign in again.",
    ],
  },
  {
    label: "Your own model key",
    body: [
      "If you add your own provider key, it stays in your browser. It is deliberately excluded from everything Peer syncs to its server — the one line that does it is a `void feedAiApiKey` in the sync code, there so a future edit has to remove it on purpose.",
      "When Peer's own model is used instead, the request goes to Google's Gemini API from Peer's server.",
    ],
  },
  {
    label: "What is recorded about model use",
    body: [
      "Every call Peer pays for writes one row: which route, which provider and model, how many tokens, how long it took, whether it succeeded, and whether it ran on your key or Peer's.",
      "That row holds no paper text, no prompt, no answer, and no credential. The table has no column that could hold one.",
    ],
  },
  {
    label: "Who else sees a request",
    body: [
      "Finding papers means asking the open sources: OpenAlex, arXiv, Crossref, Semantic Scholar, and the publisher or repository a paper's full text and figures live on. Those services see the query and the request, as they would for any reader.",
      "Google (Gemini) sees a paper's text when a model report is written. Tavily sees your search terms only if you add a Tavily key yourself. Resend sends the email digest if you turn one on. Supabase hosts the database and the sign-in. Vercel hosts the site and counts page views — Vercel Analytics records the page, not who you are.",
      "Peer runs no advertising, sells nothing to anyone, and has no third-party trackers beyond the page counter named above.",
    ],
  },
  {
    label: "Removing it",
    body: [
      "Signed out: clear the site data in your browser and nothing of yours remains.",
      "Signed in: Peer has no self-serve delete button yet — that is a gap, not a policy. Open an issue on the repository and the account and every row above will be deleted.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <PageContainer>
      <p className="eyebrow text-text-faint">Privacy</p>
      <h1 className="display-line text-display lg:text-display-lg text-heading leading-[1.05] mt-3">
        What Peer keeps.
      </h1>
      <p className="font-sans text-body-lg leading-[1.6] text-text-muted measure-ui mt-4">
        Peer is open source, so none of this has to be taken on trust: every
        claim here points at a table, a fetch or a line in{" "}
        <Link
          href="https://github.com/Aspen-Lab/peer"
          className="underline decoration-border-strong underline-offset-4 hover:text-heading transition-colors duration-[180ms] ease-expo"
        >
          the repository
        </Link>
        .
      </p>

      {SECTIONS.map((section) => (
        <Band key={section.label} label={section.label}>
          <div className="font-sans text-body-lg leading-[1.6] text-text-muted measure-ui mt-4 space-y-3">
            {section.body.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        </Band>
      ))}

      <p className="annotation text-text-faint mt-12">
        Last changed 2026-09-17 · changes to this page ship in the{" "}
        <Link href="/changelog" className="underline decoration-border-strong underline-offset-4 hover:text-heading">
          changelog
        </Link>
        .
      </p>
    </PageContainer>
  );
}
