import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PrivacyPage from "./page";

// P2-03 (§1g.11 e, the entry §1f.9 promised): the reader's questions are
// named on /privacy, in exactly these words, beside "Your notes".

const QUESTIONS_TEXT =
  "Questions you type on a paper page stay in this browser. When Peer writes a deep report for that paper, they travel with that one request so the report can answer them; Peer does not log them or keep them.";

describe("/privacy — Your questions (P2-03)", () => {
  const html = renderToStaticMarkup(createElement(PrivacyPage));

  it("has the entry, with exactly the ruled text", () => {
    expect(html).toContain(">Your questions<");
    expect(html).toContain(`<p>${QUESTIONS_TEXT.replace(/'/g, "&#x27;")}</p>`);
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
