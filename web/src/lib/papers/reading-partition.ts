// The model's partition of a paper with no headings (P10-07a; B P10-05 §1.3 and §2.2-2.6;
// owner's review item 3.3, second half; rubric A15): "a Nature-style paper with no headings —
// let the AI understand its rough parts and divide it into introduction, results, discussion,
// conclusion, experimental."
//
// Two pure things, no I/O and no model, so the server and the browser compute them alike:
//
//   - `unheadedTrunk`: whether a paper is "unheaded" — its text sits in ONE section nothing
//     recognised (`canonical: "body"`), the largest body row holds at least half of the words and
//     at least eight paragraphs, and the rest of the paper has at most two sections with a placed
//     bucket. It returns that section (the "trunk") or null. The rule is a function of the
//     document, so it is the same for every reader and can be remembered with the document.
//   - `sanitizePartition`: the model is asked only where each part STARTS; every invariant of a
//     partition is made here, none is hoped for — at least two parts, the first at paragraph 0,
//     ascending starts, neighbours of one role merged, a role at most twice, the ranges derived so
//     they are contiguous and cover the whole section. There is nothing to verify against the text:
//     the partition quotes nothing and asserts no fact of the paper; it is Peer's reading, labelled
//     on screen. The worst a wrong answer does is mislabel a range. The same function re-reads what
//     the browser stored (`restorePartition`), so a corrupt entry cannot draw a broken map.

import type { ReadingRole } from "./reading-map";

/** The five parts a model may name. `experimental` is materials, instruments, procedures,
 *  data processing and statistics, wherever in the section they stand. */
export const PARTITION_ROLES = ["introduction", "results", "discussion", "conclusion", "experimental"] as const;
export type PartitionRole = (typeof PARTITION_ROLES)[number];

/** The reading role a part stands for (what `gistRoute` and a row's role read). */
export const PART_ROLE: Readonly<Record<PartitionRole, ReadingRole>> = {
  introduction: "setup",
  experimental: "method",
  results: "evidence",
  discussion: "interpretation",
  conclusion: "interpretation",
};

/** One part, inclusive on both ends, in paragraph indices of the trunk section. */
export interface GuidePart {
  role: PartitionRole;
  fromParagraph: number;
  toParagraph: number;
}

export interface GuidePartition {
  sectionId: string;
  parts: GuidePart[];
}

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

// ── The sanitizer ──────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What a model may write for a role, and the role it is read as. `method` and `methods` are the
 *  one name the prompt does not use for the part; a Map, so no key of a hostile answer is looked up
 *  on an object's prototype. */
const ROLE_NAMES: ReadonlyMap<string, PartitionRole> = new Map<string, PartitionRole>([
  ...PARTITION_ROLES.map((role): [string, PartitionRole] => [role, role]),
  ["method", "experimental"],
  ["methods", "experimental"],
]);

function roleOf(value: unknown): PartitionRole | null {
  return typeof value === "string" ? (ROLE_NAMES.get(value.trim().toLowerCase()) ?? null) : null;
}

/** A paragraph index the model named: a whole number, or a string of digits; nothing else. */
function indexOf(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value === "string" && /^\d{1,15}$/.test(value)) return Number.parseInt(value, 10);
  return null;
}

/** Merge neighbours of one role; the first start stands. */
function mergeNeighbours<T extends { role: PartitionRole }>(parts: T[]): T[] {
  const out: T[] = [];
  for (const part of parts) {
    if (out.length > 0 && out[out.length - 1].role === part.role) continue;
    out.push(part);
  }
  return out;
}

/**
 * The partition a model's answer makes of one section, or null. `raw` is the answer as parsed
 * (`{ partition: [{ role, fromParagraph }] }`); `trunk` is the section it was asked about.
 *
 *   1. `raw.partition` must be an array; an entry is an object with a role (trimmed, lower-cased;
 *      `method` and `methods` read as `experimental`; any other word is dropped) and a start that
 *      is a whole number or a string of digits, `0 <= n < paragraphCount`;
 *   2. an entry whose start is not greater than the last kept start is dropped (no reordering, no
 *      duplicates);
 *   3. neighbours of one role are merged (the first start stands);
 *   4. a role beyond its second part is dropped (its paragraphs fall to the part before it), then 3 again;
 *   5. the first part's start is set to 0;
 *   6. fewer than two parts: null (a single label says nothing);
 *   7. each part ends where the next begins; the last ends at the section's last paragraph.
 */
export function sanitizePartition(raw: unknown, trunk: { sectionId: string; paragraphCount: number }): GuidePartition | null {
  if (!isRecord(raw) || !Array.isArray(raw.partition)) return null;
  const count = trunk.paragraphCount;
  if (!Number.isSafeInteger(count) || count < 2) return null;

  const ascending: Array<{ role: PartitionRole; from: number }> = [];
  for (const entry of raw.partition as unknown[]) {
    if (!isRecord(entry)) continue;
    const role = roleOf(entry.role);
    const from = indexOf(entry.fromParagraph);
    if (role === null || from === null || from >= count) continue;
    if (ascending.length > 0 && from <= ascending[ascending.length - 1].from) continue;
    ascending.push({ role, from });
  }

  const used = new Map<PartitionRole, number>();
  const twice = mergeNeighbours(ascending).filter(({ role }) => {
    const n = (used.get(role) ?? 0) + 1;
    used.set(role, n);
    return n <= 2;
  });
  const merged = mergeNeighbours(twice);
  if (merged.length < 2) return null;

  const parts: GuidePart[] = merged.map(({ role, from }, i) => ({
    role,
    fromParagraph: i === 0 ? 0 : from,
    toParagraph: i + 1 < merged.length ? merged[i + 1].from - 1 : count - 1,
  }));
  return { sectionId: trunk.sectionId, parts };
}

/**
 * A partition read back from this browser's store (or any `GuidePartition`-shaped value), through
 * the same sanitizer: null when it is not one. The browser has no document to count paragraphs
 * from, so the size is the one the stored last part ends at (the server derived it from the
 * section); the starts are re-checked against it, and every invariant is made again.
 */
export function restorePartition(value: unknown): GuidePartition | null {
  if (!isRecord(value)) return null;
  const { sectionId, parts } = value;
  if (typeof sectionId !== "string" || sectionId === "" || sectionId === "__proto__" || !Array.isArray(parts) || parts.length === 0) return null;
  const last: unknown = parts[parts.length - 1];
  if (!isRecord(last)) return null;
  const end = indexOf(last.toParagraph);
  if (end === null) return null;
  return sanitizePartition({ partition: parts }, { sectionId, paragraphCount: end + 1 });
}
