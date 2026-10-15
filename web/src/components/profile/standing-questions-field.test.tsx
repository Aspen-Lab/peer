import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultProfile } from "@/types";
import { useProfileStore } from "@/store/profile";
import { STANDING } from "@/components/reader/copy";
import { StandingQuestionsField, addDraft, dropEmptyDrafts, removeDraft } from "./standing-questions-field";

// P5-01 (brief commit 1): the Profile page's editor for the standing questions — add, edit, remove,
// up to five, 500 characters (P7-13), empty lines dropped. The reading face for the typed words, the
// label face for Peer's. The questions below are invented. P10-03 (review 2.3): the one switch beside
// them, "Use my questions to tune recommendations", which replaces the per-question tick.

const INVENTED = ["Which cohort was studied, and how large was it?", "Are negative findings reported?"];

describe("addDraft / removeDraft / dropEmptyDrafts — the editor's pure steps", () => {
  it("adds one empty line after a filled last line, never past five, never a second empty one", () => {
    expect(addDraft(["a?"])).toEqual(["a?", ""]);
    expect(addDraft(["a?", ""])).toEqual(["a?", ""]);
    expect(addDraft(["1", "2", "3", "4", "5"])).toEqual(["1", "2", "3", "4", "5"]);
    expect(addDraft([])).toEqual([""]);
  });

  it("removes the line asked for", () => {
    expect(removeDraft(["a?", "b?", "c?"], 1)).toEqual(["a?", "c?"]);
    expect(removeDraft(["a?"], 0)).toEqual([]);
  });

  it("drops empty and blank lines when the reader leaves the field", () => {
    expect(dropEmptyDrafts(["a?", "", "  ", "b?"])).toEqual(["a?", "b?"]);
  });
});

describe("StandingQuestionsField — what it shows", () => {
  beforeEach(() => useProfileStore.setState({ profile: { ...defaultProfile } }));

  it("with none, is the hint and an add control, and no text input", () => {
    const html = renderToStaticMarkup(createElement(StandingQuestionsField));
    expect(html).toContain(STANDING.hint);
    expect(html).toContain(STANDING.add);
    expect(html).not.toContain("<input");
  });

  it("with some, shows each in a reading-face input with a remove control, the typed words kept", () => {
    useProfileStore.setState({ profile: { ...defaultProfile, standingQuestions: INVENTED } });
    const html = renderToStaticMarkup(createElement(StandingQuestionsField));
    expect(html.match(/<input/g)).toHaveLength(2);
    expect(html).toContain(`value="${INVENTED[0]}"`);
    expect(html).toContain(`value="${INVENTED[1]}"`);
    expect(html).toContain('maxLength="500"');
    expect(html).toContain(`aria-label="${STANDING.line(1)}"`);
    expect(html).toContain(`aria-label="${STANDING.remove(2)}"`);
    expect(html).toMatch(/<input[^>]*class="[^"]*font-reading/);
    // Peer's own words are in the label face, not the reading face.
    expect(html).toMatch(/<(button|p)[^>]*class="[^"]*(annotation|eyebrow)[^"]*"[^>]*>[^<]*Add a question/);
  });

  it("with five, offers no add control", () => {
    useProfileStore.setState({ profile: { ...defaultProfile, standingQuestions: ["1?", "2?", "3?", "4?", "5?"] } });
    const html = renderToStaticMarkup(createElement(StandingQuestionsField));
    expect(html.match(/<input/g)).toHaveLength(5);
    expect(html).not.toContain(STANDING.add);
  });
});

// P10-03 (review 2.3, rubric A6): the one opt-out of what the questions teach Peer, beside the standing questions.
describe("StandingQuestionsField — the switch that replaces the per-question tick", () => {
  beforeEach(() => useProfileStore.setState({ profile: { ...defaultProfile } }));
  const render = () => renderToStaticMarkup(createElement(StandingQuestionsField));
  const toggle = (html: string) => /<button[^>]*role="switch"[^>]*>/.exec(html)?.[0];

  it("is a labelled switch with the one line under it, in the label face, below the standing questions", () => {
    const html = render();
    expect(toggle(html)).toBeDefined();
    expect(toggle(html)).toContain(`aria-label="${STANDING.tuneLabel}"`);
    expect(html).toContain(STANDING.tuneLabel);
    expect(html).toContain(STANDING.tuneHint);
    expect(html).toMatch(new RegExp(`<p[^>]*class="[^"]*annotation[^"]*"[^>]*>${STANDING.tuneHint}</p>`));
    // Beside the standing questions: after the editor's own hint, in the same row.
    expect(html.indexOf(STANDING.tuneLabel)).toBeGreaterThan(html.indexOf(STANDING.hint));
  });

  it("is on by default (the field absent), on when true and off when false", () => {
    expect(toggle(render())).toContain('aria-checked="true"');
    useProfileStore.setState({ profile: { ...defaultProfile, questionsTuneRecommendations: true } });
    expect(toggle(render())).toContain('aria-checked="true"');
    useProfileStore.setState({ profile: { ...defaultProfile, questionsTuneRecommendations: false } });
    expect(toggle(render())).toContain('aria-checked="false"');
  });

  it("is the page's one switch for the questions: there is no checkbox and no per-question opt-out label anywhere", () => {
    useProfileStore.setState({ profile: { ...defaultProfile, standingQuestions: INVENTED } });
    const html = render();
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain(["Not for", "recommendations"].join(" "));
    expect(html.match(/role="switch"/g)).toHaveLength(1);
  });

  it("says nothing about removing what was learned: the line is short, and /privacy says the rest", () => {
    expect(STANDING.tuneHint.length).toBeLessThan(140);
    expect(render()).not.toMatch(/removes? what|forget/i);
  });
});
