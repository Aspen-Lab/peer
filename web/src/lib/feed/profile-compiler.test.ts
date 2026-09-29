import { describe, expect, it } from "vitest";
import { normalizeFeedIntent } from "./intent";
import { compileSearchBrief } from "./profile-compiler";
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
