import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EXPLAIN } from "@/components/reader/copy";
import { EXPLAIN_CAPS } from "@/lib/papers/explain";
import PrivacyPage from "./page";

// P2-03 (§1g.11 e, the entry §1f.9 promised): the reader's questions are
// named on /privacy, in exactly these words, beside "Your notes".
//
// P4-00: "the model provider you or the owner configured" became "the model
// provider whose key you added" — there is no owner's model any more.
//
// P2-08b (§1g.17, F2): the words changed. The old text said only that the
// questions "travel with that one request"; they also go on to the model
// provider inside the prompts, which the entry now names, and only a deep
// request carries them at all. The exact-text assertion below is rewritten to
// the new words (the same assertion, the new ruling), and a second one pins
// the provider.

const QUESTIONS_TEXT =
  "Questions you type on a paper page stay in this browser. When Peer writes a deep report for that paper, they travel with that one request to Peer's server and on to the model provider whose key you added, inside the prompts, and nowhere else, so the report can answer them; Peer does not log them or keep them.";

describe("/privacy — Your questions (P2-03)", () => {
  const html = renderToStaticMarkup(createElement(PrivacyPage));

  it("has the entry, with exactly the ruled text", () => {
    expect(html).toContain(">Your questions<");
    expect(html).toContain(`<p>${QUESTIONS_TEXT.replace(/'/g, "&#x27;")}</p>`);
  });

  it("names the model provider the questions go on to, and that they go nowhere else (P2-08b)", () => {
    const entry = html.slice(html.indexOf(">Your questions<"), html.indexOf(">Your own model key<"));
    expect(entry).toContain("model provider whose key you added");
    expect(entry).not.toContain("the owner configured");
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
  "Selecting a passage sends nothing, and neither does typing in the box. Peer sends a request only when you click “Explain this?” (or press E on a selection) and, for a follow-up, when you press Enter or Send, or Say more under a reply. A reply is short unless you ask for more, in your own words or with Say more. The request carries the passage you selected, the paragraph it sits in and the one on either side of it, the paper's title and abstract, one line for each section of the paper's map and, for a follow-up, the messages of that thread. The request also carries the paper's record as this page holds it — its title, authors, venue, where it came from and your save and feedback marks on it — so Peer's server can find the paper; of that record the model sees only the title and the abstract. The answer is written with your own model key, which goes with the request.",
  "The request goes to Peer's server and on to the model provider whose key you added. The answer runs on your own key, and it is short unless you ask for more.",
  "On a follow-up you can turn on “Search the web” for that one message. It is off every time the box opens and never turns on by itself. With it on, the provider may run a web search to write that reply: Gemini does this with Google Search, and with any other provider the reply is written without a search and the box says so. A message answered with a search carries the mark “searched the web”, and Peer shows no link to anything the search found.",
  "Peer's server keeps two things. First, each answer it gives, in memory, for up to an hour, so the same passage asked about again is answered without another model call; it is filed under hashes of the document, the passage and the thread, never under who asked.",
  "Second, one log line for each answer it gives: how many characters went out and came back and, if you are signed in, a shortened hash of your account id — never the passage, the paper's words or anything you wrote.",
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

  // P3-07 (§1h.9 (5)): the sentence about sending gains "Say more" — the third thing
  // that sends — and one clause says a reply is short unless the reader asks for more.
  // The paragraph above is pinned whole; these name the two changes on their own.
  it("names Say more among the things that send, and says a reply is short unless you ask for more", () => {
    expect(entry).toContain("when you press Enter or Send, or Say more under a reply");
    expect(entry).toContain("A reply is short unless you ask for more, in your own words or with Say more.");
    // Say more sends only on the press: the entry still says nothing is sent before.
    expect(entry).toContain("Selecting a passage sends nothing, and neither does typing in the box");
    expect(entry.indexOf("Say more")).toBeGreaterThan(entry.indexOf("press Enter or Send"));
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
    expect(first.indexOf("The answer is written with your own model key")).toBeGreaterThan(first.indexOf("of that record the model sees only"));
  });

  // P4-00: the provider is the one whose key the reader added; Peer's own model, the
  // owner's configuration, the daily allowance and the usage row are all gone, and the
  // entry says none of them.
  it("names the provider the request goes on to: the one whose key the reader added, running on their own key", () => {
    expect(entry).toContain("model provider whose key you added");
    expect(entry).toContain("The answer runs on your own key, and it is short unless you ask for more.");
    expect(entry).toContain("Gemini");
    expect(entry).toContain("Google");
    for (const gone of ["Peer&#x27;s own model", "the owner configured", "allowance", "usage row", "What is recorded about model use"]) {
      expect(entry).not.toContain(gone);
    }
  });

  it("says the web search is off every time the box opens, never on by itself, and runs for one message", () => {
    expect(entry).toContain("off every time the box opens");
    expect(entry).toContain("never turns on by itself");
    expect(entry).toContain("for that one message");
    expect(entry).toContain("Google Search");
    expect(entry).toContain("the reply is written without a search and the box says so");
    expect(entry).toContain("shows no link to anything the search found");
  });

  it("says what Peer's server keeps: an hour's memory under hashes, never by reader; one log line without the words", () => {
    expect(entry).toContain("for up to an hour");
    expect(entry).toContain("hashes of the document, the passage and the thread");
    expect(entry).toContain("never under who asked");
    expect(entry).toContain("one log line for each answer it gives");
    expect(entry).toContain("a shortened hash of your account id");
    expect(entry).toContain("never the passage, the paper&#x27;s words or anything you wrote");
    expect(entry).toContain("Peer&#x27;s server keeps two things");
    expect(entry).not.toContain("a count of your explanations");
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
  "The model provider whose key you added sees what a model request carries: your topics and a paper's title and abstract when the briefing is ranked or summarised, and a paper's text when a deep report is written, which happens when you turn on Deep report in your profile or attach a PDF to the paper; on that same condition, and never otherwise, the text is read once more to write the one-line gists in the paper's map.";

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

// P4-00c (N7, A's P4-00b): what Peer's server keeps of an uploaded PDF is named on
// /privacy, in "If you sign in" (an upload needs an account: `uploadOwner` answers
// no one in production without one). The sentence is written from the upload store
// and pinned clause by clause to the line that makes it true, as the Jev section
// is: where the three objects are, what the record holds, whose they are, how
// long, how they go, and the hour in memory. The consent dialog's own sentence
// ("stays private to your account ... for 30 days") is the other half the reader
// sees; both must say the same number.
//
// Not claimed, on purpose: "and nowhere else". The server's memory holds parts of
// the text for up to an hour (named in the sentence), and a saved upload is a
// saved paper like any other, which the page already lists under "papers you save".
const UPLOAD_TEXT =
  "If you upload a private PDF, Peer's server keeps the PDF, a record of it (its file name, title and abstract, and when it expires) and the text Peer read out of it, in its own file storage against your account, for 30 days, after which a daily sweep removes them, or until you delete the upload. While you read it, the text also sits in the server's memory for up to an hour.";

describe("/privacy — an uploaded PDF's storage on Peer's server (P4-00c N7)", () => {
  const html = renderToStaticMarkup(createElement(PrivacyPage));
  const root = process.cwd();
  const read = (file: string) => readFileSync(join(root, file), "utf8");

  it("has the sentence, word for word, in 'If you sign in' and nowhere else", () => {
    const signIn = html.slice(html.indexOf(">If you sign in<"), html.indexOf(">Your notes<"));
    expect(signIn).toContain(`<p>${UPLOAD_TEXT.replace(/'/g, "&#x27;")}</p>`);
    expect(html.split(UPLOAD_TEXT.slice(0, 40).replace(/'/g, "&#x27;")).length - 1).toBe(1);
  });

  it("keeps the PDF, its record and the text read out of it: the three objects the store writes under one upload's name", () => {
    const store = read("src/lib/papers/upload-store.ts");
    expect(store).toContain("return `${hash16}.pdf`;");
    expect(store).toContain("return `${hash16}.json`;");
    expect(store).toContain("return `${hash16}.doc.json`;");
  });

  it("names what the record holds, each a field of the stored record: file name, title, abstract, expiry", () => {
    const store = read("src/lib/papers/upload-store.ts");
    const record = store.slice(store.indexOf("export interface UploadMeta"), store.indexOf("export function uploadMetaToPaper") > 0 ? store.indexOf("export function uploadMetaToPaper") : undefined);
    expect(record).toMatch(/\bfileName: string;/);
    expect(record).toMatch(/\btitle: string;/);
    expect(record).toMatch(/\bsummaryIntro\?: string;/);
    expect(record).toMatch(/\bexpiresAt\?: string;/);
  });

  it("files it against the reader's account: the owner key is a digest of the account, and a read must match it", () => {
    const access = read("src/lib/papers/upload-access.ts");
    expect(access).toContain("createHash(\"sha256\").update(`account:${user.id}`).digest(\"hex\")");
    expect(access).toContain("meta.ownerKey !== key");
    // Production has no other owner: without an account there is no upload.
    expect(access).toMatch(/process\.env\.NODE_ENV === "production" \|\| process\.env\.VERCEL[^\n]*\) return null;/);
  });

  it("keeps it 30 days, and the consent dialog tells the reader the same number", () => {
    expect(read("src/app/api/papers/upload/route.ts")).toContain("expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString()");
    const dialog = read("src/components/briefing/upload-consent-dialog.tsx");
    expect(dialog).toContain("Your PDF stays private to your account");
    expect(dialog).toContain("for 30 days.");
  });

  it("removes them after that by a daily sweep: the cron, the route it calls and the purge's own deletion", () => {
    const cron = JSON.parse(read("../vercel.json")) as { crons: { path: string; schedule: string }[] };
    const purge = cron.crons.find((entry) => entry.path === "/api/jobs/purge-uploads");
    expect(purge?.schedule).toMatch(/^\d+ \d+ \* \* \*$/);
    expect(read("src/app/api/jobs/purge-uploads/route.ts")).toContain("await purgeExpiredUploads();");
    const store = read("src/lib/papers/upload-store.ts");
    const purgeBody = store.slice(store.indexOf("export async function purgeExpiredUploads"), store.indexOf("async function purgeAbandonedStagedUploads"));
    expect(purgeBody).toContain("Date.parse(meta.expiresAt) <= Date.now()) await deleteUpload(meta);");
  });

  it("removes them all when the reader deletes the upload: the record, the PDF and the text", () => {
    const store = read("src/lib/papers/upload-store.ts");
    const start = store.indexOf("export async function deleteUpload");
    const deleteBody = store.slice(start, store.indexOf("\n}\n", start));
    expect(deleteBody).toContain("backend.remove([metaName(meta.hash16)])");
    expect(deleteBody).toContain("backend.remove([pdfName(meta.hash16)])");
    expect(deleteBody).toContain("await removeUploadDoc(meta.hash16)");
    expect(read("src/app/api/papers/upload/[id]/route.ts")).toContain("await deleteUpload(meta);");
  });

  it("ties the hour in memory to the code: the extracted text is held for an hour", () => {
    expect(read("src/lib/papers/upload-store.ts")).toContain("const DOC_CACHE_TTL_MS = 60 * 60 * 1000;");
    expect(read("src/lib/papers/full-text.ts")).toContain("const CACHE_TTL_MS = 60 * 60 * 1000;");
  });

  it("makes no claim it cannot keep: no 'nowhere else' about the PDF", () => {
    const signIn = html.slice(html.indexOf(">If you sign in<"), html.indexOf(">Your notes<"));
    const from = signIn.indexOf("If you upload a private PDF");
    expect(from).toBeGreaterThan(-1);
    const sentence = signIn.slice(from, signIn.indexOf("</p>", from));
    expect(sentence).not.toMatch(/nowhere else|no one else|never leaves/i);
  });
});
