import { describe, expect, it } from "vitest";
import {
  applyCorrections,
  partsOf,
  resolveLooks,
  reviewStructure,
  REVIEW_CAPS,
  REVIEW_ROLES,
  sanitizeReview,
  secondLookTargets,
  sound,
  type Answer,
  type Correction,
  type DraftPart,
  type Part,
  type ReviewRole,
} from "./structure-review";

// P12-94, rule 3 (ruling §1h.482): the lower bound. Rules 1 and 2 only take corrections away: the corrections a reply ends with after them
// are a subset of those it ended with before, for every draft, reply and look verdict. This is shown by a differential test: the pipeline
// the route runs (the reply made whole, the looks asked for, the looks resolved, the result made whole once more) is run with the functions as
// they stood at 41a04320, copied below, and with the functions as they are, on randomised drafts, replies and verdicts. Every draft, reply and
// verdict below is invented; no model is asked (the verdicts are drawn), and nothing is read from a file.
//
// The copy is the old code as it was, to the line, but for the bookkeeping of refusals (tallied by op and by reason, the first eight named by
// their numbers), which feeds nothing back into what is kept, and the look records, which feed nothing back either. It lives in this file only.

type Verdict = { verdict: "draft" } | { verdict: "review"; role?: ReviewRole };
type OldWhy = "contradicts-high" | "contradicts-medium" | "unsure";
interface OldTarget {
  part: number;
  why: OldWhy;
}
// The look cap, as it stood: three per paper.
const OLD_CAPS = { corrections: 40, splitsPerPart: 3, minPiece: 2, secondLooks: 3 } as const;

// ── The functions as they stood at 41a04320 ──────────────────────────

const isRec = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const isReviewRole = (value: unknown): value is ReviewRole => typeof value === "string" && (REVIEW_ROLES as readonly string[]).includes(value);

const whole = (value: unknown): number | null =>
  typeof value === "number"
    ? Number.isSafeInteger(value) && value >= 0
      ? value
      : null
    : typeof value === "string" && /^\d{1,9}$/.test(value)
      ? Number(value)
      : null;

const roleFrom = (value: unknown): ReviewRole | null => {
  const role = typeof value === "string" ? value.trim().toLowerCase() : "";
  return isReviewRole(role) ? role : null;
};

function oldIsEdgeSplit(c: unknown, draft: readonly DraftPart[]): boolean {
  if (!isRec(c) || c.op !== "split") return false;
  const k = whole(c.part);
  const at = whole(c.atParagraph);
  if (k === null || at === null || k >= draft.length || roleFrom(c.role) === null) return false;
  return at === draft[k].from || (k + 1 < draft.length && at === draft[k].to + 1);
}

function oldSanitizeReview(
  raw: unknown,
  draft: readonly DraftPart[],
  paragraphs: number,
): { answer: Answer; rejected: number; read: number } | null {
  if (!isRec(raw) || !Array.isArray(raw.corrections)) return null;
  const list = (raw.corrections as unknown[]).filter((c) => !oldIsEdgeSplit(c, draft));
  // Each round judges the reply with the splits already found to leave a short piece refused, then looks for more.
  // A round refuses at least one more of the reply's own splits or it is the last, so there are at most as many
  // rounds as the reply has corrections (a reply holds a few, and the stored and sanitized ones at most forty).
  const short = new Map<number, { from: number; to: number }>();
  let judged = oldJudgeCorrections(list, draft, paragraphs, short);
  for (;;) {
    const cut = oldSplitsLeavingShortPieces(
      draft,
      paragraphs,
      judged.kept.map((entry) => entry.correction),
    );
    if (cut.size === 0) break;
    for (const [position, room] of cut) short.set(judged.kept[position].index, room);
    judged = oldJudgeCorrections(list, draft, paragraphs, short);
  }
  const unsure = Array.isArray(raw.unsure)
    ? [...new Set((raw.unsure as unknown[]).map(whole).filter((n): n is number => n !== null && n < draft.length))]
    : [];
  return {
    answer: { corrections: judged.kept.map((entry) => entry.correction), unsure },
    rejected: judged.rejected,
    read: list.length,
  };
}

function oldJudgeCorrections(
  list: readonly unknown[],
  draft: readonly DraftPart[],
  paragraphs: number,
  short: ReadonlyMap<number, { from: number; to: number }>,
): { kept: Array<{ correction: Correction; index: number }>; rejected: number; refusals: unknown[] } {
  const kept: Array<{ correction: Correction; index: number }> = [];
  let rejected = 0;
  // The old function counted its refusals by op and by reason and named the first eight by their numbers; none of that feeds back into what is kept.
  const refusals: Array<{ c: unknown; reason: string; room?: { from: number; to: number } }> = [];
  const refuse = (c: unknown, reason: string, room?: { from: number; to: number }): void => {
    rejected += 1;
    refusals.push({ c, reason, room });
  };
  const moved = new Set<number>();
  const roled = new Set<number>();
  const splits = new Map<number, Set<number>>();
  const firstNotSetup = draft.findIndex((part) => part.role !== "setup");
  const openingEnd = firstNotSetup === -1 ? draft.length : firstNotSetup;
  for (const [index, c] of list.entries()) {
    if (kept.length >= OLD_CAPS.corrections) {
      refuse(c, "over-cap");
      continue;
    }
    if (!isRec(c)) {
      refuse(c, "malformed");
      continue;
    }
    const k = whole(c.part);
    if (k === null) {
      refuse(c, "malformed");
      continue;
    }
    if (k >= draft.length) {
      refuse(c, "out-of-range");
      continue;
    }
    if (c.op === "move_start") {
      const i = whole(c.toParagraph);
      // Part 0 never moves; the start stays in the draft's own room: after the previous part's first paragraph, up
      // to this part's last, somewhere new, and once only.
      if (i === null) {
        refuse(c, "malformed");
        continue;
      }
      if (k === 0) {
        refuse(c, "part-0");
        continue;
      }
      if (i >= paragraphs || i <= draft[k - 1].from || i > draft[k].to) {
        refuse(c, "out-of-range");
        continue;
      }
      if (i === draft[k].from || moved.has(k)) {
        refuse(c, "repeat");
        continue;
      }
      moved.add(k);
      kept.push({ correction: { op: "move_start", part: k, toParagraph: i }, index });
    } else if (c.op === "set_role") {
      const role = roleFrom(c.role);
      if (role === null) {
        refuse(c, "malformed");
        continue;
      }
      if (role === draft[k].role) {
        refuse(c, "same-role");
        continue;
      }
      if (roled.has(k)) {
        refuse(c, "repeat");
        continue;
      }
      if (role === "setup" && k >= openingEnd) {
        refuse(c, "setup-after-opening");
        continue;
      }
      roled.add(k);
      kept.push({ correction: { op: "set_role", part: k, role }, index });
    } else if (c.op === "split") {
      const at = whole(c.atParagraph);
      const role = roleFrom(c.role);
      const seen = splits.get(k) ?? new Set<number>();
      if (at === null || role === null) {
        refuse(c, "malformed");
        continue;
      }
      if (at <= draft[k].from || at > draft[k].to) {
        refuse(c, "out-of-range");
        continue;
      }
      if (seen.has(at)) {
        refuse(c, "repeat");
        continue;
      }
      if (seen.size >= OLD_CAPS.splitsPerPart) {
        refuse(c, "split-cap");
        continue;
      }
      if (role === "setup" && k >= openingEnd) {
        refuse(c, "setup-after-opening");
        continue;
      }
      const room = short.get(index);
      if (room) {
        refuse(c, "piece-too-short", room);
        continue;
      }
      seen.add(at);
      splits.set(k, seen);
      kept.push({ correction: { op: "split", part: k, atParagraph: at, role }, index });
    } else {
      refuse(c, "malformed");
    }
  }
  return { kept, rejected, refusals };
}

function oldMovedStarts(draft: readonly DraftPart[], paragraphs: number, corrections: readonly Correction[]): { starts: number[]; applied: number; dropped: number } {
  const starts = draft.map((part) => part.from);
  let applied = 0;
  let dropped = 0;
  for (const c of corrections) {
    if (c.op !== "move_start") continue;
    const k = c.part;
    if (starts[k - 1] < c.toParagraph && c.toParagraph < (starts[k + 1] ?? paragraphs)) {
      starts[k] = c.toParagraph;
      applied += 1;
    } else {
      dropped += 1;
    }
  }
  return { starts, applied, dropped };
}

function oldSplitsLeavingShortPieces(draft: readonly DraftPart[], paragraphs: number, corrections: readonly Correction[]): Map<number, { from: number; to: number }> {
  const { starts } = oldMovedStarts(draft, paragraphs, corrections);
  let lastEvidence = -1;
  draft.forEach((part, k) => {
    if (part.role === "evidence") lastEvidence = k;
  });
  const cut = new Map<number, { from: number; to: number }>();
  for (const k of new Set(corrections.flatMap((c) => (c.op === "split" ? [c.part] : [])))) {
    const lo = starts[k];
    const hi = (starts[k + 1] ?? paragraphs) - 1;
    let live = corrections
      .flatMap((c, i) => (c.op === "split" && c.part === k && c.atParagraph > lo && c.atParagraph <= hi ? [{ i, at: c.atParagraph, role: c.role }] : []))
      .sort((a, b) => a.at - b.at);
    for (;;) {
      const edges = [lo, ...live.map((split) => split.at), hi + 1];
      const doomed = new Set<number>();
      for (let j = 0; j + 1 < edges.length; j += 1) {
        const size = edges[j + 1] - edges[j];
        if (size >= OLD_CAPS.minPiece) continue;
        if (j === live.length && j > 0 && size === 1 && k === lastEvidence && live[j - 1].role === "interpretation") continue;
        if (j > 0) doomed.add(j - 1);
        if (j < live.length) doomed.add(j);
      }
      if (doomed.size === 0) break;
      for (const p of doomed) cut.set(live[p].i, { from: lo, to: hi });
      live = live.filter((_, p) => !doomed.has(p));
    }
  }
  return cut;
}

function oldReviewStructure(raw: unknown, draft: readonly DraftPart[], paragraphs: number): { parts: Part[]; answer: Answer | null; fellBack: boolean } {
  const base = partsOf(draft);
  const fell = (): { parts: Part[]; answer: null; fellBack: true } => ({ parts: base, answer: null, fellBack: true });
  try {
    const seen = oldSanitizeReview(raw, draft, paragraphs);
    if (!seen) return fell();
    if (seen.read > 0 && seen.answer.corrections.length === 0) return fell();
    const result = applyCorrections(draft, paragraphs, seen.answer);
    return sound(result.parts, paragraphs) ? { parts: result.parts, answer: seen.answer, fellBack: false } : fell();
  } catch {
    return fell();
  }
}

function oldSecondLookTargets(draft: readonly DraftPart[], answer: Answer): OldTarget[] {
  const rank = { "contradicts-high": 0, "contradicts-medium": 1, unsure: 2 } as const;
  const seen = new Map<number, OldWhy>();
  for (const c of answer.corrections) {
    const conf = draft[c.part].conf;
    if (conf === "low") continue;
    const why: OldWhy = conf === "high" ? "contradicts-high" : "contradicts-medium";
    const had = seen.get(c.part);
    if (had === undefined || rank[why] < rank[had]) seen.set(c.part, why);
  }
  for (const k of answer.unsure) if (!seen.has(k)) seen.set(k, "unsure");
  return [...seen]
    .map(([part, why]) => ({ part, why }))
    .sort((a, b) => rank[a.why] - rank[b.why] || a.part - b.part)
    .slice(0, OLD_CAPS.secondLooks);
}

function oldResolveLooks(
  draft: readonly DraftPart[],
  answer: Answer,
  looks: ReadonlyArray<{ target: OldTarget; verdict: Verdict | null }>,
): { answer: Answer } {
  let corrections = [...answer.corrections];
  for (const { target, verdict } of looks) {
    if (target.why === "unsure") {
      if (verdict?.verdict === "review" && verdict.role && verdict.role !== draft[target.part].role && !corrections.some((c) => c.part === target.part && c.op === "set_role")) {
        corrections.push({ op: "set_role", part: target.part, role: verdict.role });
      }
    } else if (verdict?.verdict !== "review") {
      corrections = corrections.filter((c) => c.part !== target.part);
    }
  }
  return { answer: { corrections, unsure: answer.unsure } };
}

// ── The pipeline the route runs, over either set of functions ────────────

interface Implementation {
  sanitize: (raw: unknown, draft: readonly DraftPart[], paragraphs: number) => Correction[] | null;
  review: (raw: unknown, draft: readonly DraftPart[], paragraphs: number) => { fellBack: boolean; answer: Answer | null };
  targets: (draft: readonly DraftPart[], answer: Answer) => Array<{ part: number; why: string }>;
  resolve: (draft: readonly DraftPart[], answer: Answer, looks: Array<{ target: { part: number; why: string }; verdict: Verdict | null }>) => Answer;
}

const OLD: Implementation = {
  sanitize: (raw, draft, paragraphs) => oldSanitizeReview(raw, draft, paragraphs)?.answer.corrections ?? null,
  review: oldReviewStructure,
  targets: oldSecondLookTargets,
  resolve: (draft, answer, looks) => oldResolveLooks(draft, answer, looks as Array<{ target: OldTarget; verdict: Verdict | null }>).answer,
};
const NEW: Implementation = {
  sanitize: (raw, draft, paragraphs) => sanitizeReview(raw, draft, paragraphs)?.answer.corrections ?? null,
  review: reviewStructure,
  targets: secondLookTargets,
  resolve: (draft, answer, looks) => resolveLooks(draft, answer, looks as Parameters<typeof resolveLooks>[2]).answer,
};

/** What the route ends with for a reply: the corrections of the entry it stores; none when the review fell back (nothing is stored). */
function pipeline(impl: Implementation, draft: readonly DraftPart[], paragraphs: number, reply: unknown, verdictOf: (part: number) => Verdict | null): { corrections: Correction[]; looks: number } {
  const first = impl.review(reply, draft, paragraphs);
  if (first.fellBack || !first.answer) return { corrections: [], looks: 0 };
  const targets = impl.targets(draft, first.answer);
  let answer = first.answer;
  if (targets.length > 0) answer = impl.resolve(draft, first.answer, targets.map((target) => ({ target, verdict: verdictOf(target.part) })));
  const final = impl.review({ corrections: answer.corrections, unsure: answer.unsure }, draft, paragraphs);
  return { corrections: final.fellBack || !final.answer ? [] : final.answer.corrections, looks: targets.length };
}

// ── Randomised drafts, replies and verdicts (seeded: the same cases every run) ──

/** mulberry32. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Case {
  draft: DraftPart[];
  paragraphs: number;
  reply: unknown;
  verdicts: Array<Verdict | null>;
}

/**
 * A reply that fills the forty places: ten to fourteen parts of eight to ten paragraphs, mostly `low`, a reply of 37 to 44 corrections that
 * the sanitizer keeps (a role, up to three splits two paragraphs apart and a moved start for each part), and two parts the reply leaves alone
 * and lists `unsure`, for the looks to add a role to. The case the cap of forty makes of the second pass of the route.
 */
function makeSaturatedCase(rnd: () => number): Case {
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const roles: ReviewRole[] = ["method", "evidence", "interpretation", "apparatus"];
  const parts = int(10, 14);
  const draft: DraftPart[] = [];
  let at = 0;
  for (let k = 0; k < parts; k += 1) {
    const size = int(8, 10);
    const role = k === 0 ? "setup" : roles[(k + int(0, 1)) % roles.length];
    draft.push({ from: at, to: at + size - 1, role: draft[k - 1]?.role === role ? "method" : role, conf: rnd() < 0.15 ? (rnd() < 0.5 ? "medium" : "high") : "low", tags: [] });
    at += size;
  }
  const left = new Set([int(0, parts - 1), int(0, parts - 1)]);
  for (const k of left) draft[k] = { ...draft[k], conf: "low" };
  const other = (role: ReviewRole): ReviewRole => roles.find((r) => r !== role && rnd() < 0.6) ?? (role === "method" ? "evidence" : "method");
  const all: unknown[] = [];
  draft.forEach((p, k) => {
    if (left.has(k)) return;
    all.push({ op: "set_role", part: k, role: other(p.role) });
    for (const offset of [2, 4, 6]) all.push({ op: "split", part: k, atParagraph: p.from + offset, role: other(p.role) });
    if (k > 0) all.push({ op: "move_start", part: k, toParagraph: p.from + 1 });
  });
  for (let i = all.length - 1; i > 0; i -= 1) {
    const j = int(0, i);
    [all[i], all[j]] = [all[j], all[i]];
  }
  const corrections = all.slice(0, int(37, 44));
  const verdicts = draft.map((): Verdict | null => {
    const r = rnd();
    if (r < 0.1) return null;
    if (r < 0.3) return { verdict: "draft" };
    return { verdict: "review", role: roles[int(0, roles.length - 1)] };
  });
  return { draft, paragraphs: at, reply: { corrections, unsure: [...left] }, verdicts };
}

function makeCase(seed: number): Case {
  const rnd = random(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = <T,>(items: readonly T[]): T => items[int(0, items.length - 1)];
  if (rnd() < 0.08) return makeSaturatedCase(rnd);
  const big = rnd() < 0.12;

  const draft: DraftPart[] = [];
  const parts = big ? int(8, 46) : int(1, 7);
  let at = 0;
  for (let k = 0; k < parts; k += 1) {
    const size = big ? int(1, 3) : int(1, 12);
    const roles = REVIEW_ROLES.filter((role) => role !== draft[k - 1]?.role);
    const role = k === 0 && rnd() < 0.7 ? "setup" : pick(roles);
    const conf = pick(["low", "low", "low", "medium", "medium", "high", "high"] as const);
    draft.push({ from: at, to: at + size - 1, role, conf, tags: [] });
    at += size;
  }
  const paragraphs = at;

  const pool = Array.from({ length: int(1, 3) }, () => int(0, parts - 1));
  const anyPart = (): unknown => {
    const r = rnd();
    if (r < 0.5) return pick(pool);
    if (r < 0.88) return int(0, parts - 1);
    if (r < 0.93) return parts + int(0, 3);
    if (r < 0.96) return String(int(0, parts - 1));
    return pick([-1, 1.5, "x", null, undefined]);
  };
  const ordinalNear = (part: unknown): unknown => {
    const p = typeof part === "number" && draft[part] ? draft[part] : pick(draft);
    const r = rnd();
    if (r < 0.55) return int(p.from - 1, p.to + 2);
    if (r < 0.9) return int(0, paragraphs + 1);
    if (r < 0.95) return String(int(0, paragraphs));
    return pick([-3, 2.5, "y", null]);
  };
  const anyRole = (): unknown => {
    const r = rnd();
    if (r < 0.9) return pick(REVIEW_ROLES);
    if (r < 0.94) return " Setup ";
    return pick(["body", "banana", "", null, 3]);
  };
  const count = big ? int(30, 50) : rnd() < 0.2 ? 0 : int(1, 8);
  const corrections: unknown[] = [];
  for (let i = 0; i < count; i += 1) {
    const r = rnd();
    const part = anyPart();
    if (r < 0.34) corrections.push({ op: "move_start", part, toParagraph: ordinalNear(part) });
    else if (r < 0.62) corrections.push({ op: "set_role", part, role: anyRole() });
    else if (r < 0.96) corrections.push({ op: "split", part, atParagraph: ordinalNear(part), role: anyRole() });
    else corrections.push(pick(["not an object", null, { op: "delete", part }, { part }, { op: "split" }]));
  }
  const unsure = Array.from({ length: int(0, 3) }, () => (rnd() < 0.9 ? int(0, parts - 1) : pick([parts + 2, "x", -1])));
  const reply = rnd() < 0.015 ? pick([null, "prose", [], {}]) : { corrections, ...(rnd() < 0.9 ? { unsure } : {}) };

  const verdicts = draft.map((): Verdict | null => {
    const r = rnd();
    if (r < 0.12) return null;
    if (r < 0.4) return { verdict: "draft" };
    if (r < 0.62) return { verdict: "review" };
    return { verdict: "review", role: pick(REVIEW_ROLES) };
  });
  return { draft, paragraphs, reply, verdicts };
}

const key = (c: Correction): string => JSON.stringify(c);
const tally = (list: readonly Correction[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const c of list) counts.set(key(c), (counts.get(key(c)) ?? 0) + 1);
  return counts;
};
/** Whether `sub` is contained in `sup` as a multiset (every correction at most as often). */
const subset = (sub: readonly Correction[], sup: readonly Correction[]): boolean => {
  const have = tally(sup);
  for (const [k, n] of tally(sub)) if (n > (have.get(k) ?? 0)) return false;
  return true;
};

const CASES = 30_000;

describe("the lower bound (P12-94): the corrections a reply ends with are a subset of those it ended with before", () => {
  it(`holds for ${CASES.toLocaleString("en-US")} randomised drafts, replies and look verdicts, the pipeline the route runs, old functions against new`, () => {
    const stats = { cases: 0, withCorrections: 0, fewer: 0, same: 0, sureDropped: 0, lowGone: 0, wholeFallback: 0, looksOld: 0, looksNew: 0 };
    const violations: string[] = [];
    for (let seed = 1; seed <= CASES; seed += 1) {
      const c = makeCase(seed);
      const verdictOf = (part: number) => c.verdicts[part] ?? null;
      const before = pipeline(OLD, c.draft, c.paragraphs, c.reply, verdictOf);
      const after = pipeline(NEW, c.draft, c.paragraphs, c.reply, verdictOf);
      stats.cases += 1;
      stats.looksOld += before.looks;
      stats.looksNew += after.looks;
      if (before.corrections.length > 0) stats.withCorrections += 1;
      if (after.corrections.length < before.corrections.length) stats.fewer += 1;
      if (after.corrections.length === before.corrections.length) stats.same += 1;
      if (before.corrections.length > 0 && after.corrections.length === 0) stats.wholeFallback += 1;
      if (!subset(after.corrections, before.corrections) && violations.length < 3) violations.push(JSON.stringify({ seed, draft: c.draft.map(({ from, to, role, conf }) => [from, to, role, conf]), reply: c.reply, before: before.corrections, after: after.corrections }));
    }

    expect(violations).toEqual([]);
    // The cases are not vacuous: the old pipeline ended with corrections in most, the new one with fewer in many, and with as many in many.
    expect(stats.cases).toBe(CASES);
    expect(stats.withCorrections).toBeGreaterThan(CASES / 2);
    expect(stats.fewer).toBeGreaterThan(CASES / 20);
    expect(stats.same).toBeGreaterThan(CASES / 20);
  }, 60_000);

  it(`holds one step earlier, exactly, in the same ${CASES.toLocaleString("en-US")} cases: the sanitizer's corrections are the old ones without those against parts the rules were sure of, which the answer names; and no unsure part is looked at that was not`, () => {
    let sure = 0;
    let unsureLooks = 0;
    for (let seed = 1; seed <= CASES; seed += 1) {
      const c = makeCase(seed);
      const oldAnswer = oldSanitizeReview(c.reply, c.draft, c.paragraphs);
      const newAnswer = sanitizeReview(c.reply, c.draft, c.paragraphs);
      expect(newAnswer === null).toBe(oldAnswer === null);
      if (!oldAnswer || !newAnswer) continue;
      const against = oldAnswer.answer.corrections.filter((correction) => c.draft[correction.part].conf !== "low");
      const rest = oldAnswer.answer.corrections.filter((correction) => c.draft[correction.part].conf === "low");
      if (JSON.stringify(newAnswer.answer.corrections) !== JSON.stringify(rest) || JSON.stringify(newAnswer.answer.contradicted ?? []) !== JSON.stringify(against) || newAnswer.answer.unsure.join() !== oldAnswer.answer.unsure.join() || newAnswer.read !== oldAnswer.read) {
        throw new Error(`seed ${seed}: the sanitizer's answer is not the old one's without the corrections against sure parts`);
      }
      expect("contradicted" in newAnswer.answer).toBe(against.length > 0);
      sure += against.length;
      // The looks: an `unsure` look of the new functions is one the old ones asked for (same part, same kind, same place among the three).
      const before = OLD.targets(c.draft, oldAnswer.answer).filter((t) => t.why === "unsure").map((t) => t.part);
      const after = NEW.targets(c.draft, newAnswer.answer).filter((t) => t.why === "unsure").map((t) => t.part);
      unsureLooks += after.length;
      if (!after.every((part) => before.includes(part))) throw new Error(`seed ${seed}: an unsure part is looked at that was not looked at before`);
      expect(NEW.targets(c.draft, newAnswer.answer).length).toBeLessThanOrEqual(REVIEW_CAPS.secondLooks);
    }

    expect(sure).toBeGreaterThan(CASES / 10);
    expect(unsureLooks).toBeGreaterThan(CASES / 20);
  }, 60_000);
});

describe("the lower bound, case by case: what the old pipeline did, what this one does, and where the second can only lose", () => {
  // Parts: 0 setup (high, 0-5), 1 evidence (medium, 6-14), 2 interpretation (low, 15-18), 3 method (low, 19-24), 4 apparatus (high, 25-27).
  const draft: DraftPart[] = [
    { from: 0, to: 5, role: "setup", conf: "high", tags: [] },
    { from: 6, to: 14, role: "evidence", conf: "medium", tags: [] },
    { from: 15, to: 18, role: "interpretation", conf: "low", tags: [] },
    { from: 19, to: 24, role: "method", conf: "low", tags: [] },
    { from: 25, to: 27, role: "apparatus", conf: "high", tags: [] },
  ];
  const N = 28;
  const run = (impl: Implementation, corrections: unknown[], verdict: Verdict | null, unsure: number[] = []) =>
    pipeline(impl, draft, N, { corrections, unsure }, () => verdict);
  const review: Verdict = { verdict: "review", role: "method" };

  it("refuses a set_role of a medium part, of a high part, a split in a medium part and a move_start of a medium part, which a look that sided with the review let through", () => {
    for (const correction of [
      { op: "set_role", part: 1, role: "method" },
      { op: "set_role", part: 4, role: "evidence" },
      { op: "split", part: 1, atParagraph: 10, role: "method" },
      { op: "move_start", part: 1, toParagraph: 8 },
    ]) {
      expect(run(OLD, [correction], review).corrections).toEqual([correction]);
      expect(run(NEW, [correction], review).corrections).toEqual([]);
    }
    // A reply of nothing else is a review that fell back (`unusable`, `all-refused`): nothing is kept.
    expect(reviewStructure({ corrections: [{ op: "set_role", part: 1, role: "method" }], unsure: [] }, draft, N)).toMatchObject({ fellBack: true, cause: "all-refused" });
  });

  it("keeps a set_role of a low part only when a look sides with the review: it was applied with no look at all", () => {
    const correction = { op: "set_role", part: 2, role: "evidence" };

    expect(run(OLD, [correction], { verdict: "draft" })).toEqual({ corrections: [correction], looks: 0 });
    expect(run(OLD, [correction], null)).toEqual({ corrections: [correction], looks: 0 });
    expect(run(NEW, [correction], { verdict: "review" })).toEqual({ corrections: [correction], looks: 1 });
    expect(run(NEW, [correction], { verdict: "draft" })).toEqual({ corrections: [], looks: 1 });
    expect(run(NEW, [correction], null)).toEqual({ corrections: [], looks: 1 });
  });

  it("costs one look for a part, whatever the number of its corrections, inside the cap of three; with no look left the corrections go", () => {
    const two = [{ op: "set_role", part: 2, role: "evidence" }, { op: "split", part: 2, atParagraph: 17, role: "method" }];
    expect(run(NEW, two, { verdict: "review" })).toEqual({ corrections: two, looks: 1 });
    // Three places are spent by three unsure parts the rules were unsure of, as they were: the fourth part's correction has none.
    const wide: DraftPart[] = Array.from({ length: 5 }, (_, k) => ({ from: k * 4, to: k * 4 + 3, role: k % 2 === 0 ? "setup" : "method", conf: "low", tags: [] }));
    const reply = { corrections: [{ op: "set_role", part: 4, role: "evidence" }], unsure: [0, 1, 2] };
    expect(pipeline(OLD, wide, 20, reply, () => ({ verdict: "review" })).corrections).toEqual([{ op: "set_role", part: 4, role: "evidence" }]);
    expect(pipeline(NEW, wide, 20, reply, () => ({ verdict: "review" }))).toEqual({ corrections: [], looks: 3 });
  });

  it("looks at an unsure part the rules were unsure of exactly when it did: a place spent by a part the rules were sure of is spent still", () => {
    const wide: DraftPart[] = [
      { from: 0, to: 3, role: "setup", conf: "high", tags: [] },
      { from: 4, to: 7, role: "method", conf: "medium", tags: [] },
      { from: 8, to: 11, role: "evidence", conf: "high", tags: [] },
      { from: 12, to: 15, role: "interpretation", conf: "low", tags: [] },
      { from: 16, to: 19, role: "apparatus", conf: "low", tags: [] },
    ];
    const N5 = 20;
    const role: Verdict = { verdict: "review", role: "method" };
    const sure = [{ op: "set_role", part: 0, role: "method" }, { op: "set_role", part: 1, role: "apparatus" }, { op: "set_role", part: 2, role: "method" }];
    const low = { op: "set_role", part: 4, role: "evidence" };

    // Three parts the rules were sure of are corrected, and a low part: the three places are theirs, so the unsure low part (3) gets no
    // look and no role, as before. The correction against the low part (4) is looked at, in a place that costs a call, and stands.
    const crowded = { corrections: [...sure, low], unsure: [3] };
    expect(pipeline(OLD, wide, N5, crowded, () => role)).toEqual({ corrections: [...sure, low], looks: 3 });
    expect(pipeline(NEW, wide, N5, crowded, () => role)).toEqual({ corrections: [low], looks: 1 });
    // With one place free the unsure part is looked at and takes the role, in both; the new one has the look the correction against part 4 needs.
    const free = { corrections: [...sure.slice(0, 2), low], unsure: [3] };
    expect(pipeline(OLD, wide, N5, free, () => role).corrections).toEqual([...sure.slice(0, 2), low, { op: "set_role", part: 3, role: "method" }]);
    expect(pipeline(NEW, wide, N5, free, () => role)).toEqual({ corrections: [low, { op: "set_role", part: 3, role: "method" }], looks: 2 });
    // An unsure listing of a part the rules were sure of draws no call but spends its place: the three places go to parts 0 to 2, and part 3
    // is not looked at, as before; the roles the old looks added to parts 0 and 2 are not added (only the correction against part 4, looked at).
    const listed = { corrections: [low], unsure: [0, 1, 2, 3] };
    expect(pipeline(OLD, wide, N5, listed, () => role)).toEqual({ corrections: [low, { op: "set_role", part: 0, role: "method" }, { op: "set_role", part: 2, role: "method" }], looks: 3 });
    expect(pipeline(NEW, wide, N5, listed, () => role)).toEqual({ corrections: [low], looks: 1 });
  });

  it("adds a role for an unsure part only when it is sure to find room among the forty corrections: the second pass of the route would refuse it for the cap where the old pipeline's did", () => {
    // Fifteen low parts of ten paragraphs; the last is left alone and listed unsure, and the look names the role evidence for it.
    const parts: DraftPart[] = Array.from({ length: 15 }, (_, k) => ({ from: k * 10, to: k * 10 + 9, role: k % 2 === 0 ? "method" : "evidence", conf: "low", tags: [] }));
    const lastPart = parts.length - 1;
    const splits = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ op: "split", part: Math.floor(i / 3), atParagraph: Math.floor(i / 3) * 10 + 2 + (i % 3) * 2, role: i % 2 === 0 ? "interpretation" : "apparatus" }));
    const add: Correction = { op: "set_role", part: lastPart, role: "evidence" };
    const asked = (impl: Implementation, n: number) => pipeline(impl, parts, 150, { corrections: splits(n), unsure: [lastPart] }, () => ({ verdict: "review", role: "evidence" }));
    const added = (list: readonly Correction[]) => list.some((c) => key(c) === key(add));

    // Room: 36 corrections and the three looks that might each add one come to 39. Both pipelines add the role.
    expect(added(asked(OLD, 36).corrections)).toBe(true);
    expect(added(asked(NEW, 36).corrections)).toBe(true);
    // The forty places are full: the old pipeline kept all forty (a low part's corrections had no look) and refused the role for the cap.
    // The new one drops what no look agreed with, so there would be room; it adds nothing, since the old one did not.
    expect(asked(OLD, 40).corrections).toHaveLength(40);
    expect(added(asked(OLD, 40).corrections)).toBe(false);
    expect(added(asked(NEW, 40).corrections)).toBe(false);
    expect(subset(asked(NEW, 40).corrections, asked(OLD, 40).corrections)).toBe(true);
  });
});
