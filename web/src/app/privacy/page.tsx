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
    label: "Your questions",
    body: [
      "Questions you type on a paper page stay in this browser. When Peer writes a deep report for that paper, they travel with that one request to Peer's server and on to the model provider whose key you added, inside the prompts, and nowhere else, so the report can answer them; Peer does not log them or keep them.",
    ],
  },
  {
    // P3-02d (§1h.5): written from the explain route, `lib/papers/explain.ts` and
    // `store/explain-threads.ts`. The test pins every word; a change to what is
    // sent or kept changes this entry in the same commit. P3-07 (§1h.9 (5)): "Say
    // more" is the third thing that sends, and a reply is short unless the reader asks
    // for more. P4-00: the answer runs on the reader's own key, and Peer counts nothing
    // against an allowance, so the two paragraphs about the count and the usage row
    // are gone.
    label: "Explain this",
    body: [
      "Selecting a passage sends nothing, and neither does typing in the box. Peer sends a request only when you click “Explain this?” (or press E on a selection) and, for a follow-up, when you press Enter or Send, or Say more under a reply. A reply is short unless you ask for more, in your own words or with Say more. The request carries the passage you selected, the paragraph it sits in and the one on either side of it, the paper's title and abstract, one line for each section of the paper's map and, for a follow-up, the messages of that thread. The request also carries the paper's record as this page holds it — its title, authors, venue, where it came from and your save and feedback marks on it — so Peer's server can find the paper; of that record the model sees only the title and the abstract. The answer is written with your own model key, which goes with the request.",
      "The request goes to Peer's server and on to the model provider whose key you added. The answer runs on your own key, and it is short unless you ask for more.",
      "On a follow-up you can turn on “Search the web” for that one message. It is off every time the box opens and never turns on by itself. With it on, the provider may run a web search to write that reply: Gemini does this with Google Search, and with any other provider the reply is written without a search and the box says so. A message answered with a search carries the mark “searched the web”, and Peer shows no link to anything the search found.",
      "Peer's server keeps two things. First, each answer it gives, in memory, for up to an hour, so the same passage asked about again is answered without another model call; it is filed under hashes of the document, the passage and the thread, never under who asked.",
      "Second, one log line for each answer it gives: how many characters went out and came back and, if you are signed in, a shortened hash of your account id — never the passage, the paper's words or anything you wrote.",
      "In this browser, and only here, Peer keeps what you asked about, for each paper: the passage, where it sits in the paper, the answer and the thread. For an uploaded PDF the passage is the PDF's own text. None of it is stored against your account, and signing in does not copy it there. A passage you have asked about before opens from this copy with no new request. Signing out leaves it in place; clearing this site's data in your browser removes it.",
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
      "Jev, made by TypeSafe, receives the title, abstract and venue of up to 50 candidate papers, together with the project, challenge, topics, methods and exclusions you wrote and the word meanings you selected, and bills your own account. Peer keeps Jev's answers for each paper against your account (the paper's id, the question, the answer, how sure Jev was, which Jev model answered, and how many tokens and how much time the call took), with no paper text and no key, until the account is removed.",
      "Your browser also remembers, for the Profile page, how many papers Jev screened in your last briefing. It holds counts only, and it is cleared when you change or remove the key.",
    ],
  },
  {
    label: "Who else sees a request",
    body: [
      "Finding papers means asking the open sources: OpenAlex, arXiv, Crossref, Semantic Scholar, and the publisher or repository a paper's full text and figures live on. Those services see the query and the request, as they would for any reader.",
      "The model provider whose key you added sees what a model request carries: your topics and a paper's title and abstract when the briefing is ranked or summarised, and a paper's text when a deep report is written, which happens when you turn on Deep report in your profile or attach a PDF to the paper; on that same condition, and never otherwise, the text is read once more to write the one-line gists in the paper's map. Tavily sees your search terms only if you add a Tavily key yourself. Jev sees those papers and your project text only if you add a Jev key yourself. Resend sends the email digest if you turn one on. Supabase hosts the database and the sign-in. Vercel hosts the site and counts page views — Vercel Analytics records the page, not who you are.",
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
