import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
