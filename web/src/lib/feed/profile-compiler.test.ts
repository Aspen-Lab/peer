import { describe, expect, it } from "vitest";
import { normalizeFeedIntent } from "./intent";
import { briefToSeedTexts, compileSearchBrief } from "./profile-compiler";
import { selectedSenseConcept } from "./senses";

// Reused verbatim from sense-context.test.ts / docs/jev-abc/ABBREV-RECALL-B-20260929T004152Z.md
// so the ABBREV-RECALL tests below stay tied to the investigation's own reproduction fixture.
const BATTERY_PROJECT_TEXT =
  "PhD research on solid-state battery materials, focused on lithium and sodium-ion cathode and " +
  "electrolyte interfaces for electric-vehicle batteries. Improving ionic conductivity and " +
  "interfacial stability between solid electrolytes and electrode materials while suppressing " +
  "dendrite growth.";

describe("compileSearchBrief tag-first intent lanes", () => {
  it("puts the Required tag ahead of project phrases, and still includes the project text", () => {
    const normalized = normalizeFeedIntent({
      project: "Stabilize sulfide electrolyte interfaces",
      challenge: "Lower interfacial resistance",
      topics: ["solid electrolyte"],
    });
    if (!normalized.ok) throw new Error("fixture must be valid");

    const brief = compileSearchBrief({ topics: ["solid electrolyte"], intent: normalized.intent });

    expect(brief.project).toBe("Stabilize sulfide electrolyte interfaces");
    expect(brief.challenge).toBe("Lower interfacial resistance");
    // ABBREV-RECALL (ABC-JEV-INTEGRATION.md §1av): generatedQueries now leads
    // with the reader's own Required tag, ahead of project/challenge phrases
    // — a deliberate contract change from "project phrases first" (the order
    // this test asserted before), because a tag buried behind a long
    // project description never survived the source adapters' own
    // MAX_QUERIES truncation (2-3). The project text is still generated,
    // just no longer at index 0.
    expect(brief.generatedQueries[0]).toBe("solid electrolyte");
    expect(brief.generatedQueries).toContain("Stabilize sulfide electrolyte interfaces");
    expect(brief.currentProjectSummary).toBe("Stabilize sulfide electrolyte interfaces");
  });

  it("uses only the catalog's exact canonical phrase for a selected sense-only query", () => {
    const normalized = normalizeFeedIntent({
      intent: {
        version: "feed-intent-v1",
        selectedSenseConcepts: [selectedSenseConcept("materials.scanning_electron_microscopy")],
      },
    });
    if (!normalized.ok) throw new Error("fixture must be valid");

    const brief = compileSearchBrief({ topics: [], intent: normalized.intent });

    expect(brief.generatedQueries).toEqual(["scanning electron microscopy"]);
    expect(brief.generatedQueries).not.toContain("SEM");
  });

  it("keeps the exact selected HR sense query in tight focus without topics", () => {
    const normalized = normalizeFeedIntent({
      intent: {
        version: "feed-intent-v1",
        selectedSenseConcepts: [selectedSenseConcept("hr.role_conflict")],
      },
    });
    if (!normalized.ok) throw new Error("fixture must be valid");

    const brief = compileSearchBrief({
      topics: [],
      intent: normalized.intent,
      controls: { focus: "tight" },
    });

    expect(brief.generatedQueries).toEqual(["role conflict"]);
    expect(brief.generatedQueries).not.toContain("conflict");
  });

  it("keeps only the canonical materials sense query in tight focus without topics", () => {
    const normalized = normalizeFeedIntent({
      intent: {
        version: "feed-intent-v1",
        selectedSenseConcepts: [selectedSenseConcept("materials.scanning_electron_microscopy")],
      },
    });
    if (!normalized.ok) throw new Error("fixture must be valid");

    const brief = compileSearchBrief({
      topics: [],
      intent: normalized.intent,
      controls: { focus: "tight" },
    });

    expect(brief.generatedQueries).toEqual(["scanning electron microscopy"]);
    expect(brief.generatedQueries).not.toContain("SEM");
  });

  it("keeps selected senses alongside topic-anchored tight queries", () => {
    const normalized = normalizeFeedIntent({
      topics: ["organizational behavior"],
      intent: {
        version: "feed-intent-v1",
        selectedSenseConcepts: [selectedSenseConcept("hr.role_conflict")],
      },
    });
    if (!normalized.ok) throw new Error("fixture must be valid");

    const brief = compileSearchBrief({
      topics: ["organizational behavior"],
      intent: normalized.intent,
      controls: { focus: "tight" },
    });

    expect(brief.generatedQueries).toEqual(["role conflict", "organizational behavior"]);
  });

  it("keeps declared project and challenge terms in tight focus when topics are absent", () => {
    const project = compileSearchBrief({
      topics: [],
      project: "employee retention",
      controls: { focus: "tight" },
    });
    const challenge = compileSearchBrief({
      topics: [],
      challenge: "reduce turnover",
      controls: { focus: "tight" },
    });

    expect(project.generatedQueries).toContain("employee retention");
    expect(challenge.generatedQueries).toContain("reduce turnover");
  });

  it("keeps empty intent invalid and topic-present ordinary tight queries topic-filtered", () => {
    const empty = normalizeFeedIntent({});
    expect(empty).toMatchObject({ ok: false, reason: "intent_required" });

    const brief = compileSearchBrief({
      topics: ["organizational behavior"],
      project: "employee retention",
      challenge: "reduce turnover",
      controls: { focus: "tight" },
    });

    expect(brief.generatedQueries).not.toContain("employee retention");
    expect(brief.generatedQueries).not.toContain("reduce turnover");
    expect(brief.generatedQueries).toContain("organizational behavior employee retention");
    expect(brief.generatedQueries.every((query) => query.includes("organizational behavior"))).toBe(true);
  });
});

// ABBREV-RECALL (ABC-JEV-INTEGRATION.md §1av, docs/jev-abc/ABBREV-RECALL-B-20260929T004152Z.md):
// B found that a Required tag never echoed in the reader's own project/challenge text (a real
// abbreviation like "LCO" is exactly this case — a reader states it as a tag, not as prose) was
// silently dropped before it ever reached a source: profile-compiler.ts's projectQueries put
// project-text phrases ahead of the Required tags, and every source adapter in web/src/lib/sources
// keeps only its own first MAX_QUERIES entries (2 for dblp/pubmed, 3 for openalex/semantic-scholar/
// arxiv). A tag past that cut is never searched for, every day, with no error shown. The fix only
// reorders generatedQueries (tags now lead, ahead of project phrases); it changes no query's text.
describe("compileSearchBrief ABBREV-RECALL: Required tags survive the adapters' query cap", () => {
  it("a 1-tag profile with project text keeps the tag within the adapters' MAX_QUERIES cut (2 and 3)", () => {
    const brief = compileSearchBrief({ topics: ["LCO"], project: BATTERY_PROJECT_TEXT });

    expect(brief.generatedQueries.indexOf("LCO")).toBeGreaterThanOrEqual(0);
    expect(brief.generatedQueries.slice(0, 2)).toContain("LCO");
    expect(brief.generatedQueries.slice(0, 3)).toContain("LCO");
  });

  it("a 3-tag profile with project text puts every tag before any project-only phrase", () => {
    const topics = ["LCO", "LFP", "solid-state batteries"];
    const brief = compileSearchBrief({ topics, project: BATTERY_PROJECT_TEXT });

    // A "project-only phrase" is a generated query that is neither a bare tag
    // nor a tag+something combination (those are expected, and always come
    // later — this only checks that no plain project phrase cuts in line
    // ahead of a tag).
    const firstProjectPhraseIndex = brief.generatedQueries.findIndex(
      (q) => !topics.includes(q) && !topics.some((topic) => q.startsWith(`${topic} `)),
    );

    expect(firstProjectPhraseIndex).toBeGreaterThan(-1);
    for (const topic of topics) {
      expect(brief.generatedQueries.indexOf(topic)).toBeGreaterThanOrEqual(0);
      expect(brief.generatedQueries.indexOf(topic)).toBeLessThan(firstProjectPhraseIndex);
    }
  });

  // Mutation guard, computed from the HEAD code (before this fix) via direct execution so the
  // pinned arrays are exact, not hand-derived. If a future edit puts `...topics` back after the
  // project phrases, these two go red without needing the 1-tag/3-tag tests above to catch it.
  //
  // QUERY-QUALITY (ABC-JEV-INTEGRATION.md §1ay, docs/jev-abc/QUERY-QUALITY-B-20260929T084721Z.md)
  // REWROTE both pinned arrays below — a deliberate second contract change, not a weakening of
  // this guard. BATTERY_PROJECT_TEXT is a 2-sentence, 40+-word paragraph, so it no longer
  // qualifies as its own literal query (profile-compiler.ts's literalQueryIfShort, <=6 words);
  // only its derived phrases still appear. phrasesFromText now also splits on commas, so the
  // paragraph's one comma turns its first sentence's run-on clause into a real 6-word phrase
  // ("PhD research on solid-state battery materials") that leads the list, pushing the 5th bare
  // keyword ("focused") past the max=5 cap on this call. Recomputed by direct execution against
  // the NEW code, same discipline ABBREV-RECALL used against the OLD code.
  it("leaves the zero-topic tight-focus project lane pinned to the QUERY-QUALITY-fixed output", () => {
    const brief = compileSearchBrief({
      topics: [],
      project: BATTERY_PROJECT_TEXT,
      controls: { focus: "tight" },
    });

    expect(brief.generatedQueries).toEqual([
      "PhD research on solid-state battery materials",
      "research",
      "solid-state",
      "battery",
      "materials",
    ]);
  });

  it("leaves tight focus with a topic present pinned to the QUERY-QUALITY-fixed output", () => {
    const brief = compileSearchBrief({
      topics: ["LCO"],
      project: BATTERY_PROJECT_TEXT,
      controls: { focus: "tight" },
    });

    expect(brief.generatedQueries).toEqual([
      "LCO",
      "LCO PhD research on solid-state battery materials",
      "LCO research",
      "LCO solid-state",
    ]);
  });
});

// QUERY-QUALITY (ABC-JEV-INTEGRATION.md §1ay, docs/jev-abc/QUERY-QUALITY-B-20260929T084721Z.md):
// B found that projectQueries put the reader's ENTIRE, verbatim, multi-sentence project/challenge
// paragraph into generatedQueries as one search string (what earlier docs called "fulltext"), and
// that phrasesFromText never split on commas, so a real, comma-joined research sentence almost
// never produced a genuine phrase — every non-tag query slot on every source fell back to either
// that whole raw paragraph or a single generic word. Measured live: the wasted single-word slot
// pulled 117,064 in-window OpenAlex candidates with a 0/25 sampled qualify rate for the reader's
// own Required tag; a real short phrase scored 40-100% on the same sample. The fix is two parts:
// (F) a project/challenge text longer than 6 words is never itself a query (its derived phrases
// still are); a text of 6 words or fewer already IS a phrase and stays as one query. (N)
// phrasesFromText also splits on commas, so real 2-6 word phrases can form and sort ahead of bare
// single words (they already led the concatenation order; they just didn't exist before).
describe("compileSearchBrief QUERY-QUALITY: project/challenge text no longer floods a query slot", () => {
  it("never sends the whole raw project paragraph as its own query, in the default (non-tight) focus", () => {
    const brief = compileSearchBrief({ topics: ["LCO"], project: BATTERY_PROJECT_TEXT });

    expect(brief.generatedQueries).not.toContain(BATTERY_PROJECT_TEXT);
    expect(brief.generatedQueries).toContain("LCO");
  });

  it("never sends the whole raw challenge paragraph as its own query", () => {
    const brief = compileSearchBrief({ topics: ["LCO"], challenge: BATTERY_PROJECT_TEXT });

    expect(brief.generatedQueries).not.toContain(BATTERY_PROJECT_TEXT);
  });

  it("splits comma-separated clauses into real multi-word phrases, not just bare single words", () => {
    const commaHeavyProject =
      "silicon anode degradation, fast-charging protocols, electrolyte additive screening, capacity fade at high rates";
    const brief = compileSearchBrief({ topics: [], project: commaHeavyProject });

    const multiWordPhrases = brief.generatedQueries.filter((q) => {
      const words = q.trim().split(/\s+/).length;
      return words >= 2 && words <= 6;
    });
    expect(multiWordPhrases.length).toBeGreaterThan(0);
    expect(brief.generatedQueries).toContain("silicon anode degradation");
    expect(brief.generatedQueries).toContain("fast-charging protocols");
  });

  it("keeps a project text at the 6-word floor as one literal query, but drops it at 7 words (its derived phrase still survives)", () => {
    // Both fixtures share a leading comma-separated clause ("silicon anode") so the derived
    // phrase is identical either side of the floor — only the FULL literal string's presence
    // should flip when word count crosses 6, isolating literalQueryIfShort from phrasesFromText.
    const sixWords = "silicon anode, capacity fade at scale"; // 6 words
    const sevenWords = "silicon anode, capacity fade at scale now"; // 7 words

    const atFloor = compileSearchBrief({ topics: [], project: sixWords });
    const overFloor = compileSearchBrief({ topics: [], project: sevenWords });

    expect(atFloor.generatedQueries).toContain(sixWords);
    expect(overFloor.generatedQueries).not.toContain(sevenWords);
    // The derived sub-phrase from the comma split survives on both sides of the floor.
    expect(atFloor.generatedQueries).toContain("silicon anode");
    expect(overFloor.generatedQueries).toContain("silicon anode");
  });
});

// QUERY-BUDGET (ABC-JEV-INTEGRATION.md §1az, docs/jev-abc/QUERY-BUDGET-B-20260929T094059Z.md):
// even with Required tags ahead of project phrases (ABBREV-RECALL) and no raw paragraph flooding
// a slot (QUERY-QUALITY), two problems survived: (1) 2+ selected senses could still push a
// Required tag out of a small source's cap — measured live, 2 senses + 2 tags sent dblp/pubmed
// (cap 2) "role conflict"/"conflict of interest", 0 of 2 tags; (2) a bare generic single word
// (e.g. "research", measured at 0% qualify across ~10^5 in-window candidates) still filled a cap
// slot ahead of a genuine project phrase or a tag-anchored combination (measured 12-44% qualify).
// The fix tiers baseQueries — Required tags, then exact-sense queries (Tier 0, guarantees
// min(tagCount, cap) tags survive any source); bare project phrases (Tier 1); one
// tag+strongest-phrase combination per tag (Tier 1b, kept behind the bare phrase as the
// risk-averse default — a live measurement found this can either sharpen a source's results or
// collapse them to almost nothing); bare single words (Tier 2); the rest (Tier 3) — reordering
// the exact same strings baseQueries already produced. Nothing is invented or dropped, and every
// pre-existing pin above stays byte-identical (traced by hand before this change, re-proven by
// this file staying green).
describe("compileSearchBrief QUERY-BUDGET: tiering keeps a tag's cap-window free of low-value fallbacks", () => {
  it("keeps every cap=3 slot free of a bare single-word projectTerms entry once a tag and a project phrase both exist, and lands the tag+phrase combo inside that window", () => {
    const brief = compileSearchBrief({ topics: ["LCO"], project: BATTERY_PROJECT_TEXT });
    const window = brief.generatedQueries.slice(0, 3);

    for (const bareWord of ["research", "solid-state", "battery", "materials"]) {
      expect(window).not.toContain(bareWord);
    }
    expect(window).toContain("LCO PhD research on solid-state battery materials");
  });

  // A project text with TWO genuine comma-derived long phrases (each <=10 words) ahead of its
  // leftover single keywords, the same shape BATTERY_PROJECT_TEXT has with one phrase instead of
  // two — isolates which phrase Tier 1b spends on the combo from what stays a bare Tier 1 phrase.
  const TWO_PHRASE_PROJECT_TEXT =
    "Investigating solid-state electrolyte interfaces, improving lithium-ion transport pathways, " +
    "testing conductivity under high pressure conditions across many samples";

  it("pairs the tag+phrase combination with the FIRST (strongest) project phrase specifically", () => {
    const brief = compileSearchBrief({ topics: ["LCO"], project: TWO_PHRASE_PROJECT_TEXT });

    const firstPhraseCombo = brief.generatedQueries.indexOf(
      "LCO Investigating solid-state electrolyte interfaces",
    );
    const secondPhraseCombo = brief.generatedQueries.indexOf(
      "LCO improving lithium-ion transport pathways",
    );

    expect(firstPhraseCombo).toBeGreaterThanOrEqual(0);
    expect(secondPhraseCombo).toBeGreaterThanOrEqual(0);
    // Tier 1b (the privileged tag+phrase slot) only ever pairs the tag with projectTerms[0]; a
    // combo using the second phrase still exists (Tier 3), but ranks behind it.
    expect(firstPhraseCombo).toBeLessThan(secondPhraseCombo);
    // Tier 1b itself outranks Tier 2's bare single words — with 3 real phrases feeding both a
    // bare-phrase and a combo slot, this is the one assertion in this fixture that actually
    // distinguishes the tiered order from today's flat concatenation (where this combo would
    // fall after every bare keyword instead of before them).
    for (const keyword of ["investigating", "solid-state"]) {
      expect(firstPhraseCombo).toBeLessThan(brief.generatedQueries.indexOf(keyword));
    }
  });

  it("still ranks the SECOND project phrase (not spent on the tag combo) ahead of every bare single keyword", () => {
    const brief = compileSearchBrief({ topics: ["LCO"], project: TWO_PHRASE_PROJECT_TEXT });

    const secondPhraseIndex = brief.generatedQueries.indexOf("improving lithium-ion transport pathways");
    expect(secondPhraseIndex).toBeGreaterThanOrEqual(0);
    for (const keyword of ["investigating", "solid-state"]) {
      const keywordIndex = brief.generatedQueries.indexOf(keyword);
      expect(keywordIndex).toBeGreaterThanOrEqual(0);
      expect(secondPhraseIndex).toBeLessThan(keywordIndex);
    }
  });

  it("guarantees min(tagCount, cap) Required tags survive a 2-slot source even with 2 selected senses (R2)", () => {
    const normalized = normalizeFeedIntent({
      topics: ["LCO", "LFP"],
      intent: {
        version: "feed-intent-v1",
        selectedSenseConcepts: [
          selectedSenseConcept("hr.role_conflict"),
          selectedSenseConcept("compliance.conflict_of_interest"),
        ],
      },
    });
    if (!normalized.ok) throw new Error("fixture must be valid");

    // Default (non-tight) focus deliberately: tight reconstructs its own list independently of
    // this tiering (unaffected either way), so only balanced/exploratory exercise Tier 0 directly.
    const brief = compileSearchBrief({ topics: ["LCO", "LFP"], intent: normalized.intent });

    expect(brief.generatedQueries.slice(0, 2)).toEqual(["LCO", "LFP"]);
    expect(brief.generatedQueries.indexOf("role conflict")).toBeGreaterThanOrEqual(2);
    expect(brief.generatedQueries.indexOf("conflict of interest")).toBeGreaterThanOrEqual(2);
  });

  it("claims the contested first window for the tag ahead of the sense, for 1 tag + 1 sense", () => {
    const normalized = normalizeFeedIntent({
      topics: ["LCO"],
      intent: {
        version: "feed-intent-v1",
        selectedSenseConcepts: [selectedSenseConcept("hr.role_conflict")],
      },
    });
    if (!normalized.ok) throw new Error("fixture must be valid");

    const brief = compileSearchBrief({ topics: ["LCO"], intent: normalized.intent });

    expect(brief.generatedQueries[0]).toBe("LCO");
    expect(brief.generatedQueries[1]).toBe("role conflict");
  });

  it("a zero-tag, default-focus profile with selected senses still emits exactly the sense queries (Tier 0 with no tags to interleave)", () => {
    const normalized = normalizeFeedIntent({
      intent: {
        version: "feed-intent-v1",
        selectedSenseConcepts: [
          selectedSenseConcept("hr.role_conflict"),
          selectedSenseConcept("compliance.conflict_of_interest"),
        ],
      },
    });
    if (!normalized.ok) throw new Error("fixture must be valid");

    const brief = compileSearchBrief({ topics: [], intent: normalized.intent });

    expect(brief.generatedQueries).toEqual(["role conflict", "conflict of interest"]);
  });
});

// NON-ASCII-TEXT (ABC-JEV-INTEGRATION.md §1bo,
// docs/jev-abc/NON-ASCII-TEXT-B-20260930T071406Z.md): the free-text keyword
// regex used to be ASCII-only, so it deleted every CJK character and, worse,
// CORRUPTED an adjacent accented Latin letter into a wrong fragment
// ("Müller"->"ller", proven by execution in the guide's Task 2 T4).
// Separately, both the phrase-chunk splitter and literalQueryIfShort counted
// "words" by ASCII whitespace, so an entire unspaced/fullwidth-punctuated
// Chinese paragraph counted as "1 word" and leaked through as one giant,
// low-value query (guide's Task 2 T2/T5). The fix: Unicode letters/digits
// are kept whole in the keyword branch; a CJK-only segment is excluded
// outright everywhere a query can be derived from free text; a Latin-script
// term or chemical formula embedded in Chinese prose is still extracted
// (guide's Task 2 T3) — this file's other describe blocks above stay
// byte-identical proof that fixing this did not touch the tag-first tiering
// those items shipped.
describe("compileSearchBrief NON-ASCII-TEXT: accented Latin kept whole, CJK-only text yields no query", () => {
  it("keeps accented Latin words whole in the keyword branch instead of corrupting them into wrong fragments", () => {
    const brief = compileSearchBrief({
      topics: [],
      project:
        "Müller reports improved électrolyte performance across broad battery cathode structural testing samples now.",
    });

    // The OLD ASCII-only regex turned the accented letter into a space,
    // corrupting each word into an unrecognizable fragment.
    expect(brief.generatedQueries).not.toContain("ller");
    expect(brief.generatedQueries).not.toContain("lectrolyte");
    expect(brief.generatedQueries).toContain("müller");
    expect(brief.generatedQueries).toContain("électrolyte");
  });

  it("does not let an accent-corrupted split word waste an extra keyword slot and evict a genuine later word", () => {
    const brief = compileSearchBrief({
      topics: [],
      project:
        "Schrödinger equation models predict lithium battery cathode diffusion kinetics precisely across many samples.",
    });

    // The accent sits in the MIDDLE of "Schrödinger". The old ASCII-only
    // regex turned it into a word-breaking space, so ONE word produced TWO
    // surviving 4+ character fragments ("schr", "dinger") — consuming an
    // extra slot in the first-5-matches keyword cutoff and pushing the next
    // genuine word ("lithium") out before it ever got a chance.
    expect(brief.generatedQueries).not.toContain("schr");
    expect(brief.generatedQueries).not.toContain("dinger");
    expect(brief.generatedQueries).toContain("schrödinger");
    expect(brief.generatedQueries).toContain("lithium");
  });

  it("reproduces the guide's T4 fixture verbatim: every accented word survives correctly spelled, never as the old corrupted fragment", () => {
    const brief = compileSearchBrief({
      topics: [],
      project:
        "Étude du transport ionique dans les électrolytes solides à base de pérovskite de type Müller pour batteries au lithium.",
    });

    // docs/jev-abc/NON-ASCII-TEXT-B-20260930T071406Z.md Task 2 T4's OLD,
    // measured output was exactly ["tude", "transport", "ionique", "dans",
    // "lectrolytes"] — every accented word turned into an unrecognizable
    // fragment. None of those corrupted spellings may appear now. (The
    // first-5-matches positional cutoff itself is unchanged by this item —
    // "batteries"/"lithium" still fall past it here, same as before, since
    // fixing the corruption does not change how many WHOLE words come
    // before them in this particular sentence; see the dedicated
    // "Schrödinger" case above for a sentence where the fix does free up a
    // slot.)
    for (const corrupted of ["tude", "lectrolytes", "rovskite", "ller"]) {
      expect(brief.generatedQueries).not.toContain(corrupted);
    }
    expect(brief.generatedQueries).toContain("étude");
    expect(brief.generatedQueries).toContain("électrolytes");
  });

  it("derives no query at all from a long pure-Chinese project paragraph (guide's T2 fixture)", () => {
    const brief = compileSearchBrief({
      topics: [],
      project:
        "我们正在研究高比能锂离子电池正极材料，重点关注固态电解质界面的稳定性和枝晶抑制机制。",
    });

    // OLD behaviour leaked the entire untouched paragraph as one literal
    // query (docs/jev-abc/NON-ASCII-TEXT-B-20260930T071406Z.md Task 2 T2).
    expect(brief.generatedQueries).toEqual([]);
  });

  it("derives no query from a SHORT pure-Chinese project text either — not just a long paragraph", () => {
    // Short enough (4 characters) that a naive character-count guard alone
    // could still mistake it for "short enough to send verbatim"; point 2's
    // "yields no derived or literal query from its Chinese text" is
    // unconditional, not just for long paragraphs.
    const brief = compileSearchBrief({ topics: [], project: "电池研究" });

    expect(brief.generatedQueries).toEqual([]);
  });

  it("derives no query from the guide's T5 fixture (short Chinese with fullwidth punctuation)", () => {
    const brief = compileSearchBrief({
      topics: [],
      project: "电池研究：提高电池寿命和安全性。",
    });

    expect(brief.generatedQueries).toEqual([]);
  });

  it("still puts a Required tag first even when the project text itself is pure Chinese and yields nothing on its own", () => {
    const brief = compileSearchBrief({
      topics: ["battery"],
      project: "电池研究：提高电池寿命和安全性。",
    });

    expect(brief.generatedQueries).toEqual(["battery"]);
  });

  it("keeps Latin-script terms and chemical formulas embedded in Chinese prose (guide's T3 fixture, protective)", () => {
    const brief = compileSearchBrief({
      topics: [],
      project:
        "我们的项目专注于 LiCoO2 正极材料和 solid-state electrolyte 的界面工程，并测试 NMC811 材料的循环稳定性。",
    });

    // NON-ASCII-TEXT (§1bo.8): round 2's CJK-run chunk delimiter now also
    // isolates "LiCoO2" as its OWN chunk (original case, from
    // phrasesFromText's longPhrases branch), which wins cleanList's
    // case-insensitive dedup over the lowercase "licoo2" the keyword branch
    // separately produces — a real, verified-by-execution behaviour change
    // (round 1 only ever produced the lowercase keyword-branch form here).
    // Asserting the ORIGINAL-CASE formula is equally correct and, if
    // anything, closer to what a source's own index expects for a chemical
    // formula. See the round 2 describe block below for the full mixed-text
    // coverage this fixture is now also part of.
    expect(brief.generatedQueries).toContain("LiCoO2");
    expect(brief.generatedQueries).toContain("solid-state");
    expect(brief.generatedQueries).toContain("electrolyte");
    // NON-ASCII-TEXT (§1bo.8): same original-case reasoning as LiCoO2 above.
    expect(brief.generatedQueries).toContain("NMC811");
  });

  it("a pure-Chinese CHALLENGE text also yields no query (not just project)", () => {
    const brief = compileSearchBrief({
      topics: [],
      challenge:
        "我们正在研究高比能锂离子电池正极材料，重点关注固态电解质界面的稳定性和枝晶抑制机制。",
    });

    expect(brief.generatedQueries).toEqual([]);
  });

  // Mutation guard (revert either fix and this goes red): the whole raw
  // paragraph, byte for byte, must never appear as a query string, whether
  // via literalQueryIfShort or via the phrase-chunk branch.
  it("mutation guard: the whole raw Chinese paragraph never appears verbatim as a query", () => {
    const chineseProject =
      "我们正在研究高比能锂离子电池正极材料，重点关注固态电解质界面的稳定性和枝晶抑制机制。";
    const brief = compileSearchBrief({ topics: ["battery"], project: chineseProject });

    expect(brief.generatedQueries).not.toContain(chineseProject);
  });
});

// NON-ASCII-TEXT ROUND 2 (ABC-JEV-INTEGRATION.md §1bo.8, AMENDMENT): the
// manager's own check found round 1's fix covered PURE Chinese only —
// MIXED Chinese-plus-Latin text (the ordinary case for a Chinese materials
// researcher) still leaked the whole raw paragraph as a query, because
// phrasesFromText's longPhrases branch has the exact same no-spaces blind
// spot round 1 fixed in literalQueryIfShort, and round 1's CJK-only filter
// deliberately did not touch a MIXED chunk. Separately, round 1 checked
// Han script only, so Japanese Hiragana/Katakana and Korean Hangul passed
// straight through untouched. The INVARIANT this round ships: no query
// built from free text contains a CJK character (Han, Hiragana, Katakana,
// Hangul) at all; a CJK run (or CJK/fullwidth punctuation) now acts as a
// chunk delimiter, so an embedded Latin phrase survives as one phrase and a
// formula survives even with zero surrounding whitespace, while every CJK
// part of the same text contributes nothing. Fixture texts below are the
// manager's own constructed probes (docs/jev-abc/NON-ASCII-TEXT-C-
// 20260930T075350Z.md ROUND 2 section), reused verbatim for traceability.
describe("compileSearchBrief NON-ASCII-TEXT round 2 (§1bo.8): mixed CJK+Latin text and all four CJK scripts", () => {
  const NONLATIN_LETTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

  const M1_GUIDE_T3 =
    "我们的项目专注于 LiCoO2 正极材料和 solid-state electrolyte 的界面工程，并测试 NMC811 材料的循环稳定性。";
  const M2_DIGITS_NO_SPACES =
    "我们在2024年开始研究固态电池，目标是把能量密度提高到500Wh/kg，并降低界面阻抗。";
  const M3_FORMULA_NO_SPACES =
    "本项目研究LiCoO2正极在高电压下的结构衰减机制，以及表面包覆对循环寿命的影响。";
  const M4_ASCII_PUNCT_MIXED =
    "研究方向: NMC811 cathode degradation; 固态电解质界面 (SEI) 的形成机制.";
  const M5_JAPANESE_KANA =
    "リチウムイオン電池の正極材料における劣化メカニズムを研究しています。";
  const M6_KOREAN_HANGUL = "리튬 이온 배터리 양극 소재의 열화 메커니즘을 연구합니다";

  it.each([
    ["M1 guide T3 (Han + Latin phrase + formulas)", M1_GUIDE_T3],
    ["M2 digits, no spaces around the CJK run", M2_DIGITS_NO_SPACES],
    ["M3 a formula glued directly onto surrounding Chinese, zero spaces", M3_FORMULA_NO_SPACES],
    ["M4 ASCII-colon/semicolon-punctuated mixed text", M4_ASCII_PUNCT_MIXED],
    ["M5 Japanese (Han + Hiragana + an embedded formula)", M5_JAPANESE_KANA],
    ["M6 Korean (pure Hangul)", M6_KOREAN_HANGUL],
  ])("no generated query contains a CJK character: %s", (_label, text) => {
    const brief = compileSearchBrief({ topics: [], project: text });
    const offenders = brief.generatedQueries.filter((q) => NONLATIN_LETTER.test(q));

    expect(offenders).toEqual([]);
  });

  it("keeps the guide's T3 embedded Latin phrase 'solid-state electrolyte' as ONE phrase, plus its bare formulas", () => {
    const brief = compileSearchBrief({ topics: [], project: M1_GUIDE_T3 });

    expect(brief.generatedQueries).toContain("solid-state electrolyte");
    expect(brief.generatedQueries).toContain("LiCoO2");
    expect(brief.generatedQueries).toContain("NMC811");
  });

  it("isolates a formula glued directly onto surrounding Chinese with NO whitespace at all", () => {
    const brief = compileSearchBrief({ topics: [], project: M3_FORMULA_NO_SPACES });

    expect(brief.generatedQueries).toContain("LiCoO2");
  });

  it("keeps the ASCII-punctuated fixture's 'NMC811 cathode degradation' as ONE phrase (already worked pre-round-2 for THIS chunk, protective) and isolates '(SEI)' out of the CJK-adjacent chunk", () => {
    const brief = compileSearchBrief({ topics: [], project: M4_ASCII_PUNCT_MIXED });

    expect(brief.generatedQueries).toContain("NMC811 cathode degradation");
    // "(SEI)" sits inside "固态电解质界面 (SEI) 的形成机制" — a chunk that is
    // bounded by ASCII ';' and '.', but is CJK-on-both-sides internally.
    // Round 1 left the whole mixed chunk intact (not CJK-only); round 2's
    // delimiter isolates the Latin fragment out of it instead.
    const hasSei = brief.generatedQueries.some((q) => q.toUpperCase().includes("SEI"));
    expect(hasSei).toBe(true);
  });

  it("derives no query from a Japanese paragraph mixing Han, Hiragana and an embedded formula", () => {
    const brief = compileSearchBrief({ topics: [], project: M5_JAPANESE_KANA });
    const offenders = brief.generatedQueries.filter((q) => NONLATIN_LETTER.test(q));

    expect(offenders).toEqual([]);
  });

  it("derives no query at all from a pure-Korean (Hangul) paragraph", () => {
    const brief = compileSearchBrief({ topics: [], project: M6_KOREAN_HANGUL });

    expect(brief.generatedQueries).toEqual([]);
  });

  it("still puts a Required tag first even when the project text is Japanese and yields nothing on its own", () => {
    const brief = compileSearchBrief({ topics: ["battery"], project: M6_KOREAN_HANGUL });

    expect(brief.generatedQueries).toEqual(["battery"]);
  });

  // Protective (§1bo.8(b)): pure-ASCII text must be completely unaffected by
  // the new CJK-delimiter step — it requires at least one CJK-range
  // codepoint to match anything, so a hyphenated, comma-punctuated English
  // fixture keeps behaving exactly as phrasesFromText already did.
  it("protective: a fresh pure-ASCII fixture with hyphens and commas is untouched by the CJK delimiter", () => {
    const brief = compileSearchBrief({
      topics: [],
      project: "high-throughput screening of anode binders, focused on silicon-graphite composites and cycle life",
    });

    expect(brief.generatedQueries).toContain("high-throughput screening of anode binders");
    expect(brief.generatedQueries).toContain("focused on silicon-graphite composites and cycle life");
  });

  // Round 1's own pinned fixtures stay byte-identical (protective, not a
  // new assertion — re-run here so a regression in the shared CJK
  // constants shows up in THIS describe block too, not only round 1's).
  it("protective: round 1's ABBREV-RECALL/QUERY-QUALITY pinned outputs are unaffected", () => {
    const brief = compileSearchBrief({
      topics: [],
      project: BATTERY_PROJECT_TEXT,
      controls: { focus: "tight" },
    });

    expect(brief.generatedQueries).toEqual([
      "PhD research on solid-state battery materials",
      "research",
      "solid-state",
      "battery",
      "materials",
    ]);
  });

  // Mutation guard 1 (§1bo.8(g)): remove the CJK-delimiter step and this
  // goes red — without it, the mixed chunk survives as one blob again.
  it("mutation guard: the whole raw mixed paragraph (M1) never appears verbatim as a query", () => {
    const brief = compileSearchBrief({ topics: ["LCO"], project: M1_GUIDE_T3 });

    expect(brief.generatedQueries).not.toContain(M1_GUIDE_T3);
  });

  // Mutation guard 2 (§1bo.8(g)): narrow CJK_SCRIPT_CLASS to Han-only and
  // this goes red — a pure-Hiragana/Katakana run would then pass straight
  // through the keyword branch as a bogus token.
  it("mutation guard: no bogus kana keyword token survives a Japanese project text", () => {
    const brief = compileSearchBrief({ topics: [], project: M5_JAPANESE_KANA });

    for (const query of brief.generatedQueries) {
      expect(NONLATIN_LETTER.test(query)).toBe(false);
    }
  });
});

// QUERY-GENERIC-WORDS (ABC-JEV-INTEGRATION.md §1bs,
// docs/jev-abc/QUERY-GENERIC-WORDS-B-20260930T090811Z.md): a bare 4-digit
// year, a number+unit token from a closed list, or a bare decimal with no
// letters reached both generatedQueries and activeQuestions/seedTexts as
// its own near-useless single-word entry. The fix lives entirely inside
// phrasesFromText's keyword step, so both call sites change from one edit;
// every other token — including a non-year bare integer ("18650") — is
// unchanged (an accepted cost, per the ruling). Folded into the SAME
// function: the phrase/chunk splitter no longer splits at a period between
// two digits, and the em dash / en dash / ellipsis now act as chunk
// delimiters (§1bo.9(a)).
describe("compileSearchBrief QUERY-GENERIC-WORDS (§1bs): years, units, and bare decimals never become their own query", () => {
  it("removes a standalone 4-digit year from the keyword tier while keeping the tag and other words", () => {
    // The guide's own measured fixture (§1 note 1): a project/challenge text
    // short enough to also be its own literal query — the literal string
    // (which happens to CONTAIN "2024" as a substring) is unrelated to this
    // filter and stays; only the STANDALONE "2024"/"500wh/kg" keyword
    // entries are removed.
    const YEAR_UNIT_TEXT = "battery target 500Wh/kg by 2024";
    const brief = compileSearchBrief({ topics: [], project: YEAR_UNIT_TEXT });

    expect(brief.generatedQueries).toContain(YEAR_UNIT_TEXT);
    expect(brief.generatedQueries).toContain("battery");
    expect(brief.generatedQueries).toContain("target");
    // MUTATION CHECK (§1bs.1): dropping the year branch of the filter turns
    // this red.
    expect(brief.generatedQueries).not.toContain("2024");
    // MUTATION CHECK (§1bs.1): dropping the number+unit branch turns this
    // red.
    expect(brief.generatedQueries).not.toContain("500wh/kg");
  });

  it("removes a number+unit token for several units from the closed list", () => {
    const brief = compileSearchBrief({
      topics: [],
      challenge:
        "Measured performance at 3.7V nominal voltage with 45mA current draw across many repeated trials for validation",
    });

    expect(brief.generatedQueries).not.toContain("3.7v");
    expect(brief.generatedQueries).not.toContain("45ma");
    expect(brief.generatedQueries).toContain("measured");
    expect(brief.generatedQueries).toContain("performance");
    expect(brief.generatedQueries).toContain("nominal");
    expect(brief.generatedQueries).toContain("voltage");
    expect(brief.generatedQueries).toContain("current");
  });

  it("removes a bare decimal number with no letters", () => {
    const text =
      "Improving capacity retention to reach 99.9 percent after extended cycling degradation testing programs";
    const brief = compileSearchBrief({ topics: [], challenge: text });

    // MUTATION CHECK (§1bs.1): dropping the decimal branch turns this red.
    expect(brief.generatedQueries).not.toContain("99.9");
    expect(brief.activeQuestions).not.toContain("99.9");
    expect(brief.generatedQueries).toContain("capacity");
    expect(brief.generatedQueries).toContain("retention");
    // "cycling"/"degradation" sit past generatedQueries' own narrower
    // per-field cap (5) on this text but within activeQuestions' wider one
    // (8) — both are still real, un-dropped survivors of the SAME fix.
    expect(brief.activeQuestions).toContain("cycling");
    expect(brief.activeQuestions).toContain("degradation");
  });

  it("leaves a short numeric/unit fragment under 4 characters exactly as before (pins the pre-existing, unrelated length gate)", () => {
    const brief = compileSearchBrief({
      topics: [],
      challenge: "Reduce interfacial resistance below 20 ohm cm2 across many devices under test",
    });

    // "20", "ohm", "cm2" are all under 4 characters and were already
    // excluded by the pre-existing length filter, independent of this fix.
    expect(brief.generatedQueries).not.toContain("20");
    expect(brief.generatedQueries).not.toContain("ohm");
    expect(brief.generatedQueries).not.toContain("cm2");
    expect(brief.generatedQueries).toContain("interfacial");
    expect(brief.generatedQueries).toContain("resistance");
  });

  // §1bs.1's own closed unit list deliberately excludes bare "L"/"M" so a
  // digit-first alloy/battery-cell/cathode DESIGNATION is never mistaken
  // for a number+unit token; every one of these must still reach the
  // query/seed-text output exactly as before. Each fixture is a long,
  // comma-free run-on sentence (>10 words) so the phrase/chunk tier's own
  // word-count cap empties it out, isolating the keyword tier — where this
  // filter actually lives — as the only path a survivor can take; grouped
  // (not all 10 in one sentence) so every designation still lands within
  // that tier's own sentence-position cap instead of being crowded out by
  // an unrelated, pre-existing budget limit this item does not change.
  it.each([
    [
      "18650, 21700 (cell formats), 7075, 316L (alloys)",
      "18650 and 21700 and 7075 and 316L cell and alloy designations appear throughout the published literature",
      ["18650", "21700", "7075", "316l"],
    ],
    [
      "LiCoO2, NMC811 (cathode formulas), GPT-4 (model name)",
      "LiCoO2 and NMC811 and GPT-4 cathode and model output designations appear throughout recent published studies",
      ["licoo2", "nmc811", "gpt-4"],
    ],
    [
      "1T-MoS2, 4H-SiC (polytype designations), CR2032 (cell)",
      "1T-MoS2 and 4H-SiC and CR2032 phase and substrate and coin cell designations appear throughout many reports",
      ["1t-mos2", "4h-sic", "cr2032"],
    ],
  ])("keeps every cell-format, alloy, and formula designation: %s", (_label, text, survivors) => {
    const brief = compileSearchBrief({ topics: [], challenge: text });
    const lower = brief.activeQuestions.map((q) => q.toLowerCase());

    for (const survivor of survivors) {
      expect(lower).toContain(survivor);
    }
  });

  it("keeps a non-year bare integer as an accepted cost (the ruling's own example, '1000')", () => {
    const brief = compileSearchBrief({
      topics: [],
      challenge: "Cycling stability was confirmed for 1000 repeated charge and discharge test cycles",
    });

    expect(brief.generatedQueries).toContain("1000");
  });

  it("never splits a chunk at a period between two digits, so a decimal, percentage, or version string stays whole", () => {
    const brief = compileSearchBrief({
      topics: [],
      project:
        "Cells reached 3.7V nominal voltage, showed 99.9% coulombic efficiency, and we compared GPT-4 and GPT-3.5 outputs",
    });

    expect(brief.generatedQueries).toContain("Cells reached 3.7V nominal voltage");
    expect(brief.generatedQueries).toContain("showed 99.9% coulombic efficiency");
    expect(brief.generatedQueries).toContain("and we compared GPT-4 and GPT-3.5 outputs");
    // MUTATION CHECK (§1bs.2): splitting on every period again reproduces
    // these two corrupted fragments (both survive the pre-existing longPhrases
    // caps under the old, decimal-blind splitter) and turns this red.
    expect(brief.generatedQueries).not.toContain("Cells reached 3");
    expect(brief.generatedQueries).not.toContain("7V nominal voltage");
  });

  // §1bo.9(a), folded into this item (§1bs.3).
  it("splits at an em dash, per the ruling's own example ('——solid-state electrolyte' -> 'solid-state electrolyte')", () => {
    const brief = compileSearchBrief({
      topics: [],
      project: "——solid-state electrolyte interfaces for advanced battery systems",
    });

    expect(brief.generatedQueries).toContain(
      "solid-state electrolyte interfaces for advanced battery systems",
    );
  });

  it("splits an English phrase at a mid-sentence em dash", () => {
    const brief = compileSearchBrief({
      topics: [],
      project: "Solid-state electrolyte design — improving ionic conductivity for battery applications",
    });

    expect(brief.generatedQueries).toContain("Solid-state electrolyte design");
    expect(brief.generatedQueries).toContain("improving ionic conductivity for battery applications");
    expect(brief.generatedQueries).not.toContain(
      "Solid-state electrolyte design — improving ionic conductivity for battery applications",
    );
  });

  it("splits at an en dash", () => {
    const brief = compileSearchBrief({
      topics: [],
      project: "Improving electrode stability – a persistent challenge for silicon anode materials in commercial cells",
    });

    expect(brief.generatedQueries).toContain("Improving electrode stability");
    expect(brief.generatedQueries).toContain(
      "a persistent challenge for silicon anode materials in commercial cells",
    );
  });

  it("splits at an ellipsis", () => {
    const brief = compileSearchBrief({
      topics: [],
      project: "Exploring dendrite suppression mechanisms… particularly at high current densities for extended cycling",
    });

    expect(brief.generatedQueries).toContain("Exploring dendrite suppression mechanisms");
    expect(brief.generatedQueries).toContain(
      "particularly at high current densities for extended cycling",
    );
  });

  // The shared-function placement itself (Q4 of the guide): the SAME fixture
  // passed as `challenge` shows no bare year/unit in activeQuestions/seedTexts
  // either — both the query path and the seed-text path change from one edit.
  it("also strips a standalone year/unit from activeQuestions and seedTexts when the text is the challenge field", () => {
    const req = { topics: [], challenge: "battery target 500Wh/kg by 2024" };
    const brief = compileSearchBrief(req);

    expect(brief.activeQuestions).not.toContain("2024");
    expect(brief.activeQuestions).not.toContain("500wh/kg");
    expect(brief.activeQuestions).toContain("battery");
    expect(brief.activeQuestions).toContain("target");

    const seedTexts = briefToSeedTexts(req, brief);
    expect(seedTexts).not.toContain("2024");
    expect(seedTexts).not.toContain("500wh/kg");
  });

  // Regression guarantee (§1bs, tests 6/point): every existing pinned array
  // in this file stays byte-identical — none contains a bare number/year/
  // unit token, confirmed by inspection of the pinned arrays above. Re-run
  // here as an explicit, named assertion rather than only relying on the
  // rest of this file's own describe blocks staying green.
  it("leaves the pre-existing QUERY-BUDGET/ABBREV-RECALL pinned output byte-identical (no number/year/unit token in it to remove)", () => {
    const brief = compileSearchBrief({
      topics: [],
      project: BATTERY_PROJECT_TEXT,
      controls: { focus: "tight" },
    });

    expect(brief.generatedQueries).toEqual([
      "PhD research on solid-state battery materials",
      "research",
      "solid-state",
      "battery",
      "materials",
    ]);
  });
});

// QUERY-GENERIC-WORDS part 3 (ABC-JEV-INTEGRATION.md §1bu.8, the §1bs.8
// findings 1-2 from the fresh A's VERIFIED review, docs/jev-abc/
// QUERY-DISLIKE-A-20260930T111400Z.md): two gaps against §1bs's own intent,
// found after that item shipped, both folded into this item as part 3. (1)
// a year/unit/decimal token glued to a SENTENCE-FINAL period ("2024.",
// "99.9.", "4.2v.") escaped isGenericNumericToken, because STANDALONE_YEAR/
// LEADING_NUMBER are anchored at the token's own end and a period is
// neither a digit nor a known unit suffix. (2) a number+unit token that is
// its OWN comma/dash/etc.-delimited clause ("…, 500Wh/kg, …") reached the
// phrase/chunk branch (`longPhrases`) whole, because that branch never ran
// the year/unit/decimal check at all.
describe("compileSearchBrief QUERY-GENERIC-WORDS part 3 (§1bu.8): a trailing sentence period, and a single-token phrase chunk", () => {
  it('a year glued to a sentence-final period ("2024.") produces no such query, in either the punctuated or bare form', () => {
    const brief = compileSearchBrief({
      topics: [],
      project:
        "Our development roadmap was set for 2024. The team then shifted focus toward pilot-scale manufacturing trials.",
    });
    const all = [...brief.generatedQueries, ...brief.activeQuestions].map((q) => q.toLowerCase());
    // MUTATION CHECK (§1bu.8 finding 1): skipping the trailing-punctuation
    // strip turns this red ("2024." survives, escaping the filter).
    expect(all).not.toContain("2024.");
    expect(all).not.toContain("2024");
    expect(brief.generatedQueries).toContain("development");
    expect(brief.generatedQueries).toContain("roadmap");
  });

  it('a decimal glued to a sentence-final period ("99.9.") produces no such query', () => {
    const brief = compileSearchBrief({
      topics: [],
      challenge:
        "In pilot testing the process reached 99.9. Next steps focus on scaling to full production volume.",
    });
    const all = [...brief.generatedQueries, ...brief.activeQuestions].map((q) => q.toLowerCase());
    expect(all).not.toContain("99.9.");
    expect(all).not.toContain("99.9");
    expect(brief.activeQuestions).toContain("pilot");
    expect(brief.activeQuestions).toContain("testing");
  });

  it('a number+unit token glued to a sentence-final period ("4.2v.") produces no such query', () => {
    const brief = compileSearchBrief({
      topics: [],
      challenge:
        "The pack was charged to 4.2v. Subsequent cycling measured capacity fade across repeated charge trials.",
    });
    const all = [...brief.generatedQueries, ...brief.activeQuestions].map((q) => q.toLowerCase());
    expect(all).not.toContain("4.2v.");
    expect(all).not.toContain("4.2v");
    expect(brief.activeQuestions).toContain("pack");
    expect(brief.activeQuestions).toContain("charged");
  });

  it('a number+unit token that is its own comma-delimited clause ("…, 500Wh/kg, …") produces no such query', () => {
    const brief = compileSearchBrief({
      topics: [],
      challenge:
        "Our next-generation pouch cell chemistry, 500Wh/kg, remains under evaluation for commercial viability " +
        "across several supplier partnerships.",
    });
    const all = [...brief.generatedQueries, ...brief.activeQuestions].map((q) => q.toLowerCase());
    // MUTATION CHECK (§1bu.8 finding 2): skipping the single-token chunk
    // filter turns this red ("500Wh/kg" survives whole via longPhrases).
    expect(all).not.toContain("500wh/kg");
    expect(brief.activeQuestions).toContain("pouch");
    expect(brief.activeQuestions).toContain("chemistry");
  });

  // Grouped into separate, shorter texts (not all 10 in one sentence),
  // matching the pre-existing §1bs designation test's own reasoning just
  // above: so every designation lands within its tier's own per-field cap
  // instead of being crowded out by an unrelated, pre-existing budget limit
  // this item does not change.
  it.each([
    [
      "cell formats/alloys at a sentence-ending period",
      "Testing used coin cells in the CR2032 format. Structural samples included 18650 cylinders and 21700 cylinders.",
      ["cr2032", "18650", "21700"],
    ],
    [
      "alloy/formula designations as their own comma-delimited clause",
      "Fixture materials, 7075 and 316L, were paired with a LiCoO2 reference electrode for baseline comparison.",
      ["7075", "316l", "licoo2"],
    ],
    [
      "formula/model/polytype designations as their own comma-delimited clause",
      "Benchmarked chemistries, NMC811 and GPT-4-assisted analysis, alongside 1T-MoS2 and 4H-SiC substrates.",
      ["nmc811", "gpt-4", "1t-mos2", "4h-sic"],
    ],
  ])("every §1bs.6 designation still survives: %s", (_label, text, survivors) => {
    const brief = compileSearchBrief({ topics: [], challenge: text });
    const lower = brief.activeQuestions.map((q) => q.toLowerCase());
    for (const survivor of survivors) {
      expect(lower.some((q) => q.includes(survivor))).toBe(true);
    }
  });
});
