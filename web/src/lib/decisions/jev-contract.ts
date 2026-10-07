/**
 * Jev's actual wire contract: request builder + strict response validator.
 * Pure and side-effect-free except for `logTruncationEvent`'s one-line
 * console log (mirrors `llm/usage-log.ts`'s "never log prompt/response
 * text" contract — only lengths, never abstract text). No network call
 * lives here; `jev-client.ts` (P3-S2) owns the actual HTTP transport and
 * calls `validateJevResponse` on every 200 response.
 *
 * Endpoint/request/response field names below are VERIFIED against
 * docs.typesafe.ai (see docs/jev-abc/P3-B-20260924T0525Z.md JEV CONTRACT).
 */

import type { DecisionAnswer, DecisionRequest } from "./types";
import {
  INSUFFICIENT_INFORMATION_KEY,
  JEV_MODEL_ID,
  UNKNOWN_CONFIDENCE_THRESHOLD,
  questionSpec,
  type DecisionQuestionSpec,
} from "./rubric";

// ---------------------------------------------------------------------------
// Wire-level types (Jev's own HTTP contract, not Peer's DecisionRequest/
// DecisionAnswer shape).
// ---------------------------------------------------------------------------

export interface JevChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}

export interface JevScoreQuestion {
  type: "score";
  instructions: string;
  /** Ordered level descriptions, 2-10 per the Jev contract. */
  criteria: string[];
}

export type JevQuestion = JevChoiceQuestion | JevScoreQuestion;

export interface JevWireRequest {
  state: unknown;
  model: string;
  questions: Record<string, JevQuestion>;
}

export interface JevChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface JevScoreAnswer {
  type: "score";
  score: number;
  /**
   * F-A-P3S12-01 (Round 3 fix): VERIFIED against docs.typesafe.ai/api-reference
   * ("legend: map<string,string> — each level number mapped back to its
   * description") and every worked example on /primitives/score and
   * /introduction/quickstart — an OBJECT keyed by stringified level index
   * "0".."N-1", never a JS array. The original implementation typed and
   * validated this as `string[]`, which rejected every real Score answer
   * (see docs/jev-abc/P3-S1S2-A-20260924T0624Z.md).
   */
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}

export type JevAnswer = JevChoiceAnswer | JevScoreAnswer;

export interface JevWireResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}

// ---------------------------------------------------------------------------
// Truncation — the 32k tokens/request ceiling (VERIFIED), 32k of which is
// reserved for `state` + the single longest question, is the real
// constraint, not an arbitrary Peer number. Budgeted conservatively here so
// title/intent/sense text and every question's own instructions always have
// room left over.
// ---------------------------------------------------------------------------

export interface TruncationEvent {
  paperId: string;
  originalLength: number;
  truncatedLength: number;
}

/** Conservative slice of the 32k state+longest-question ceiling reserved just for the abstract. */
const ABSTRACT_TOKEN_BUDGET = 3000;
/**
 * Conservative average characters per token for Latin-script text.
 *
 * Exported as part of this file's contract (a company token estimator once
 * shared this EXACT ratio; that estimator is gone, the export stays).
 */
export const LATIN_CHARS_PER_TOKEN = 4;
/**
 * Conservative characters per token for CJK-dense text (ABC-JEV-
 * INTEGRATION.md §1p.H(9): the truncation budget must be conservative for
 * CJK, i.e. more tokens per character). A Han/Kana/Hangul character is
 * commonly its own token or more, so budget four times tighter per
 * character than Latin text gets.
 *
 * Exported for the same reason as `LATIN_CHARS_PER_TOKEN` above.
 */
export const CJK_CHARS_PER_TOKEN = 1;
const CJK_DENSITY_THRESHOLD = 0.3;
const CJK_PATTERN = /[㐀-鿿぀-ヿ가-힯]/gu;

/** Exported so a caller sizing text by tokens can share this exact test rather than keep a second copy. */
export function isCjkHeavy(text: string): boolean {
  if (text.length === 0) return false;
  const matches = text.match(CJK_PATTERN);
  const count = matches ? matches.length : 0;
  return count / text.length > CJK_DENSITY_THRESHOLD;
}

function abstractCharBudget(text: string): number {
  const charsPerToken = isCjkHeavy(text) ? CJK_CHARS_PER_TOKEN : LATIN_CHARS_PER_TOKEN;
  return ABSTRACT_TOKEN_BUDGET * charsPerToken;
}

/** One compact line per truncation event. SAFETY: never logs abstract text, only lengths — same contract as `llm/usage-log.ts`. */
export function logTruncationEvent(event: TruncationEvent): void {
  console.log(
    `[decisions] truncated abstract paperId=${event.paperId} originalLength=${event.originalLength} truncatedLength=${event.truncatedLength}`,
  );
}

function truncateAbstract(
  paperId: string,
  abstract: string | null,
): { text: string | null; truncation: TruncationEvent | null } {
  if (abstract === null) return { text: null, truncation: null };
  const maxChars = abstractCharBudget(abstract);
  if (abstract.length <= maxChars) return { text: abstract, truncation: null };
  const truncated = abstract.slice(0, maxChars);
  const truncation: TruncationEvent = {
    paperId,
    originalLength: abstract.length,
    truncatedLength: truncated.length,
  };
  logTruncationEvent(truncation);
  return { text: truncated, truncation };
}

// ---------------------------------------------------------------------------
// Request builder. Every question's `instructions` is a fixed plain-English
// string (rubric.ts) — never templated. 100% of paper/intent/sense content
// lives only in `state`, as data, so untrusted source text (e.g. an
// abstract containing "ignore previous instructions") can never reach an
// instruction field.
// ---------------------------------------------------------------------------

interface JevStatePaper {
  title: string;
  abstract: string | null;
  venue?: string;
}

interface JevStateIntent {
  /** Project/challenge come first — the primary signal (ABC-JEV-INTEGRATION.md §1c). */
  project: { presence: string; value?: string };
  challenge: { presence: string; value?: string };
  requiredConcepts: string[];
  preferredConcepts: string[];
  methods: string[];
  exclusions: string[];
}

interface JevStateSense {
  senseId: string;
  domain: string;
  context?: string;
}

export interface JevStatePayload {
  paper: JevStatePaper;
  intent: JevStateIntent;
  senses: JevStateSense[];
}

function buildState(request: DecisionRequest, truncatedAbstract: string | null): JevStatePayload {
  const paper: JevStatePaper = {
    title: request.title,
    abstract: truncatedAbstract,
    ...(request.venue ? { venue: request.venue } : {}),
  };
  const projectField = request.intentCard.project;
  const challengeField = request.intentCard.challenge;
  const intent: JevStateIntent = {
    project: {
      presence: projectField.presence,
      ...(projectField.value !== undefined ? { value: projectField.value } : {}),
    },
    challenge: {
      presence: challengeField.presence,
      ...(challengeField.value !== undefined ? { value: challengeField.value } : {}),
    },
    requiredConcepts: request.intentCard.requiredConcepts,
    preferredConcepts: request.intentCard.preferredConcepts,
    methods: request.intentCard.methods,
    exclusions: request.intentCard.exclusions.map((exclusion) => exclusion.value),
  };
  const senses: JevStateSense[] = request.senseConcepts.map((concept) => ({
    senseId: concept.senseId,
    domain: concept.domain,
    ...(concept.context ? { context: concept.context } : {}),
  }));
  return { paper, intent, senses };
}

function toWireQuestion(spec: DecisionQuestionSpec): JevQuestion {
  if (spec.kind === "choice") {
    return { type: "choice", instructions: spec.instructions, criteria: spec.criteria };
  }
  return { type: "score", instructions: spec.instructions, criteria: spec.levels };
}

export interface BuildJevRequestResult {
  wireRequest: JevWireRequest;
  /** Non-null exactly when the abstract was actually truncated for this paper. */
  truncation: TruncationEvent | null;
}

/**
 * Builds the literal Jev wire request for one paper. Never mutates
 * `request`. `request.questions` is trusted as already gated (see
 * `rubric.ts`'s `selectQuestionsForRequest`) — this function only shapes
 * exactly the questions it is given.
 */
export function buildJevRequest(request: DecisionRequest): BuildJevRequestResult {
  const { text: truncatedAbstract, truncation } = truncateAbstract(request.paperId, request.abstract);
  const state = buildState(request, truncatedAbstract);
  const questions: Record<string, JevQuestion> = {};
  for (const id of request.questions) {
    questions[id] = toWireQuestion(questionSpec(id));
  }
  return {
    wireRequest: { state, model: JEV_MODEL_ID, questions },
    truncation,
  };
}

// ---------------------------------------------------------------------------
// Strict response validator. Rules 1-6 (docs/jev-abc/P3-B-20260924T0525Z.md
// DESIGN §2): any single failure rejects the WHOLE response — a malformed
// one answer is grounds to distrust the batch of questions for that paper,
// never a partial accept.
// ---------------------------------------------------------------------------

export type JevValidationFailureRule =
  | "malformed"
  | "model_mismatch"
  | "answer_keys_mismatch"
  | "choice_invalid"
  | "score_invalid"
  | "usage_invalid";

export type JevValidationResult =
  | { ok: true; modelId: string; answers: DecisionAnswer[]; usage: { inputTokens: number; outputTokens: number } }
  | { ok: false; rule: JevValidationFailureRule; detail: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function sameKeySet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((key, i) => key === sortedB[i]);
}

function fail(rule: JevValidationFailureRule, detail: string): JevValidationResult {
  return { ok: false, rule, detail };
}

/**
 * Validates a raw (`unknown`-typed — never trusted) Jev HTTP response body
 * against exactly the question set that was requested. `expected.questions`
 * should be the same `wireRequest.questions` map `buildJevRequest` produced
 * for this call, so criteria/level counts are checked against what was
 * actually asked, not against the whole rubric.
 */
export function validateJevResponse(
  raw: unknown,
  expected: { modelId: string; questions: Record<string, JevQuestion> },
): JevValidationResult {
  if (!isRecord(raw)) return fail("malformed", "response body is not a JSON object");

  // Rule 1 — exact pinned model echo, never trust an alias.
  const modelId = raw.model;
  if (typeof modelId !== "string" || modelId !== expected.modelId) {
    return fail("model_mismatch", `expected model "${expected.modelId}", got ${JSON.stringify(modelId)}`);
  }

  // Rule 2 — answers keys are exactly the requested question ids.
  const rawAnswers = raw.answers;
  if (!isRecord(rawAnswers)) return fail("answer_keys_mismatch", "answers is not a JSON object");
  const expectedIds = Object.keys(expected.questions);
  const actualIds = Object.keys(rawAnswers);
  if (!sameKeySet(expectedIds, actualIds)) {
    return fail(
      "answer_keys_mismatch",
      `answers keys ${JSON.stringify(actualIds)} do not exactly match requested question ids ${JSON.stringify(expectedIds)}`,
    );
  }

  // Rules 3-4 — per-answer shape, plus unknown derivation.
  const answers: DecisionAnswer[] = [];
  for (const id of expectedIds) {
    const spec = expected.questions[id];
    const answer = rawAnswers[id];
    if (!isRecord(answer)) {
      return fail(spec.type === "choice" ? "choice_invalid" : "score_invalid", `answer "${id}" is not a JSON object`);
    }

    if (spec.type === "choice") {
      if (answer.type !== "choice") return fail("choice_invalid", `answer "${id}" has wrong type ${JSON.stringify(answer.type)}`);
      const criteriaKeys = Object.keys(spec.criteria);
      const choice = answer.choice;
      if (typeof choice !== "string" || !criteriaKeys.includes(choice)) {
        return fail("choice_invalid", `answer "${id}" choice ${JSON.stringify(choice)} is not one of the declared criteria`);
      }
      const probabilities = answer.probabilities;
      if (!isRecord(probabilities) || !sameKeySet(criteriaKeys, Object.keys(probabilities))) {
        return fail("choice_invalid", `answer "${id}" probabilities keys do not match declared criteria`);
      }
      const confidence = answer.confidence;
      if (!isFiniteInRange(confidence, 0, 1)) {
        return fail("choice_invalid", `answer "${id}" confidence is not finite in [0,1]`);
      }
      const unknown = choice === INSUFFICIENT_INFORMATION_KEY || confidence < UNKNOWN_CONFIDENCE_THRESHOLD;
      answers.push({ questionId: id as DecisionAnswer["questionId"], kind: "choice", value: choice, confidence, unknown });
    } else {
      if (answer.type !== "score") return fail("score_invalid", `answer "${id}" has wrong type ${JSON.stringify(answer.type)}`);
      const levelCount = spec.criteria.length;
      const score = answer.score;
      if (!isFiniteInRange(score, 0, levelCount - 1)) {
        return fail("score_invalid", `answer "${id}" score is not finite within [0, ${levelCount - 1}]`);
      }
      // F-A-P3S12-01/02 (Round 3 fix): `legend` and `probabilities` are both
      // objects keyed by the exact stringified level indices "0".."N-1" on
      // the real wire contract (see the `JevScoreAnswer.legend` doc comment
      // above) — a full key-IDENTITY check via `sameKeySet`, mirroring the
      // Choice branch's existing `probabilities` check, not merely a count.
      const expectedLevelKeys = Array.from({ length: levelCount }, (_, index) => String(index));
      const legend = answer.legend;
      if (!isRecord(legend) || !sameKeySet(expectedLevelKeys, Object.keys(legend))) {
        return fail("score_invalid", `answer "${id}" legend keys do not match the declared level indices "0".."${levelCount - 1}"`);
      }
      const probabilities = answer.probabilities;
      if (!isRecord(probabilities) || !sameKeySet(expectedLevelKeys, Object.keys(probabilities))) {
        return fail("score_invalid", `answer "${id}" probabilities keys do not match the declared level indices "0".."${levelCount - 1}"`);
      }
      const confidence = answer.confidence;
      if (!isFiniteInRange(confidence, 0, 1)) {
        return fail("score_invalid", `answer "${id}" confidence is not finite in [0,1]`);
      }
      const unknown = confidence < UNKNOWN_CONFIDENCE_THRESHOLD;
      answers.push({ questionId: id as DecisionAnswer["questionId"], kind: "score", value: score, confidence, unknown });
    }
  }

  // Rule 5 — usage is non-negative finite (defends the cost log against NaN/garbage).
  const usage = raw.usage;
  if (!isRecord(usage)) return fail("usage_invalid", "usage is not a JSON object");
  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;
  if (!isFiniteInRange(inputTokens, 0, Number.MAX_SAFE_INTEGER)) {
    return fail("usage_invalid", "usage.input_tokens is not a non-negative finite number");
  }
  if (!isFiniteInRange(outputTokens, 0, Number.MAX_SAFE_INTEGER)) {
    return fail("usage_invalid", "usage.output_tokens is not a non-negative finite number");
  }

  // Rule 6 is structural: every branch above returns immediately on the
  // first problem found, so a response is only ever accepted here in full —
  // `answers` never carries a partial set.
  return {
    ok: true,
    modelId,
    answers,
    usage: { inputTokens, outputTokens },
  };
}
