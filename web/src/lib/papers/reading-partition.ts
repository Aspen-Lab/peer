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
//
// P10-07b (B P10-05 §3.1, §4) lays the partition over the map and the route, still pure:
//
//   - `partitionedMap`: the trunk's row replaced, in place, by one row per part — the role's label
//     for a heading, the trunk's own paragraph lines for the range (real indices, real openings),
//     the words and minutes counted again from the paragraphs, a `part` record that tells the view
//     where the trunk stands in the body. The totals are unchanged. The body is not touched: it
//     keeps the trunk's section, its anchors and its heading (§1h.79 (c), option A: the map only).
//   - `withPartitionMarks`: a group's mark, derived from the paragraphs inside it. The unit the
//     route scores is the paragraph inside the real trunk section (P10-06), and the body reads
//     the trunk's own id; a group is not scored as a section — three or four groups would give a
//     term in two of them almost the weight of one in one, and the map and the body would grade one
//     paragraph twice. The group keys are added beside the real ids, and nothing else moves.

import { MAP } from "@/components/reader/copy";
import { GIST_QUESTION, gistRoute, routeByQuestions, type ReadingMap, type ReadingMapSection, type ReadingRole, type RouteSection, type RouteTier } from "./reading-map";

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

// ── The overlay (P10-07b; B P10-05 §3.1) ─────────────────────────────────

/** Where a group row stands in the paper: the trunk it divides, the trunk's place among the body's sections
 *  (the anchors `paper-section-<sectionIndex>-p<n>` the body writes), the part's role and its paragraph range. */
export interface MapPart {
  sectionId: string;
  sectionIndex: number;
  role: PartitionRole;
  from: number;
  to: number;
}

/** A map row, and, for a group row, where it stands. */
export type PartitionedSection = ReadingMapSection & { part?: MapPart };

/** The group row's place in the paper; absent for every row the paper itself has. */
export function partOf(row: ReadingMapSection): MapPart | undefined {
  return (row as PartitionedSection).part;
}

/** The body as the overlay reads it: `PaperReading.body`, index-aligned with the map's rows. */
type BodyLike = ReadonlyArray<{ id: string; canonical: string; paragraphs: readonly string[] }>;

/** The map's own rate (`WORDS_PER_MINUTE` in `reading-map.ts`), which a row's minutes come from. */
const WORDS_PER_MINUTE = 180;

/** Whether the parts are two or more, contiguous, start at 0 and end at the section's last paragraph. */
function covers(partition: GuidePartition, paragraphCount: number): boolean {
  const { parts } = partition;
  if (!Array.isArray(parts) || parts.length < 2) return false;
  let next = 0;
  for (const part of parts) {
    if (!isRecord(part) || typeof part.role !== "string" || !Object.hasOwn(PART_ROLE, part.role)) return false;
    if (part.fromParagraph !== next || !Number.isSafeInteger(part.toParagraph) || part.toParagraph < part.fromParagraph) return false;
    next = part.toParagraph + 1;
  }
  return next === paragraphCount;
}

/**
 * The map with the trunk's row replaced, in the same place, by one row per part (B P10-05 §3.1). The rows before
 * and after keep their order and are the very objects they were. A group row is an ordinary map row —
 *
 *   - `id` `<sectionId>~<n>`, `heading` the role's label, `canonical` the role, `role` the reading role it maps to;
 *   - `level` 1 and no `parentId`; no `page` (the trunk's page is the first part's, not the others');
 *   - `paragraphs` the trunk's own lines for the range, with their real indices and openings;
 *   - `words` and `minutes` counted again from the range's paragraphs, so the groups add up to the trunk;
 *   - `part`, the record the view reads its anchors and its gist key from.
 *
 * The map is returned as it was (the same object) for no partition, for a partition whose section is not in the map,
 * and for one the body does not bear out: the section is not what the rule reads as unheaded (the model is asked
 * only about an unheaded paper's trunk, so a stored answer for any other section is not drawn), or the parts do
 * not cover its paragraphs. The totals are unchanged.
 */
export function partitionedMap(map: ReadingMap, body: BodyLike | undefined, partition: GuidePartition | null | undefined): ReadingMap {
  if (!partition || !body) return map;
  const at = map.sections.findIndex((row) => row.id === partition.sectionId);
  if (at < 0) return map;
  const trunk = unheadedTrunk(body);
  if (!trunk || trunk.sectionId !== partition.sectionId || trunk.sectionIndex !== at) return map;
  const row = map.sections[at];
  const text = body[at].paragraphs;
  if (row.paragraphs.length !== text.length || !covers(partition, text.length)) return map;

  const groups = partition.parts.map((part, n): PartitionedSection => {
    const words = text.slice(part.fromParagraph, part.toParagraph + 1).reduce((sum, paragraph) => sum + paragraph.split(/\s+/).length, 0);
    return {
      id: `${row.id}~${n}`,
      heading: MAP.parts.labels[part.role],
      canonical: part.role,
      role: PART_ROLE[part.role],
      words,
      minutes: words > 0 ? Math.max(1, Math.ceil(words / WORDS_PER_MINUTE)) : 0,
      paragraphs: row.paragraphs.filter((line) => line.index >= part.fromParagraph && line.index <= part.toParagraph),
      level: 1,
      part: { sectionId: row.id, sectionIndex: at, role: part.role, from: part.fromParagraph, to: part.toParagraph },
    };
  });
  return { sections: [...map.sections.slice(0, at), ...groups, ...map.sections.slice(at + 1)], totalMinutes: map.totalMinutes };
}

// ── The route fold (P10-07b; B P10-05 §4) ────────────────────────────────

/** A route section as the page draws it: Tier 0's, or the model's with the `background` tier (`DisplayRoute`). */
type MarkSection = Omit<RouteSection, "tier"> & { tier: RouteTier | "background" };

/** The two route shapes the page holds (`RouteResult`, `DisplayRoute`), by what the fold reads and writes. */
interface MarkRoute {
  byQuestion: ReadonlyArray<{ question: string; vague: boolean; sections: Readonly<Record<string, MarkSection>> }>;
  vague: boolean;
}

/**
 * The route with a mark for each group row beside the real ids' (B P10-05 §4); the route is returned as it was (the same
 * object) when there is no partition that applies. For every question that marks the trunk:
 *
 *   - the trunk's own entry is untouched — the body reads it, and it reads nothing else;
 *   - each group's `paragraphs` and `topParagraphs` are the trunk's, those inside the group's range: the grades
 *     of the paragraphs, which are the map's lines' tints and the body's, so the two never disagree;
 *   - the group's `tier` is the strongest tier any of its paragraphs wears under the trunk's mark (the rule
 *     `sectionMark` applies to a section's own paragraphs): the trunk's tier where the group holds a top
 *     paragraph, `faint` where it only mentions, `none` where it does not (and for a trunk that marks no
 *     paragraph, as a model's mark does not, none: the groups do not inherit it);
 *   - `hits` are the question's terms counted over the group's paragraphs alone, and `evidence` the best
 *     sentence among them, verbatim — `routeByQuestions` over the groups, so the counts are the ones a
 *     reader can check in the group;
 *   - at most `max(1, floor(N / 2))` of the N groups are `strong` (the earlier first: the paragraphs that
 *     say most in one section tie or are one), the others `medium` — the ROW's tier. A group so lowered keeps its
 *     `paragraphs` and `topParagraphs` whole, and its lines are not drawn at its row's tier: the map reads each line's
 *     tier from the trunk's mark (P10-32, BACKLOG-73), the one the body draws, so a paragraph that says the most
 *     is strong in the map as in the body though the row it stands in is medium.
 *
 * "Just get the gist" names no paragraph: a group takes its tier from its role, as every row does.
 */
export function withPartitionMarks<R extends MarkRoute>(
  route: R | undefined,
  map: ReadingMap | undefined,
  body: BodyLike | undefined,
  partition: GuidePartition | null | undefined,
): R | undefined {
  if (!route || !map || !partition) return route;
  const over = partitionedMap(map, body, partition);
  if (over === map) return route;
  const groups = over.sections.filter((row) => partOf(row) !== undefined);
  const first = partOf(groups[0])!;
  const text = body![first.sectionIndex].paragraphs;
  const cap = Math.max(1, Math.floor(groups.length / 2));
  const within = (list: readonly number[] | undefined, part: MapPart): number[] => (list ?? []).filter((i) => i >= part.from && i <= part.to);

  let changed = false;
  const byQuestion = route.byQuestion.map((entry) => {
    if (entry.vague) return entry;
    const added: Record<string, MarkSection> = {};

    if (entry.question === GIST_QUESTION) {
      const roles = gistRoute(over).byQuestion[0].sections;
      for (const group of groups) added[group.id] = roles[group.id];
    } else {
      const trunk = entry.sections[first.sectionId];
      if (!trunk) return entry;
      const counted =
        trunk.paragraphs.length > 0
          ? routeByQuestions(
              { sections: groups, totalMinutes: over.totalMinutes },
              groups.map((group) => ({ paragraphs: text.slice(partOf(group)!.from, partOf(group)!.to + 1) })),
              [entry.question],
            ).byQuestion[0].sections
          : {};
      let strong = 0;
      for (const group of groups) {
        const part = partOf(group)!;
        const paragraphs = within(trunk.paragraphs, part);
        const top = within(trunk.topParagraphs, part);
        let tier: RouteTier | "background" =
          paragraphs.length === 0 || trunk.tier === "none"
            ? "none"
            : trunk.tier === "background" || !trunk.topParagraphs
              ? trunk.tier
              : top.length > 0
                ? trunk.tier
                : "faint";
        if (tier === "strong" && ++strong > cap) tier = "medium";
        const found = tier === "none" ? undefined : counted[group.id];
        added[group.id] = {
          tier,
          hits: found?.hits ?? [],
          ...(found?.evidence !== undefined ? { evidence: found.evidence } : {}),
          paragraphs,
          ...(trunk.topParagraphs ? { topParagraphs: top } : {}),
        };
      }
    }
    changed = true;
    return { ...entry, sections: { ...entry.sections, ...added } };
  });
  return changed ? ({ ...route, byQuestion } as R) : route;
}
