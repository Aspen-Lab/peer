import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { remoteProfilePayload } from "@/components/profile-sync";
import { settleQuestions } from "@/components/reader/question-field";
import { tokenize } from "@/lib/scoring/tokenize";
import { useProfileStore } from "@/store/profile";
import { useReadingQuestionsStore } from "@/store/reading-questions";
import { defaultProfile } from "@/types";
import { isSecretOrAddressShaped, questionTerms } from "./question-terms";

// P5-04 (S2, §1h.15 (b)): a reader may paste a key or an address into a question box. It must
// never become a ledger term (the ledger travels in every briefing request and, signed in, is
// stored against the account), nor any fragment of it: `tokenize` turns `@ / \ : = .` into
// spaces, so an address would arrive as four plain-looking words. The rule therefore runs over
// the question's words as the reader typed them (split on spaces) and drops the whole word.
// Every shape below is invented: a made-up prefix and a random-looking body, no real format.

const KEY_LONG = "zq9_Hd4k2Mv7xT0pL8wRb3NcY6sUe1Fj"; // 32 characters, with an underscore
const KEY_RUN = "Fq83Lm20Zr45Tv91Xb70"; // 20 letters and digits, mixed
const ADDRESS = "ines.corvo@quillwort-lab.example";
const HOST = "corvo.quillwort.example";
const PATH = "quillwort-lab.example/papers/17";
const WINDOWS_PATH = "C:\\quillwort\\corvo";
const ASSIGNMENT = "token=Mv72kQz94";
const SHAPES = { KEY_LONG, KEY_RUN, ADDRESS, HOST, PATH, WINDOWS_PATH, ASSIGNMENT };

const question = (shape: string) => `Does annealing coarsen the grain boundaries, see ${shape} for details?`;
const SAFE_WORDS = ["annealing", "coarsen", "grain", "boundaries"];

/** Every plain-looking piece of a shape, the way the ledger would have held it. */
const fragments = (shape: string) => tokenize(shape).concat(shape.toLowerCase().split(/[^a-z0-9]+/).filter((f) => f.length >= 3));

describe("isSecretOrAddressShaped", () => {
  it("drops a word longer than 24 characters, and keeps one of 24", () => {
    expect(isSecretOrAddressShaped("q".repeat(25))).toBe(true);
    expect(isSecretOrAddressShaped("q".repeat(24))).toBe(false);
  });

  it("drops a word holding @, /, \\, : or =", () => {
    for (const word of ["a@b", "corvo/quill", "corvo\\quill", "corvo:quill", "corvo=quill"]) {
      expect(isSecretOrAddressShaped(word)).toBe(true);
    }
  });

  it("drops a word with a dot between letters on both sides, and keeps a sentence's own full stop", () => {
    expect(isSecretOrAddressShaped("corvo.quillwort")).toBe(true);
    expect(isSecretOrAddressShaped("boundaries.")).toBe(false);
    expect(isSecretOrAddressShaped("fig.2")).toBe(false);
    expect(isSecretOrAddressShaped("2.5")).toBe(false);
  });

  it("drops a run of 16 or more letters and digits that mixes both, and keeps 15, or 16 of one kind", () => {
    expect(isSecretOrAddressShaped("Fq83Lm20Zr45Tv91")).toBe(true);
    expect(isSecretOrAddressShaped("Fq83Lm20Zr45Tv9")).toBe(false);
    expect(isSecretOrAddressShaped("abcdefghijklmnop")).toBe(false);
    // The run is letters and digits only: a hyphen ends it.
    expect(isSecretOrAddressShaped("x-ray-diffraction-2024")).toBe(false);
  });

  it("keeps an ordinary long scientific word", () => {
    expect("polytetrafluoroethylene").toHaveLength(23);
    expect(isSecretOrAddressShaped("polytetrafluoroethylene")).toBe(false);
    expect(isSecretOrAddressShaped("ti3c2tx")).toBe(false);
  });
});

describe("questionTerms — a key-shaped value or an address never becomes a term", () => {
  for (const [name, shape] of Object.entries(SHAPES)) {
    it(`${name}: neither the value nor any fragment of it is a term, and the question's own words stay`, () => {
      const terms = questionTerms([question(shape)]);
      for (const piece of fragments(shape)) expect(terms).not.toContain(piece);
      expect(JSON.stringify(terms)).not.toContain(shape.toLowerCase());
      for (const word of SAFE_WORDS) expect(terms).toContain(word);
    });
  }

  it("an ordinary 23-character compound still enters", () => {
    expect(questionTerms(["Is polytetrafluoroethylene stable against dendrites?"])).toContain("polytetrafluoroethylene");
  });

  it("a word of 25 characters is dropped, one of 24 enters", () => {
    expect(questionTerms([`Is ${"q".repeat(24)} stable?`])).toContain("q".repeat(24));
    expect(questionTerms([`Is ${"q".repeat(25)} stable?`])).not.toContain("q".repeat(25));
  });

  it("a question made only of such words has no terms", () => {
    expect(questionTerms([`${KEY_LONG} ${ADDRESS} ${KEY_RUN}`])).toEqual([]);
  });

  it("is silent: no log line, no notice", () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
    try {
      expect(Array.isArray(questionTerms([question(ADDRESS), question(KEY_LONG)]))).toBe(true);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });

  it("a shape in a question that is ticked 'Not for recommendations' changes nothing either way", () => {
    const text = question(ADDRESS);
    expect(questionTerms([text], [text])).toEqual([]);
  });
});

describe("after a settle: not in the ledger, and not in what the sync sends", () => {
  const PAPER = "openalex:W515";
  beforeEach(() => {
    useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
    useProfileStore.setState({ profile: { ...defaultProfile } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("holds the question's own words and no piece of any shape", () => {
    useReadingQuestionsStore.getState().set(PAPER, Object.values(SHAPES).slice(0, 5).map(question), false, "2026-10-07T00:00:00.000Z");
    settleQuestions(PAPER);
    const ledger = useProfileStore.getState().profile.preferenceLedger;
    const held = JSON.stringify(ledger);
    expect(held).toContain("annealing");
    const payload = JSON.stringify(remoteProfilePayload(useProfileStore.getState().profile));
    for (const shape of Object.values(SHAPES).slice(0, 5)) {
      for (const piece of fragments(shape)) {
        for (const text of [held, payload]) expect(text).not.toContain(`"${piece}"`);
      }
      for (const text of [held, payload]) expect(text.toLowerCase()).not.toContain(shape.toLowerCase());
    }
    // No ledger label is longer than the longest word the rule lets through.
    for (const entry of Object.values(ledger ?? {})) expect(entry.label.length).toBeLessThanOrEqual(24);
  });

  it("the last two shapes, in a second paper, leave the same", () => {
    useReadingQuestionsStore.getState().set("openalex:W516", [question(PATH), question(WINDOWS_PATH), question(ASSIGNMENT)], false);
    settleQuestions("openalex:W516");
    const payload = JSON.stringify(remoteProfilePayload(useProfileStore.getState().profile)).toLowerCase();
    for (const shape of [PATH, WINDOWS_PATH, ASSIGNMENT]) {
      for (const piece of fragments(shape)) expect(payload).not.toContain(`"${piece}"`);
    }
  });
});
