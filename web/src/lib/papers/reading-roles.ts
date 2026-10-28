// The roles Peer works out for the parts whose heading names none (P12-48; rubric Theme C; rulings §1h.423 (c),
// §1h.424 (a), §1h.426; B P12-40 §5, rule set B).
//
// `canonicalizeHeading` gives a part its role when the heading says it ("Methods", "Conclusions"). A paper that
// prints descriptive headings, or no heading above its introduction, leaves the part `body`: no tag, nothing a
// reader can scan by. The owner now asks Peer to place those parts itself (§1h.423 (c) supersedes §1f.2's "no
// positional guessing") — from the document's own evidence only: where the part stands against the parts the
// page can name (the introduction, the methods, the references) and the text above the first heading. Tier 0
// and pure: a function of the map's rows, with no model, no fetch and no `node:` import.
//
// Four rules, applied once in `readingMapOf`, so that the map, the route's weights, the gist tiers and the
// explain route all read the same roles:
//
//   A1. the front text (the first section, which has no heading of its own) of a paper that names no
//       introduction is the introduction (setup), shown under the role's own label;
//   A2. unnamed top-level rows between the introduction and the first named method / discussion / conclusion /
//       back-matter row are evidence; an unnamed row directly before a references row is apparatus;
//   A3. unnamed top-level rows after a references row are apparatus; an unnamed row right after a named method
//       or apparatus row continues that role;
//   A4. sub-rows take their part's role (a part whose role was worked out here; the sub-headings of a part that
//       names its role already have its bucket from the extractors' inheritor).
//
// Never overridden: a row whose heading names a role (its `role` is not `body`). Never applied to a paper with
// no introduction to stand on: one that names none and whose first section is not the front text of a paper
// with more under it. A paper that is one large unheaded section is the model partition's case
// (`unheadedTrunk`, below) and is left alone. An inferred role is shown exactly like a named one (§1h.424 (a):
// no mark).

import type { ReadingMapSection, ReadingRole } from "./reading-map";

// ── The unheaded paper (moved here from reading-partition.ts, unchanged) ─────────────────────────────

/** The section a model may partition: its id, its place among the sections it was found in, and its size. */
export interface Trunk {
  sectionId: string;
  sectionIndex: number;
  paragraphCount: number;
}

/**
 * The rule's three numbers (B P10-05 §1.3). `share`: the trunk holds at least this fraction of all
 * the words — set by reasoning (a Nature-style article's Methods can be near half of the words, so
 * 0.7 would miss the real thing); nothing headed in the fixtures goes above 10 %. `paragraphs`:
 * fewer cannot make two parts of more than a paragraph or two. `placedRows`: a paper with three
 * recognised headings is mapped by its own headings; the partition is for the text they do not cover.
 */
export const TRUNK = { share: 0.5, paragraphs: 8, placedRows: 2 } as const;

/** Buckets that are not "placed" for the rule: nothing recognised, or end matter. */
const NOT_PLACED = new Set(["body", "abstract", "references", "acknowledgments", "supplementary"]);

/** The map's own count (`wordCount` in `reading-map.ts`, §1f.3). */
function wordsOf(paragraphs: readonly string[]): number {
  let words = 0;
  for (const paragraph of paragraphs) words += paragraph.split(/\s+/).length;
  return words;
}

/**
 * The section a model may partition, or null. `sections` is `readableSections(doc)` (its `id`,
 * `section.canonical` and `paragraphs`) on the server and `reading.body` in the browser.
 *
 * The trunk is the `body` section with the most words (the earlier on a tie). The paper is
 * unheaded when the trunk holds at least half of all the words and at least eight paragraphs, and
 * at most two other sections have a placed bucket. A paper with headings of its own — even six
 * unplaced sub-headings among fifteen rows — has no such section, and is mapped by them.
 *
 * P12-48: the rule lives here, in the module `readingMapOf` calls, so that the role rules can ask it
 * without `reading-map.ts` importing `reading-partition.ts` (which imports `reading-map.ts`); the
 * partition module re-exports it, and its behaviour is the one B P10-05 specified.
 */
export function unheadedTrunk(
  sections: ReadonlyArray<{ id: string; canonical: string; paragraphs: readonly string[] }>,
): Trunk | null {
  let all = 0;
  let placed = 0;
  let best = -1;
  let bestWords = -1;
  sections.forEach((section, index) => {
    const words = wordsOf(section.paragraphs);
    all += words;
    if (section.canonical === "body") {
      if (words > bestWords) {
        best = index;
        bestWords = words;
      }
    } else if (!NOT_PLACED.has(section.canonical)) {
      placed += 1;
    }
  });
  if (best < 0) return null;
  const trunk = sections[best];
  if (trunk.paragraphs.length < TRUNK.paragraphs) return null;
  if (bestWords < TRUNK.share * all) return null;
  if (placed > TRUNK.placedRows) return null;
  return { sectionId: trunk.id, sectionIndex: best, paragraphCount: trunk.paragraphs.length };
}

// ── The rules ──────────────────────────────────────────────────────────

/**
 * The label an unheaded introduction wears: the role's own label, the one the model partition's rows already use
 * (`MAP.parts.labels.introduction` in `components/reader/copy.ts`). Written here because `copy.ts` imports the
 * reading, which imports the map, which calls this module; `reading-roles.test.ts` holds the two equal.
 */
export const INTRODUCTION_LABEL = "Introduction";

/** What the extractors write for a section that has no heading (`pdf-text.ts`, `html-text.ts`): the placeholder
 *  "Body". The PDF outline emits that section with `heading` undefined; `normalize` fills the placeholder in. */
const NO_HEADING = "Body";

/**
 * Whether a heading is the placeholder the extractors write for a section that has no heading of its own (or an empty one).
 * P12-63 (rule 4): the paper's body prints no heading for such an opening - the placeholder is not a word of the paper -
 * and reads it from here, so the map's rule (A1) and the body's agree on what the placeholder is.
 */
export function isPlaceholderHeading(heading: string): boolean {
  const text = heading.trim();
  return text === "" || text === NO_HEADING;
}

function hasNoHeading(row: ReadingMapSection): boolean {
  return isPlaceholderHeading(row.heading);
}

/** Where the paper's introduction stands among its top-level rows: named (`front: false`), or the front text. */
interface Anchor {
  at: number;
  front: boolean;
}

function anchorOf(top: readonly ReadingMapSection[], trunkId: string | null): Anchor | null {
  const named = top.findIndex((row) => row.canonical === "introduction");
  if (named >= 0) return { at: named, front: false };
  const first = top[0];
  // The front text: the first section, no heading of its own, text in it, a paper under it that is not only end
  // matter, and not the whole paper (the unheaded paper's trunk is the model partition's).
  if (!first || first.canonical !== "body" || !hasNoHeading(first)) return null;
  if (first.paragraphs.length === 0 || first.id === trunkId) return null;
  if (!top.slice(1).some((row) => row.role !== "apparatus")) return null;
  return { at: 0, front: true };
}

/**
 * The map's rows with the roles of the parts whose heading names none worked out (rules A1–A4 above). `rows` is
 * the map's rows in order; `trunkId` is the id of the paper's unheaded trunk (`unheadedTrunk`), or null. Returns
 * a new array, with the very row objects where nothing changed; a row that changed is a copy.
 */
export function inferRoles(rows: readonly ReadingMapSection[], trunkId: string | null): ReadingMapSection[] {
  const top = rows.filter((row) => row.parentId === undefined);
  const anchor = anchorOf(top, trunkId);
  if (!anchor) return rows.slice();

  // A2: the evidence run ends at the first named method / discussion / conclusion / back-matter row after the
  // introduction — or at the paper's end, when it names none.
  const boundary = top.findIndex(
    (row, t) => t > anchor.at && (row.role === "method" || row.role === "interpretation" || row.role === "apparatus"),
  );
  const evidenceEnd = boundary < 0 ? top.length : boundary;
  const firstReferences = top.findIndex((row) => row.canonical === "references");

  const patches = new Map<string, Partial<ReadingMapSection>>();
  top.forEach((row, t) => {
    if (row.role !== "body") return;
    // A1.
    if (anchor.front && t === 0) {
      patches.set(row.id, { heading: INTRODUCTION_LABEL, canonical: "introduction", role: "setup" as ReadingRole });
      return;
    }
    if (t <= anchor.at) return;
    // A3: an unnamed row right after a named method or back-matter row continues that role.
    const before = top[t - 1];
    if (before.role === "method" || before.role === "apparatus") patches.set(row.id, { role: before.role });
    // A2: an unnamed row directly before a references row is back matter; the others, up to the boundary, are the
    // paper's evidence.
    else if (top[t + 1]?.canonical === "references") patches.set(row.id, { role: "apparatus" });
    // A3: the unnamed rows after a references row are back matter.
    else if (firstReferences >= 0 && t > firstReferences) patches.set(row.id, { role: "apparatus" });
    else if (t < evidenceEnd) patches.set(row.id, { role: "evidence" });
  });

  // A4: a sub-row whose heading names no role takes the role of the part it hangs under, when that role was worked
  // out above (a parent comes before its children, so it is settled first). The sub-headings of a part that names its
  // role already have its bucket - the extractors' inheritor (`bucketInheritor`) gives them it - and are not touched.
  const worked = new Set(patches.keys());
  const ends = new Map<string, ReadingRole>();
  for (const row of rows) {
    let role = patches.get(row.id)?.role ?? row.role;
    const parent = row.parentId;
    const above = parent === undefined ? undefined : ends.get(parent);
    if (role === "body" && parent !== undefined && worked.has(parent) && above !== undefined && above !== "body") {
      role = above;
      patches.set(row.id, { ...patches.get(row.id), role });
      worked.add(row.id);
    }
    ends.set(row.id, role);
  }
  return rows.map((row) => {
    const patch = patches.get(row.id);
    return patch ? { ...row, ...patch } : row;
  });
}
