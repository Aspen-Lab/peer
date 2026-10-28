import { describe, expect, it } from "vitest";
import { canonicalizeHeading, withInheritedBuckets, withSectionIds, type ExtractedDocument } from "./html-text";
import { buildReadingMap, readableSections } from "./reading-map";
import { closingPartition, type GuidePartition } from "./reading-partition";

// P12-63 (rule 2; ruling §1h.436 (c)): the closing split's echo test uses the abstract when the reading has one, else the last paragraph of the
// setup part - the paper's own announcement of what it shows; neither, no split. A Nature-style article prints no abstract in its text, and its
// introduction ends on "here we show ...". Every text is invented ("a survey of shore snails"): no sentence of any paper, no owner's PDF.

const SNAILS = "Snail density rises with wave exposure";
const SHELLS = "Shell thickness follows crab predation";
const STORMS = "Recovery after storm scouring";
/** The paper's own announcement, the last paragraph of its introduction. Long words (7+): exposure, density, predation, thickens. */
const ANNOUNCE = "Here we show that wave exposure raises snail density and that crab predation thickens shells.";
/** The closing: cue "taken together" / "we show", no figure; long words together, exposure, density, predation, thickens - four of five in ANNOUNCE. */
const SUMMARY = "Taken together, we show that wave exposure raises snail density and that crab predation thickens the shells.";
/** A closing paragraph that is outlook (no cue). */
const OUTLOOK = "Future surveys could follow the recovery of algal cover after storm scouring across more shores.";
/** An abstract (and an introduction's last paragraph) about something else: no long word of SUMMARY in it. */
const ELSEWHERE = "Kelp forests recede under warming oceans and urchin grazing.";
/** An abstract the closing restates. */
const ABSTRACT = "Snail density rises with wave exposure while shell thickness follows crab predation, and storm scouring resets algal cover on the shore.";

/** `n` plain results paragraphs: no cue, no figure, no long word of SUMMARY. */
const plain = (n: number, seed = 0): string[] =>
  Array.from({ length: n }, (_, k) => `The survey logged ${10 + k + seed} counts of ${["limpets", "barnacles", "periwinkles"][(k + seed) % 3]} on the rocky shore.`);

/** A paper from `[heading, paragraphs[]]`, built the way the extractors hand it over. */
function shore(rows: ReadonlyArray<readonly [string, readonly string[]]>): ExtractedDocument {
  return {
    sections: withSectionIds(withInheritedBuckets(rows.map(([heading, paragraphs]) => ({ heading, canonical: canonicalizeHeading(heading), text: paragraphs.join("\n\n") })))),
    figureCaptions: [],
    source: "pdf",
  };
}

const bodyOf = (doc: ExtractedDocument) => readableSections(doc).map(({ id, section, paragraphs }) => ({ id, canonical: section.canonical, paragraphs }));

/** The closing split of `doc` against `abstract` (none by default: the reading has no abstract). */
function splitOf(doc: ExtractedDocument, abstract: string | null | undefined = undefined): GuidePartition | null {
  return closingPartition(buildReadingMap(doc), bodyOf(doc), abstract);
}

/** The Nature-style paper: front text ending on the announcement, three descriptive parts, the last ending on the closing, then the back matter. */
function nature(intro: readonly string[] = [...plain(2), ANNOUNCE], last: readonly string[] = [...plain(3), SUMMARY, OUTLOOK]): ExtractedDocument {
  return shore([
    ["Body", intro],
    [SNAILS, plain(4, 1)],
    [SHELLS, plain(4, 2)],
    [STORMS, last],
    ["Online content", plain(1)],
    ["References", plain(3)],
    ["Methods", plain(3)],
  ]);
}

const SPLIT = (sectionId: string): GuidePartition => ({
  sectionId,
  closing: true,
  parts: [
    { role: "results", fromParagraph: 0, toParagraph: 2 },
    { role: "conclusion", fromParagraph: 3, toParagraph: 4 },
  ],
});

describe("closingPartition - a paper with no abstract takes the echo from the last paragraph of its setup part (P12-63, rule 2)", () => {
  it("(a) splits a Nature-style paper that prints no abstract, on its announcing last introduction paragraph", () => {
    const doc = nature();
    const storms = buildReadingMap(doc).sections.find((row) => row.heading === STORMS)!;

    expect(splitOf(doc)).toEqual(SPLIT(storms.id));
    // Each form of "the reading has no abstract" reads the same way.
    expect(splitOf(doc, null)).toEqual(SPLIT(storms.id));
    expect(splitOf(doc, "")).toEqual(SPLIT(storms.id));
  });

  it("reads a named introduction the same way as the front text", () => {
    const doc = shore([
      ["1 Introduction", [...plain(2), ANNOUNCE]],
      ["2 " + SNAILS, plain(3)],
      ["3 " + STORMS, [...plain(3), SUMMARY, OUTLOOK]],
      ["4 Methods", plain(2)],
    ]);

    expect(splitOf(doc)?.sectionId).toBe("s2");
  });

  it("takes the LAST paragraph of the setup part, not another", () => {
    // Re-aimed by C P12-85 (§1h.464): the two paragraphs are given 40 words each (`ofWords`: the filler adds no long word). At 16 and 9 words neither is
    // long, and the echo is now the longest paragraph of the part (here the announcement, wherever it stands), not the last; "the last" holds among
    // the paragraphs of 40 words or more. The short pair is read in the P12-85 block below.
    // The announcement first, an unrelated paragraph last: the last is the echo, and the closing does not restate it.
    expect(splitOf(nature([ofWords(40, ANNOUNCE), ...plain(1), ofWords(40, ELSEWHERE)]))).toBeNull();
    // The announcement last: the same paper splits.
    expect(splitOf(nature([ELSEWHERE, ...plain(1), ANNOUNCE]))?.parts[1].fromParagraph).toBe(3);
  });

  it("holds the closing to the 20 % share against that paragraph, as against an abstract", () => {
    // One long word of five (20 %) passes; none (0 %) does not.
    const oneOfFive = "Dense colonies persist where predation is low and shelter is common.";
    const noneOfFive = "Dense colonies persist where shelter is common and tides are gentle.";

    expect(splitOf(nature([...plain(1), oneOfFive]))).not.toBeNull();
    expect(splitOf(nature([...plain(1), noneOfFive]))).toBeNull();
  });

  it("takes the last introduction row that holds a paragraph, sub-heading or not", () => {
    const doc = shore([
      ["1 Introduction", plain(2)],
      ["1.1 What this survey adds", [ANNOUNCE]],
      ["2 " + SNAILS, plain(3)],
      ["3 " + STORMS, [...plain(3), SUMMARY, OUTLOOK]],
      ["4 Methods", plain(2)],
    ]);

    expect(splitOf(doc)?.sectionId).toBe("s3");
  });

  it("reads the introduction, not a related-work part that stands after it", () => {
    const related = shore([
      ["1 Introduction", [...plain(1), ANNOUNCE]],
      ["2 Related work", [...plain(1), ELSEWHERE]],
      ["3 " + STORMS, [...plain(3), SUMMARY, OUTLOOK]],
      ["4 Methods", plain(2)],
    ]);

    expect(splitOf(related)?.sectionId).toBe("s2");
  });

  it("reads the last setup row when the paper names no introduction", () => {
    const doc = shore([
      ["Related work", [...plain(1), ANNOUNCE]],
      ["Results", [...plain(3), SUMMARY, OUTLOOK]],
      ["Methods", plain(2)],
    ]);

    expect(buildReadingMap(doc).sections.map((row) => row.role)).toEqual(["setup", "evidence", "method"]);
    expect(splitOf(doc)?.sectionId).toBe("s1");
  });

  it("reads only a setup part that stands before the row it divides", () => {
    // The announcing related-work part stands after the results: it is not the paper's announcement.
    const after = shore([
      ["Results", [...plain(3), SUMMARY, OUTLOOK]],
      ["Related work", [...plain(1), ANNOUNCE]],
      ["Methods", plain(2)],
    ]);

    expect(splitOf(after)).toBeNull();
  });

  it("passes over a group heading that holds no paragraph of its own", () => {
    const group = shore([
      ["1 Introduction", []],
      ["1.1 What this survey adds", [...plain(1), ANNOUNCE]],
      ["2 " + SNAILS, plain(3)],
      ["3 " + STORMS, [...plain(3), SUMMARY, OUTLOOK]],
      ["4 Methods", plain(2)],
    ]);
    const map = buildReadingMap(group);

    expect(map.sections.slice(0, 2).map((row) => [row.canonical, row.paragraphs.length])).toEqual([["introduction", 0], ["introduction", 2]]);
    expect(splitOf(group)?.sectionId).toBe("s3");
  });

  it("has no split where the setup part holds no paragraph, or there is none: neither an abstract nor an announcement", () => {
    const doc = nature();
    const map = buildReadingMap(doc);
    const body = bodyOf(doc);
    const none = shore([["Results", [...plain(3), SUMMARY, OUTLOOK]], ["Methods", plain(2)], ["References", plain(2)]]);

    // The only setup row is empty in the body the split is handed: no word to echo, and no error.
    expect(closingPartition(map, body.map((section, k) => (k === 0 ? { ...section, paragraphs: [] } : section)), undefined)).toBeNull();
    expect(splitOf(none)).toBeNull();
    // The abstract, where there is one, still splits the paper that has no setup part.
    expect(splitOf(none, ABSTRACT)?.sectionId).toBe("s0");
  });

  it("(b) uses the abstract when the reading has one: the setup paragraph is then not looked at", () => {
    // An abstract the closing restates splits the paper whose announcement is about something else...
    expect(splitOf(nature([...plain(1), ELSEWHERE]), ABSTRACT)?.parts[1].fromParagraph).toBe(3);
    // ...and an abstract about something else leaves the paper whole although the announcement matches.
    expect(splitOf(nature(), ELSEWHERE)).toBeNull();
  });

  it("falls back to the setup paragraph when the abstract has no long word", () => {
    expect(splitOf(nature(), "Snails on a shore.")?.parts[1].fromParagraph).toBe(3);
  });

  it("keeps the rules that do not depend on the echo", () => {
    // A named conclusion, no cue, and a figure cited: no split whatever the echo is.
    const named = shore([
      ["Body", [...plain(2), ANNOUNCE]],
      [SNAILS, plain(3)],
      [STORMS, [...plain(3), SUMMARY, OUTLOOK]],
      ["Conclusions", plain(2)],
      ["Methods", plain(2)],
    ]);
    const noCue = nature(undefined, [...plain(3), "Wave exposure raises snail density and crab predation thickens the shells of the snails.", OUTLOOK]);
    const figure = nature(undefined, [...plain(3), "Taken together (Fig. 3), we show that wave exposure raises snail density and crab predation thickens shells.", OUTLOOK]);

    expect(splitOf(named)).toBeNull();
    expect(splitOf(noCue)).toBeNull();
    expect(splitOf(figure)).toBeNull();
  });
});

// C P12-76 (M3, c3_last; B P12-73; ruled a judgement call by §1h.437 (a)): a Tier-0 fallback after the closing split's loop. A paper that names no
// discussion or conclusion and whose last results paragraph is a long one holding an outlook cue ("holds promise", "paves the way", ...) closes on
// that paragraph, whatever its figure references and its echo. The loop's rule is tried first and is unchanged. Every text is invented.

/** Words of the filler, cycled, to make a paragraph of an exact length. */
const FILLER_WORDS = ["the", "tide", "covers", "most", "of", "the", "low", "shelf", "when", "storms", "pass"];

/** A paragraph of exactly `n` words: `lead` first, the filler after it (no cue of the summary rule, no long word of the announcement). */
function ofWords(n: number, lead = "Beyond these shores the same approach holds promise for coasts that are harder to reach (Fig. 5)."): string {
  const head = lead.split(/\s+/);
  return [...head, ...Array.from({ length: Math.max(0, n - head.length) }, (_, k) => FILLER_WORDS[k % FILLER_WORDS.length])].join(" ");
}
const wordsIn = (text: string): number => text.split(/\s+/).length;

/** A last results paragraph of 90 words: an outlook cue, a figure reference, and none of the announcement's long words (a low echo). */
const LONG_OUTLOOK = ofWords(90);

/** The Nature-style paper whose last part ends on `closing`. */
const endingOn = (closing: string, before: readonly string[] = plain(3)): ExtractedDocument => nature(undefined, [...before, closing]);

/** The split the fallback makes: the last paragraph (index `at`) alone is the closing. */
const LAST = (sectionId: string, at: number): GuidePartition => ({
  sectionId,
  closing: true,
  parts: [
    { role: "results", fromParagraph: 0, toParagraph: at - 1 },
    { role: "conclusion", fromParagraph: at, toParagraph: at },
  ],
});

describe("closingPartition - the last paragraph closes a paper that names no conclusion when it is long and looks ahead (C P12-76, M3, c3_last)", () => {
  it("(b) closes on a 90-word outlook paragraph that cites a figure and echoes the announcement little", () => {
    const doc = endingOn(LONG_OUTLOOK);
    const storms = buildReadingMap(doc).sections.find((row) => row.heading === STORMS)!;

    expect(wordsIn(LONG_OUTLOOK)).toBe(90);
    expect(splitOf(doc)).toEqual(LAST(storms.id, 3));
    // The same with an abstract to echo (about something else): the echo is no condition of the fallback.
    expect(splitOf(doc, ELSEWHERE)).toEqual(LAST(storms.id, 3));
    // The loop would not have closed it: a figure is cited, and the share of the announcement is nil.
    expect(splitOf(endingOn(LONG_OUTLOOK.replace("holds promise", "stays open")))).toBeNull();
  });

  it("(c) leaves a short outlook paragraph, a long paragraph without an outlook cue, and a paper that names a conclusion whole", () => {
    expect(splitOf(endingOn(ofWords(40)))).toBeNull();
    expect(splitOf(endingOn(ofWords(90, "Beyond these shores the same count was repeated at every pool in the survey (Fig. 5).")))).toBeNull();

    const named = shore([
      ["Body", [...plain(2), ANNOUNCE]],
      [SNAILS, plain(3)],
      [STORMS, [...plain(3), LONG_OUTLOOK]],
      ["Conclusions", plain(2)],
      ["Methods", plain(2)],
    ]);
    const discussed = shore([
      ["Body", [...plain(2), ANNOUNCE]],
      [STORMS, [...plain(3), LONG_OUTLOOK]],
      ["Discussion", plain(2)],
      ["Methods", plain(2)],
    ]);
    expect(splitOf(named)).toBeNull();
    expect(splitOf(discussed)).toBeNull();
  });

  it("holds the paragraph to 60 words: sixty is long enough, fifty-nine is not", () => {
    expect(splitOf(endingOn(ofWords(60)))?.parts[1]).toEqual({ role: "conclusion", fromParagraph: 3, toParagraph: 3 });
    expect(splitOf(endingOn(ofWords(59)))).toBeNull();
  });

  it("looks at the LAST paragraph of the row only: a long outlook paragraph earlier in the row is not the closing", () => {
    expect(splitOf(endingOn(plain(1)[0], [...plain(2), LONG_OUTLOOK]))).toBeNull();
  });

  it("tries the loop's rule first: a paragraph that passes it closes the paper from there, to the row's end", () => {
    const doc = nature(undefined, [...plain(3), SUMMARY, LONG_OUTLOOK]);
    const storms = buildReadingMap(doc).sections.find((row) => row.heading === STORMS)!;

    expect(splitOf(doc)).toEqual({ ...SPLIT(storms.id), parts: [SPLIT(storms.id).parts[0], { role: "conclusion", fromParagraph: 3, toParagraph: 4 }] });
  });

  it("never makes the whole row the closing: a row of one paragraph is left whole", () => {
    const single = shore([
      ["Body", [...plain(2), ANNOUNCE]],
      [STORMS, [LONG_OUTLOOK]],
      ["Methods", plain(2)],
    ]);

    expect(splitOf(single)).toBeNull();
  });

  it("is not tried where the loop's own precondition fails: a paper with no abstract and no setup part has no echo, and no split", () => {
    const noEcho = shore([["Results", [...plain(3), LONG_OUTLOOK]], ["Methods", plain(2)]]);

    expect(splitOf(noEcho)).toBeNull();
    // The same paper with an abstract to echo (about something else) is a paper the fallback closes.
    expect(splitOf(noEcho, ELSEWHERE)?.parts[1]).toEqual({ role: "conclusion", fromParagraph: 3, toParagraph: 3 });
  });

  it.each([
    ["holds promise", "Beyond these shores the same approach holds promise for other coasts."],
    ["holds great potential", "Beyond these shores the same approach holds great potential for other coasts."],
    ["hold considerable promise", "Beyond these shores such counts hold considerable promise for other coasts."],
    ["paves the way", "Beyond these shores the same approach paves the way for a shared record of the coast."],
    ["pave the way", "Beyond these shores such counts pave the way for a shared record of the coast."],
    ["paved the way", "Beyond these shores the same approach paved the way for a shared record of the coast."],
    ["new horizons", "Beyond these shores the same approach opens new horizons for the study of the coast."],
    ["expands the horizon", "Beyond these shores the same approach expands the horizon of what a small crew can count."],
    ["on the horizon", "Beyond these shores a shared record of the coast is on the horizon for the next decade."],
    ["broaden the", "Beyond these shores drone images could broaden the number of sites a small crew can visit."],
    ["to broaden", "Beyond these shores the aim is to broaden coverage with images taken from the air."],
    ["broadening the", "Beyond these shores the images allow broadening the number of sites a small crew can visit."],
    ["opens the door", "Beyond these shores the same approach opens the door to a shared record of the coast."],
    ["new avenues", "Beyond these shores the same approach opens up new avenues for a shared record of the coast."],
    ["we envisage", "Beyond these shores we envisage a shared record of the coast kept by many hands."],
    ["in capitals", "Beyond these shores the same approach HOLDS PROMISE for other coasts."],
  ])("reads %s as an outlook cue", (_name, lead) => {
    expect(splitOf(endingOn(ofWords(70, lead)))?.parts[1]).toEqual({ role: "conclusion", fromParagraph: 3, toParagraph: 3 });
  });

  it.each([
    ["a soil horizon", "The cores showed a clear soil horizon at forty centimetres, and a second one below it."],
    ["a time horizon", "The model was run over a time horizon of ten years and the counts were compared."],
    ["a broadening peak", "The Raman line broadening was larger in the warm pools, as the counts showed."],
    ["a peak that broadens", "The Raman peaks broaden with temperature in the warm pools, as the counts showed."],
    ["a holding potential", "The holding potential of the cells was kept at a fixed level while the pools were counted."],
    ["the potential of a cell", "The cell holds the potential at zero while the counts are taken in the pools."],
    ["a width that broadened", "The Raman peaks broadened in the warm pools, as the counts showed."],
    ["a peak that will broaden", "The Raman peaks will broaden with heat in the warm pools, as the counts showed."],
    ["a peak that may broaden, then stops", "The Raman peaks may broaden slightly in the warm pools, as the counts showed."],
    ["a peak that tends to broaden", "The Raman peaks tend to broaden, as the counts showed in the warm pools."],
  ])("does not read %s as an outlook cue", (_name, lead) => {
    expect(splitOf(endingOn(ofWords(70, lead)))).toBeNull();
  });
});

// C P12-85 (the closing split's echo skips fragments; C P12-82 x C P12-63, §1h.464): where the paper prints no abstract, the echo is the last paragraph of the
// setup part that has at least `ECHO_MIN_WORDS` (40) words - not the part's last paragraph, which, once a figure's caption is read whole, is a run of
// short fragments of the figure's own text ("Sheltered", "Counts at sheltered shores"). No paragraph that long: the longest one (the later of equals).
// The abstract, when the paper prints one, is unchanged. Every text is invented; the filler of `ofWords` has no word of seven letters.

/** The announcement as a 150-word paragraph: it opens on ANNOUNCE and is filled out with the filler. Shares four long words with SUMMARY. */
const LONG_ANNOUNCE = ofWords(150, ANNOUNCE);
/** Five short fragments of a figure's text (axis labels, a legend, a title) that follow the long paragraph; none holds a long word of SUMMARY. */
const FRAGMENTS = ["Sheltered", "Exposed", "Count per quadrat", "Wave height classes", "Counts at sheltered shores"];

/** The split of the Nature-style paper whose front text is `intro`; the closing is the last part's SUMMARY and OUTLOOK. */
const withIntro = (intro: readonly string[], abstract: string | null | undefined = undefined): GuidePartition | null => splitOf(nature(intro), abstract);

describe("closingPartition - the echo is the setup part's last paragraph of at least 40 words, not a fragment of figure text (C P12-85)", () => {
  it("(a) splits a paper whose setup part ends in five short fragments after a 150-word announcement", () => {
    const doc = nature([...plain(2), LONG_ANNOUNCE, ...FRAGMENTS]);
    const storms = buildReadingMap(doc).sections.find((row) => row.heading === STORMS)!;

    expect(wordsIn(LONG_ANNOUNCE)).toBe(150);
    expect(FRAGMENTS.every((fragment) => wordsIn(fragment) < 10)).toBe(true);
    // All five reach the part's body (a line of digits alone would be dropped), and the part is the front text's setup row.
    expect(bodyOf(doc)[0].paragraphs.slice(-FRAGMENTS.length)).toEqual(FRAGMENTS);
    expect(buildReadingMap(doc).sections[0].role).toBe("setup");
    expect(splitOf(doc)).toEqual(SPLIT(storms.id));
    // Each form of "the reading has no abstract" reads the same way.
    expect(splitOf(doc, null)).toEqual(SPLIT(storms.id));
    expect(splitOf(doc, "")).toEqual(SPLIT(storms.id));
  });

  it("(a) shows what the last fragment alone echoed: the same paper, handed that fragment as its abstract, is left whole", () => {
    // The echo the split took before this rule - the setup part's last paragraph, here a fragment of figure text - shares no long word with the closing.
    const doc = nature([...plain(2), LONG_ANNOUNCE, ...FRAGMENTS]);

    expect(splitOf(doc, FRAGMENTS[FRAGMENTS.length - 1])).toBeNull();
    expect(splitOf(doc)).not.toBeNull();
  });

  it("(a) steps back over a run of fragments of any size under 40 words, one or many", () => {
    expect(withIntro([LONG_ANNOUNCE, FRAGMENTS[0]])?.parts[1].fromParagraph).toBe(3);
    expect(withIntro([LONG_ANNOUNCE, ...FRAGMENTS, ...FRAGMENTS, ...FRAGMENTS])?.parts[1].fromParagraph).toBe(3);
    // A fragment of 39 words is still a fragment.
    expect(withIntro([LONG_ANNOUNCE, ofWords(39, "Counts at sheltered shores")])?.parts[1].fromParagraph).toBe(3);
  });

  it("(b) takes the last paragraph of 40 words, not the longest: 150 words of announcement, then a 40-word paragraph about something else, is left whole", () => {
    expect(withIntro([LONG_ANNOUNCE, ofWords(40, ELSEWHERE), ...FRAGMENTS])).toBeNull();
    // ...and the other way about.
    expect(withIntro([ofWords(150, ELSEWHERE), ofWords(40, ANNOUNCE), ...FRAGMENTS])?.parts[1].fromParagraph).toBe(3);
  });

  it("holds the paragraph to 40 words: forty is long enough, thirty-nine is not", () => {
    // 45 words about something else, then 40 / 39 of the announcement, then a fragment: only a paragraph of 40 words is looked at, so the 40 is the echo and the 39 is not.
    expect(withIntro([ofWords(45, ELSEWHERE), ofWords(40, ANNOUNCE), FRAGMENTS[0]])?.parts[1].fromParagraph).toBe(3);
    expect(withIntro([ofWords(45, ELSEWHERE), ofWords(39, ANNOUNCE), FRAGMENTS[0]])).toBeNull();
  });

  it("(c) leaves a setup part whose last paragraph is already long as it was: that paragraph is the echo", () => {
    // The last paragraph announces: split, as before. The last paragraph is about something else (and an earlier one announces): whole, as before.
    expect(withIntro([...plain(2), LONG_ANNOUNCE])?.parts[1].fromParagraph).toBe(3);
    expect(withIntro([LONG_ANNOUNCE, ofWords(150, ELSEWHERE)])).toBeNull();
    expect(withIntro([ofWords(150, ELSEWHERE), LONG_ANNOUNCE])?.parts[1].fromParagraph).toBe(3);
  });

  it("(d) a setup part with no paragraph of 40 words: its longest paragraph is the echo, the later of two equals", () => {
    // The announcement is the longest (30 words) and not the last: it is the echo. Before this rule the last (20 words) was, and it echoes nothing.
    expect(withIntro([ofWords(30, ANNOUNCE), ofWords(20, ELSEWHERE)])?.parts[1].fromParagraph).toBe(3);
    expect(withIntro([ofWords(20, ELSEWHERE), ofWords(30, ANNOUNCE), ofWords(20, ELSEWHERE)])?.parts[1].fromParagraph).toBe(3);
    // The longest is about something else: whole, though a shorter paragraph announces.
    expect(withIntro([ofWords(20, ANNOUNCE), ofWords(30, ELSEWHERE)])).toBeNull();
    // Two of equal length: the later.
    expect(withIntro([ofWords(20, ELSEWHERE), ofWords(20, ANNOUNCE)])?.parts[1].fromParagraph).toBe(3);
    expect(withIntro([ofWords(20, ANNOUNCE), ofWords(20, ELSEWHERE)])).toBeNull();
  });

  it("(d) a setup part of one paragraph, long or short, is that paragraph", () => {
    expect(withIntro([ANNOUNCE])?.parts[1].fromParagraph).toBe(3);
    expect(withIntro([ELSEWHERE])).toBeNull();
    expect(withIntro([LONG_ANNOUNCE])?.parts[1].fromParagraph).toBe(3);
  });

  it("(e) leaves a paper with an abstract as it was: the abstract is the echo, the setup part is not looked at", () => {
    const fragments = [LONG_ANNOUNCE, ...FRAGMENTS];

    // The abstract the closing restates splits the paper whatever its setup part ends in...
    expect(withIntro([ofWords(150, ELSEWHERE), ...FRAGMENTS], ABSTRACT)?.parts[1].fromParagraph).toBe(3);
    expect(withIntro(fragments, ABSTRACT)?.parts[1].fromParagraph).toBe(3);
    // ...and an abstract about something else leaves it whole although a 150-word paragraph of the setup part announces.
    expect(withIntro(fragments, ELSEWHERE)).toBeNull();
  });

  it("reads a named introduction the same way, and the row that holds a paragraph", () => {
    const doc = shore([
      ["1 Introduction", [...plain(1), LONG_ANNOUNCE, ...FRAGMENTS]],
      ["2 " + SNAILS, plain(3)],
      ["3 " + STORMS, [...plain(3), SUMMARY, OUTLOOK]],
      ["4 Methods", plain(2)],
    ]);

    expect(splitOf(doc)?.sectionId).toBe("s2");
  });
});
