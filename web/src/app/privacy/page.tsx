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
    label: "If you sign in",
    body: [
      "Signing in is GitHub or Google OAuth through Supabase. Peer receives the account id and email address the provider returns, and stores them in its own database.",
      "From then on these are stored against your account: the topics, methods, journals, school and lab you enter; the free-text project and challenges you write; your feed and digest settings; papers you save; papers you open; likes and dismissals; and digests that were sent to you.",
      "A like or a dismissal is kept as a small ledger of concepts, which is what makes tomorrow's briefing different from today's.",
      "Signing in carries what you had saved and opened in this browser into your account. Signing out clears this browser's copy, including the reading graph — which is kept only in this browser, never on Peer's servers, so it does not come back when you sign in again.",
    ],
  },
  {
    label: "Your notes",
    body: [
      "Notes and drafts you write from the Saved page are kept only in this browser. Peer never sends them to its servers, and signing in does not copy them into your account.",
      "Signing out leaves them in place — they were never an account's, so signing out has nothing to take back. On a shared computer, delete them before you leave. Clearing site data deletes them for good; export a note as Markdown to keep a copy.",
    ],
  },
  {
    label: "Your own model key",
    body: [
      "Peer has no model of its own. Ranking by a model, relevance reasons, digest bullets and model reports run only if you add your own provider key; without one you read the briefing without a model.",
      "Your key stays in your browser. It is deliberately excluded from everything Peer syncs to its server — the one line that does it is a `void feedAiApiKey` in the sync code, there so a future edit has to remove it on purpose.",
      "When you ask for something a model does, your browser sends the request to Peer's server with your key attached, and the server passes it to the provider you chose. The key is used for that request and is not stored.",
    ],
  },
  {
    label: "Your own Jev key",
    body: [
      "If you add a Jev key, it stays in your browser and is excluded from everything Peer syncs, the same way as a model key. Each time Peer builds your briefing its server passes the key to Jev, and does not store or log it.",
      "Jev, made by TypeSafe, receives the title, abstract and venue of up to 50 candidate papers, together with the project, challenge, topics, methods and exclusions you wrote, and bills your own account. Peer keeps Jev's answers for each paper against your account (the question, the answer and how sure Jev was), with no paper text and no key, until the account is removed.",
      "Your browser also remembers, for the Profile page, how many papers Jev screened in your last briefing. It holds counts only, and it is cleared when you change or remove the key.",
    ],
  },
  {
    label: "Who else sees a request",
    body: [
      "Finding papers means asking the open sources: OpenAlex, arXiv, Crossref, Semantic Scholar, and the publisher or repository a paper's full text and figures live on. Those services see the query and the request, as they would for any reader.",
      "The model provider whose key you added sees what a model request carries: your topics and a paper's title and abstract when the briefing is ranked or summarised, and a paper's text when a model report is written. Tavily sees your search terms only if you add a Tavily key yourself. Jev sees those papers and your project text only if you add a Jev key yourself. Resend sends the email digest if you turn one on. Supabase hosts the database and the sign-in. Vercel hosts the site and counts page views — Vercel Analytics records the page, not who you are.",
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
        Last changed 2026-10-06 · changes to this page ship in the{" "}
        <Link href="/changelog" className="underline decoration-border-strong underline-offset-4 hover:text-heading">
          changelog
        </Link>
        .
      </p>
    </PageContainer>
  );
}
