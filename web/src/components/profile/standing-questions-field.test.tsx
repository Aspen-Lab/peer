import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultProfile } from "@/types";
import { useProfileStore } from "@/store/profile";
import { STANDING } from "@/components/reader/copy";
import { StandingQuestionsField, addDraft, dropEmptyDrafts, removeDraft } from "./standing-questions-field";

// P5-01 (brief commit 1): the Profile page's editor for the standing questions — add, edit, remove,
// up to five, 200 characters, empty lines dropped. The reading face for the typed words, the
// label face for Peer's. The questions below are invented.

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

  it("with none, is the hint and an add control, and no input", () => {
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
    expect(html).toContain('maxLength="200"');
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
