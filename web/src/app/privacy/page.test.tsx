import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EXPLAIN } from "@/components/reader/copy";
import { EXPLAIN_CAPS } from "@/lib/papers/explain";
import PrivacyPage from "./page";

// P2-03 (§1g.11 e, the entry §1f.9 promised): the reader's questions are
// named on /privacy, in exactly these words, beside "Your notes".
//
// P2-08b (§1g.17, F2): the words changed. The old text said only that the
// questions "travel with that one request"; they also go on to the model
// provider inside the prompts, which the entry now names, and only a deep
// request carries them at all. The exact-text assertion below is rewritten to
// the new words (the same assertion, the new ruling), and a second one pins
// the provider.

const QUESTIONS_TEXT =
  "Questions you type on a paper page stay in this browser. When Peer writes a deep report for that paper, they travel with that one request to Peer's server and on to the model provider you or the owner configured, inside the prompts, and nowhere else, so the report can answer them; Peer does not log them or keep them.";

describe("/privacy — Your questions (P2-03)", () => {
  const html = renderToStaticMarkup(createElement(PrivacyPage));

  it("has the entry, with exactly the ruled text", () => {
    expect(html).toContain(">Your questions<");
    expect(html).toContain(`<p>${QUESTIONS_TEXT.replace(/'/g, "&#x27;")}</p>`);
  });

  it("names the model provider the questions go on to, and that they go nowhere else (P2-08b)", () => {
    const entry = html.slice(html.indexOf(">Your questions<"), html.indexOf(">Your own model key<"));
    expect(entry).toContain("model provider you or the owner configured");
    expect(entry).toContain("inside the prompts, and nowhere else");
    expect(entry).toContain("Peer does not log them or keep them");
  });

  it("sets it right after Your notes", () => {
    const notes = html.indexOf(">Your notes<");
    const questions = html.indexOf(">Your questions<");
    const key = html.indexOf(">Your own model key<");
    expect(notes).toBeGreaterThan(0);
    expect(questions).toBeGreaterThan(notes);
    expect(key).toBeGreaterThan(questions);
  });
});

// P3-02d (§1h.5, §3d 14 and 17): "Explain this" is named on /privacy, in exactly
// these words, right after "Your questions" and before "Your own model key". Each
// paragraph states only what the code as landed does — the facts are in the
// P3-02, P3-02b and P3-02c checkpoints — and a test below ties the facts that
// have a constant in the code to that constant, so the page cannot stay true by
// being wrong about a number or a label.
//
// The page's apostrophes come out of `renderToStaticMarkup` as `&#x27;`; the
// double quotes in the text are the typographic ones, which are not escaped.

const EXPLAIN_PARAGRAPHS = [
  "Selecting a passage sends nothing, and neither does typing in the box. Peer sends a request only when you click “Explain this?” (or press E on a selection) and, for a follow-up, when you press Enter or Send. The request carries the passage you selected, the paragraph it sits in and the one on either side of it, the paper's title and abstract, one line for each section of the paper's map and, for a follow-up, the messages of that thread. The request also carries the paper's record as this page holds it — its title, authors, venue, where it came from and your save and feedback marks on it — so Peer's server can find the paper; of that record the model sees only the title and the abstract. If you have set your own model key, the key goes with it.",
  "The request goes to Peer's server and on to the model provider you or the owner configured — Google's Gemini when Peer's own model answers, and the provider whose key you set when you use your own.",
  "On a follow-up you can turn on “Search the web” for that one message. It is off every time the box opens and never turns on by itself. With it on, the provider may run a web search to write that reply: Gemini does this with Google Search, and with any other provider the reply is written without a search and the box says so. A message answered with a search carries the mark “searched the web”, and Peer shows no link to anything the search found.",
  "Peer's server keeps three things. First, each answer it gives, in memory, for up to an hour, so the same passage asked about again is answered without another model call; it is filed under hashes of the document, the passage and the thread, never under who asked.",
  "Second, one log line for each answer it gives: how many characters went out and came back, how much the turn counted against the allowance and, if you are signed in, a shortened hash of your account id — never the passage, the paper's words or anything you wrote.",
  "Third, a count of your explanations for the day against your account, which is what the daily allowance is measured by: a number, with no words in it. The usage row that each model call writes, described under “What is recorded about model use”, holds no words either.",
  "In this browser, and only here, Peer keeps what you asked about, for each paper: the passage, where it sits in the paper, the answer and the thread. For an uploaded PDF the passage is the PDF's own text. None of it is stored against your account, and signing in does not copy it there. A passage you have asked about before opens from this copy with no new request. Signing out leaves it in place; clearing this site's data in your browser removes it.",
] as const;

const escapeText = (text: string): string => text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;");

describe("/privacy — Explain this (P3-02d)", () => {
  const html = renderToStaticMarkup(createElement(PrivacyPage));
  const questions = html.indexOf(">Your questions<");
  const label = html.indexOf(">Explain this<");
  const key = html.indexOf(">Your own model key<");
  const entry = html.slice(label, key);
  const paragraphs = (markup: string): number => (markup.match(/<p>/g) ?? []).length;

  it("has the entry, with exactly the written paragraphs and no others", () => {
    expect(label).toBeGreaterThan(0);
    for (const paragraph of EXPLAIN_PARAGRAPHS) {
      expect(entry).toContain(`<p>${escapeText(paragraph)}</p>`);
    }
    expect(paragraphs(entry)).toBe(EXPLAIN_PARAGRAPHS.length);
  });

  it("sets it right after Your questions and right before Your own model key", () => {
    expect(questions).toBeGreaterThan(0);
    expect(label).toBeGreaterThan(questions);
    expect(key).toBeGreaterThan(label);
    // Nothing sits between them but the questions entry's own paragraph.
    expect(paragraphs(html.slice(questions, label))).toBe(1);
  });

  it("says what is sent, and that nothing is sent while the reader selects or types", () => {
    expect(entry).toContain("Selecting a passage sends nothing, and neither does typing in the box");
    expect(entry).toContain("only when you click");
    expect(entry).toContain("press Enter or Send");
    for (const sent of ["the passage you selected", "the paragraph it sits in and the one on either side of it", "the paper's title and abstract".replace(/'/g, "&#x27;"), "one line for each section of the paper", "the messages of that thread", "your own model key"]) {
      expect(entry).toContain(sent);
    }
  });

  // P3-05 (§1h.8 (7), O13): the first paragraph listed what the PROMPT carries; the
  // request to Peer's server carries the whole `paper` record the page holds (A's
  // P3-04: authors, venue, flags, the upload's key), so the entry says so — and that
  // the model sees only the title and the abstract of it. The pinned paragraph above
  // holds the whole sentence; these name its parts.
  it("says the request carries the paper's record to Peer's server, and that the model sees only its title and abstract", () => {
    expect(entry).toContain("The request also carries the paper&#x27;s record as this page holds it");
    expect(entry).toContain("its title, authors, venue, where it came from and your save and feedback marks on it");
    expect(entry).toContain("so Peer&#x27;s server can find the paper");
    expect(entry).toContain("of that record the model sees only the title and the abstract");
  });

  it("sets that sentence after what the prompt carries and before the key, in the paragraph that lists what is sent", () => {
    const first = entry.slice(0, entry.indexOf("</p>"));

    expect(first.indexOf("the messages of that thread.")).toBeGreaterThan(0);
    expect(first.indexOf("The request also carries the paper&#x27;s record")).toBeGreaterThan(first.indexOf("the messages of that thread."));
    expect(first.indexOf("If you have set your own model key")).toBeGreaterThan(first.indexOf("of that record the model sees only"));
  });

  it("names the provider the request goes on to", () => {
    expect(entry).toContain("model provider you or the owner configured");
    expect(entry).toContain("Google");
    expect(entry).toContain("Gemini");
  });

  it("says the web search is off every time the box opens, never on by itself, and runs for one message", () => {
    expect(entry).toContain("off every time the box opens");
    expect(entry).toContain("never turns on by itself");
    expect(entry).toContain("for that one message");
    expect(entry).toContain("Google Search");
    expect(entry).toContain("the reply is written without a search and the box says so");
    expect(entry).toContain("shows no link to anything the search found");
  });

  it("says what Peer's server keeps: an hour's memory under hashes, never by reader; one log line without the words; the count", () => {
    expect(entry).toContain("for up to an hour");
    expect(entry).toContain("hashes of the document, the passage and the thread");
    expect(entry).toContain("never under who asked");
    expect(entry).toContain("one log line for each answer it gives");
    expect(entry).toContain("a shortened hash of your account id");
    expect(entry).toContain("never the passage, the paper&#x27;s words or anything you wrote");
    expect(entry).toContain("a count of your explanations for the day against your account");
  });

  it("says what stays in the browser, and that signing in does not copy it and signing out leaves it", () => {
    expect(entry).toContain("In this browser, and only here");
    expect(entry).toContain("the passage, where it sits in the paper, the answer and the thread");
    expect(entry).toContain("signing in does not copy it there");
    expect(entry).toContain("Signing out leaves it in place");
    expect(entry).toContain("clearing this site&#x27;s data in your browser removes it");
  });

  it("quotes the box's own labels, so a label that changes in the box shows up here", () => {
    expect(entry).toContain(`“${EXPLAIN.ask}”`);
    expect(entry).toContain(`“${EXPLAIN.searchToggle}”`);
    expect(entry).toContain(`“${EXPLAIN.searchedMark}”`);
  });

  it("ties the one number the entry states to the code: the server's memory holds an answer for an hour", () => {
    expect(EXPLAIN_CAPS.cacheTtlMs).toBe(60 * 60 * 1000);
  });

  it("holds no 'skip' or 'don't read' wording (the copy rule, §1a.4)", () => {
    expect(entry).not.toMatch(/\bskip\b|don.t read/i);
  });
});

// P3-05 (§1h.8 (1); A's P3-04 F1): "Who else sees a request" said Google (Gemini)
// sees a paper's text "when a model report is written". The paragraph-gist pass
// reads the same text once more, so the sentence now says so — and says it happens
// on the one switch that sends the text at all (a deep report: the Deep report
// setting, or an attached PDF), never otherwise. The code the words describe is
// `deepReportRequested` (`use-model-report.ts`), which the page hands the gist hook.
const SEES_TEXT =
  "Google (Gemini) sees a paper's text when a deep report is written, which happens when you turn on Deep report in your profile or attach a PDF to the paper; on that same condition, and never otherwise, the text is read once more to write the one-line gists in the paper's map.";

describe("/privacy — Who else sees a request names the gist pass (P3-05)", () => {
  const html = renderToStaticMarkup(createElement(PrivacyPage));
  const entry = html.slice(html.indexOf(">Who else sees a request<"), html.indexOf(">Removing it<"));

  it("says the paper's text is seen when a deep report is written, and read once more for the map's gists on that same condition and never otherwise", () => {
    expect(entry).toContain(SEES_TEXT.replace(/'/g, "&#x27;"));
    expect(entry).not.toContain("when a model report is written");
  });

  it("keeps the rest of the paragraph it sits in", () => {
    expect(entry).toContain("Tavily sees your search terms only if you add a Tavily key yourself.");
    expect(entry).toContain("Resend sends the email digest if you turn one on.");
  });

  it("names the two things that switch a deep report on, as the report's own predicate reads them", () => {
    expect(entry).toContain("turn on Deep report in your profile");
    expect(entry).toContain("attach a PDF to the paper");
  });
});
