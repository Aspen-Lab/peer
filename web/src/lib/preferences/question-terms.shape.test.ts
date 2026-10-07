import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { remoteProfilePayload } from "@/components/profile-sync";
import { settleQuestions } from "@/components/reader/question-field";
import { specificTerms } from "@/lib/papers/reading-map";
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

// P5-04b (§1h.16 (d)): runs of digits, invented (random-looking, no real format and no real
// number): 16 and 19 digits, alone and inside a word.
const DIGITS_16 = "7305928416503829";
const DIGITS_19 = "5081726394051827364";
const DIGIT_SHAPES = {
  ID_PREFIXED_16: `id-${DIGITS_16}`,
  REF_PREFIXED_19: `ref-${DIGITS_19}`,
  BRACKETED_16: `(${DIGITS_16}),`,
  BRACKETED_19: `[${DIGITS_19}].`,
  LETTERS_THEN_DIGITS: `acct${DIGITS_16}`, // the mixed-run rule already caught this one
  DIGITS_16,
  DIGITS_19,
};

// P5-04c (§1h.17 (b)): digits grouped by separators, a card or a phone number written in groups
// with hyphens, dots, parentheses or brackets and no space. Invented, random-looking, no real
// format and no real number. The word's digits total 16 (4-4-4-4 and 3-3-4-6) or 15 (one fewer).
const HYPHENS_16 = "6150-8273-0419-5936";
const DOTS_16 = "418.206.7395.640128";
const HYPHENS_15 = "6150-8273-0419-593";
const DOTS_15 = "418.206.7395.64012";
const GROUPED_SHAPES = {
  HYPHENS_4444: HYPHENS_16,
  HYPHENS_TRAILING_COMMA: `${HYPHENS_16},`,
  HYPHENS_IN_BRACKETS: `[${HYPHENS_16}]`,
  HYPHENS_IN_PARENTHESES: `(${HYPHENS_16}).`,
  DOTS_3346: DOTS_16,
  DOTS_TRAILING_COMMA: `${DOTS_16},`,
  DOTS_IN_BRACKETS: `[${DOTS_16}]`,
  PARENTHESIS_GROUPS: "(6150)(8273)(0419)(5936)",
  BRACKET_GROUPS: "[6150][8273][0419][5936]",
};
/** The invented groups, for the checks that look for a piece of any of them. */
const GROUPS = ["6150", "8273", "0419", "5936", "593", "418", "206", "7395", "640128", "64012"];

/** The names of the terms (each comes with its share, P5-04 S4). */
const names = (questions: readonly string[], marked: readonly string[] = []) => questionTerms(questions, marked).map((t) => t.term);
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

  // P5-04b (§1h.16 (d), C's P5-04 question 3): a run of 16 or more digits is an
  // identifier, a card or a phone number, the same privacy class as a key. A
  // run of 15 passes this rule; whether such a word becomes a term is
  // `specificTerms`'s business, not this function's.
  it("drops a word holding a run of 16 or more digits, alone or inside a word, and keeps 15", () => {
    expect(isSecretOrAddressShaped(DIGITS_16)).toBe(true);
    expect(isSecretOrAddressShaped(DIGITS_19)).toBe(true);
    for (const shape of Object.values(DIGIT_SHAPES)) expect(isSecretOrAddressShaped(shape)).toBe(true);
    expect(isSecretOrAddressShaped(DIGITS_16.slice(1))).toBe(false); // 15 digits
    expect(isSecretOrAddressShaped(`id-${DIGITS_16.slice(1)}`)).toBe(false);
    // P5-04c (§1h.17 (b)) reverses P5-04b's "a hyphen ends the run": 8 + 8 digits in one hyphenated
    // word total 16, so the word is a shape (this line said `false` in P5-04b; the rule is now the
    // digits' total, whatever separates them).
    expect(isSecretOrAddressShaped(`${DIGITS_16.slice(0, 8)}-${DIGITS_16.slice(8)}`)).toBe(true);
    expect(isSecretOrAddressShaped("2024")).toBe(false);
    expect(isSecretOrAddressShaped("10000000")).toBe(false);
  });

  // P5-04c (§1h.17 (b), C's P5-04b question 1): a card or a phone number written in groups with
  // hyphens, dots, parentheses or brackets and no space is one word whose digits total 16 or more:
  // a shape too, whatever separates the groups. A public identifier written that way (an ORCID iD)
  // goes with them, at no cost: it names a person, never a topic.
  it("drops a word whose digits total 16 or more, whatever separates them, and keeps 15 (P5-04c)", () => {
    for (const shape of Object.values(GROUPED_SHAPES)) expect(isSecretOrAddressShaped(shape)).toBe(true);
    // The count is of the digits (`\p{Nd}`) of the whole word: other scripts' decimal digits too.
    expect(isSecretOrAddressShaped("٦١٥٠-٨٢٧٣-٠٤١٩-٥٩٣٦")).toBe(true);
    expect(isSecretOrAddressShaped("６１５０-８２７３-０４１９-５９３６")).toBe(true);
    // Letters around the groups do not hide them.
    expect(isSecretOrAddressShaped(`id-${HYPHENS_16}`)).toBe(true);
    expect(isSecretOrAddressShaped(`ref${DOTS_16}`)).toBe(true);
    // 15 digits in groups pass this rule (whether such a word becomes a term is `specificTerms`'s business).
    for (const word of [HYPHENS_15, DOTS_15, `${HYPHENS_15},`, `[${HYPHENS_15}]`, `[${DOTS_15}],`, "(6150)(8273)(0419)(593)"]) {
      expect(isSecretOrAddressShaped(word)).toBe(false);
    }
    // A hyphenated word with a few digits is an ordinary word.
    for (const word of ["2-step", "1234-5678-90", "4-4-2", "x-ray-diffraction-2024", "2026-10-07", "Ti3C2Tx-2024", "3.14159"]) {
      expect(isSecretOrAddressShaped(word)).toBe(false);
    }
  });

  it("keeps the groups of a number written with spaces: each is a word of its own (P5-04c)", () => {
    for (const group of ["6150", "8273", "0419", "5936", "(6150)", "[8273]", "418.", "640128,"]) {
      expect(isSecretOrAddressShaped(group)).toBe(false);
    }
  });
});

describe("questionTerms — a key-shaped value or an address never becomes a term", () => {
  for (const [name, shape] of Object.entries(SHAPES)) {
    it(`${name}: neither the value nor any fragment of it is a term, and the question's own words stay`, () => {
      const terms = names([question(shape)]);
      for (const piece of fragments(shape)) expect(terms).not.toContain(piece);
      expect(JSON.stringify(terms)).not.toContain(shape.toLowerCase());
      for (const word of SAFE_WORDS) expect(terms).toContain(word);
    });
  }

  it("an ordinary 23-character compound still enters", () => {
    expect(names(["Is polytetrafluoroethylene stable against dendrites?"])).toContain("polytetrafluoroethylene");
  });

  it("a word of 25 characters is dropped, one of 24 enters", () => {
    expect(names([`Is ${"q".repeat(24)} stable?`])).toContain("q".repeat(24));
    expect(names([`Is ${"q".repeat(25)} stable?`])).not.toContain("q".repeat(25));
  });

  it("a question made only of such words has no terms", () => {
    expect(names([`${KEY_LONG} ${ADDRESS} ${KEY_RUN}`])).toEqual([]);
  });

  // P5-04b (§1h.16 (d)): a number of 16 or more digits, alone or inside a word, is an
  // identifier, a card or a phone number; it gives no term, nor any fragment of it.
  for (const [name, shape] of Object.entries(DIGIT_SHAPES)) {
    it(`${name}: no term holds the number or any fragment of it, and the question's own words stay (P5-04b)`, () => {
      const terms = names([question(shape)]);
      for (const piece of fragments(shape)) expect(terms).not.toContain(piece);
      for (const term of terms) expect(term).not.toMatch(/\d{16}/);
      expect(JSON.stringify(terms)).not.toContain(DIGITS_16);
      expect(JSON.stringify(terms)).not.toContain(DIGITS_19);
      for (const word of SAFE_WORDS) expect(terms).toContain(word);
    });
  }

  it("a question made only of such numbers has no terms (P5-04b)", () => {
    expect(names([`${DIGITS_16} ${DIGITS_19} ${DIGIT_SHAPES.ID_PREFIXED_16}`])).toEqual([]);
  });

  // P5-04c (§1h.17 (b)): a number written in groups of digits with separators and no space, whose
  // digits total 16 or more, gives no term, nor any fragment of it (a group, a piece of a group).
  for (const [name, shape] of Object.entries(GROUPED_SHAPES)) {
    it(`${name}: no term holds the grouped number or any group of it, and the question's own words stay (P5-04c)`, () => {
      const terms = names([question(shape)]);
      for (const piece of [...fragments(shape), ...GROUPS]) expect(terms).not.toContain(piece);
      // The question's own words hold no digit at all, so no term does.
      for (const term of terms) expect(term).not.toMatch(/\d/);
      expect(JSON.stringify(terms)).not.toContain(HYPHENS_16);
      expect(JSON.stringify(terms)).not.toContain(DOTS_16);
      for (const word of SAFE_WORDS) expect(terms).toContain(word);
    });
  }

  it("a question made only of grouped numbers has no terms (P5-04c)", () => {
    expect(names([Object.values(GROUPED_SHAPES).join(" ")])).toEqual([]);
    expect(names([`${HYPHENS_16} ${DOTS_16}`, `[${HYPHENS_16}], (${DOTS_16}).`])).toEqual([]);
  });

  it("a number of 15 digits in groups is not a shape: the rule leaves it to specificTerms (P5-04c)", () => {
    for (const word of [HYPHENS_15, DOTS_15, `[${HYPHENS_15}]`]) {
      const text = question(word);
      expect(names([text])).toEqual(specificTerms(text));
      for (const safe of SAFE_WORDS) expect(names([text])).toContain(safe);
    }
  });

  it("groups separated by spaces are separate words and stay as they are (P5-04c)", () => {
    const text = question("6150 8273 0419 5936");
    expect(names([text])).toEqual(specificTerms(text));
    for (const safe of SAFE_WORDS) expect(names([text])).toContain(safe);
  });

  it("is silent: no log line, no notice", () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
    try {
      expect(Array.isArray(names([question(ADDRESS), question(KEY_LONG)]))).toBe(true);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });

  it("a shape in a question that is ticked 'Not for recommendations' changes nothing either way", () => {
    const text = question(ADDRESS);
    expect(names([text], [text])).toEqual([]);
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

  it("a number of 16 or more digits, alone or inside a word, leaves the ledger and the sync's payload untouched (P5-04b)", () => {
    const first = [DIGITS_16, DIGITS_19, DIGIT_SHAPES.ID_PREFIXED_16, DIGIT_SHAPES.REF_PREFIXED_19, DIGIT_SHAPES.BRACKETED_16];
    const second = [DIGIT_SHAPES.BRACKETED_19, DIGIT_SHAPES.LETTERS_THEN_DIGITS];
    useReadingQuestionsStore.getState().set(PAPER, first.map(question), false, "2026-10-07T00:00:00.000Z");
    settleQuestions(PAPER);
    useReadingQuestionsStore.getState().set("openalex:W517", second.map(question), false, "2026-10-07T00:00:00.000Z");
    settleQuestions("openalex:W517");
    const ledger = useProfileStore.getState().profile.preferenceLedger;
    const held = JSON.stringify(ledger);
    expect(held).toContain("annealing");
    const payload = JSON.stringify(remoteProfilePayload(useProfileStore.getState().profile));
    for (const text of [held, payload]) {
      expect(text).not.toContain(DIGITS_16);
      expect(text).not.toContain(DIGITS_19);
    }
    for (const shape of [...first, ...second]) {
      for (const piece of fragments(shape)) for (const text of [held, payload]) expect(text).not.toContain(`"${piece}"`);
    }
  });

  it("a number written in groups of digits leaves the ledger and the sync's payload untouched (P5-04c)", () => {
    const shapes = Object.values(GROUPED_SHAPES);
    useReadingQuestionsStore.getState().set(PAPER, shapes.slice(0, 5).map(question), false, "2026-10-07T00:00:00.000Z");
    settleQuestions(PAPER);
    useReadingQuestionsStore.getState().set("openalex:W518", shapes.slice(5).map(question), false, "2026-10-07T00:00:00.000Z");
    settleQuestions("openalex:W518");
    const ledger = useProfileStore.getState().profile.preferenceLedger;
    const held = JSON.stringify(ledger);
    expect(held).toContain("annealing");
    const payload = JSON.stringify(remoteProfilePayload(useProfileStore.getState().profile));
    for (const text of [held, payload]) {
      expect(text).not.toContain(HYPHENS_16);
      expect(text).not.toContain(DOTS_16);
    }
    for (const shape of shapes) {
      for (const piece of [...fragments(shape), ...GROUPS]) for (const text of [held, payload]) expect(text).not.toContain(`"${piece}"`);
    }
    // The ledger holds only the question's own words: not one label carries a digit.
    for (const entry of Object.values(ledger ?? {})) expect(entry.label).not.toMatch(/\d/);
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
