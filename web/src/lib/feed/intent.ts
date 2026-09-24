/**
 * The retrieval intent is deliberately smaller than a profile or request.
 * It contains only user-declared retrieval meaning, so server-owned auth,
 * delivery, schedule and BYOK data cannot affect equality or private cache
 * identity. This is v1 of the on-wire/persistable contract.
 */
export const FEED_INTENT_VERSION = "feed-intent-v1" as const;
import {
  parseSelectedSenseConcept,
  type SelectedSenseConcept,
} from "./senses";

export type FeedIntentPresence = "omitted" | "explicit-empty" | "value";

export interface FeedIntentTextField {
  presence: FeedIntentPresence;
  value?: string;
  /** `legacy-import` records an honest one-way conversion of old null/blank rows. */
  provenance?: "legacy-import" | "user";
}

export interface FeedIntentExclusion {
  kind: "exclude-term";
  value: string;
}

export interface NormalizedFeedIntent {
  version: typeof FEED_INTENT_VERSION;
  project: FeedIntentTextField;
  challenge: FeedIntentTextField;
  requiredConcepts: string[];
  preferredConcepts: string[];
  exclusions: FeedIntentExclusion[];
  methods: string[];
  /** Explicit selections only; legacy free text is never auto-reclassified. */
  selectedSenseConcepts: SelectedSenseConcept[];
}

export type NormalizedFeedIntentResult =
  | { ok: true; intent: NormalizedFeedIntent }
  | { ok: false; reason: "intent_required" };

/** A stored card is valid even when it cannot yet start a feed. */
export type PersistedFeedIntentResult =
  | { ok: true; intent: NormalizedFeedIntent }
  | { ok: false };

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((candidate) => {
    if (typeof candidate !== "string") return [];
    const text = candidate.trim().replace(/\s+/g, " ");
    if (!text || seen.has(text.toLocaleLowerCase())) return [];
    seen.add(text.toLocaleLowerCase());
    return [text];
  });
}

function textField(value: unknown, legacy = false): FeedIntentTextField {
  const supplied = record(value);
  if (supplied && typeof supplied.presence === "string") {
    if (supplied.presence === "explicit-empty") return { presence: "explicit-empty" };
    if (supplied.presence === "value" && typeof supplied.value === "string") {
      const text = supplied.value.trim().replace(/\s+/g, " ");
      return text ? { presence: "value", value: text, provenance: "user" } : { presence: "explicit-empty" };
    }
    return { presence: "omitted" };
  }
  if (typeof value === "string") {
    const text = value.trim().replace(/\s+/g, " ");
    return text
      ? { presence: "value", value: text, provenance: "user" }
      : legacy
        ? { presence: "omitted", provenance: "legacy-import" }
        : { presence: "explicit-empty" };
  }
  return legacy || value === null
    ? { presence: "omitted", provenance: "legacy-import" }
    : { presence: "omitted" };
}

function exclusions(value: unknown): FeedIntentExclusion[] {
  const candidates = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  return candidates.flatMap((candidate) => {
    const source = typeof candidate === "string" ? candidate : record(candidate)?.value;
    if (typeof source !== "string") return [];
    const text = source.trim().replace(/\s+/g, " ");
    const key = text.toLocaleLowerCase();
    if (!text || seen.has(key)) return [];
    seen.add(key);
    return [{ kind: "exclude-term" as const, value: text }];
  });
}

function selectedSenseConcepts(value: unknown, legacy: boolean): SelectedSenseConcept[] {
  if (legacy || !Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((candidate) => {
    const parsed = parseSelectedSenseConcept(candidate);
    if (!parsed || seen.has(parsed.senseId)) return [];
    seen.add(parsed.senseId);
    return [parsed];
  });
}

function hasOnlyKeys(value: UnknownRecord, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function persistedTextField(value: unknown): FeedIntentTextField | null {
  const field = record(value);
  if (!field || !hasOnlyKeys(field, ["presence", "value", "provenance"])) return null;
  if (field.presence === "omitted" && field.value === undefined && (field.provenance === undefined || field.provenance === "user")) return { presence: "omitted" };
  if (field.presence === "explicit-empty" && field.value === undefined && (field.provenance === undefined || field.provenance === "user")) return { presence: "explicit-empty" };
  if (field.presence === "value" && typeof field.value === "string" && field.value.trim()) {
    return { presence: "value", value: field.value.trim().replace(/\s+/g, " "), provenance: "user" };
  }
  return null;
}

function persistedStrings(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return null;
  const normalized = strings(value);
  return normalized.length === value.length ? normalized : null;
}

/**
 * Strict JSONB boundary for profile persistence. This intentionally does not
 * share the permissive legacy/request parser: a supplied card must be a real
 * v1 shape, while null/absent database values are handled by the caller as a
 * one-way legacy import.
 */
export function normalizePersistedFeedIntent(value: unknown): PersistedFeedIntentResult {
  const source = record(value);
  if (!source || !hasOnlyKeys(source, ["version", "project", "challenge", "requiredConcepts", "preferredConcepts", "exclusions", "methods", "selectedSenseConcepts"])) return { ok: false };
  if (source.version !== FEED_INTENT_VERSION) return { ok: false };
  const project = persistedTextField(source.project);
  const challenge = persistedTextField(source.challenge);
  const requiredConcepts = persistedStrings(source.requiredConcepts);
  const preferredConcepts = persistedStrings(source.preferredConcepts);
  const methods = persistedStrings(source.methods);
  if (!project || !challenge || !requiredConcepts || !preferredConcepts || !methods || !Array.isArray(source.exclusions) || !Array.isArray(source.selectedSenseConcepts)) return { ok: false };
  const exclusionsValue = source.exclusions.map((entry) => {
    const item = record(entry);
    return item && hasOnlyKeys(item, ["kind", "value"]) && item.kind === "exclude-term" && typeof item.value === "string" ? item.value : null;
  });
  if (exclusionsValue.some((entry) => entry === null)) return { ok: false };
  const exclusionsNormalized = exclusions(exclusionsValue);
  if (exclusionsNormalized.length !== exclusionsValue.length) return { ok: false };
  const senses = source.selectedSenseConcepts.map(parseSelectedSenseConcept);
  if (senses.some((sense) => !sense) || new Set(senses.map((sense) => sense!.senseId)).size !== senses.length) return { ok: false };
  return { ok: true, intent: { version: FEED_INTENT_VERSION, project, challenge, requiredConcepts, preferredConcepts, exclusions: exclusionsNormalized, methods, selectedSenseConcepts: senses as SelectedSenseConcept[] } };
}

/** Converts current v1 input and legacy request/profile fields into one contract. */
export function normalizeFeedIntent(input: unknown): NormalizedFeedIntentResult {
  const source = record(input) ?? {};
  const card = record(source.intent);
  const usesCard = card?.version === FEED_INTENT_VERSION;
  const raw = usesCard ? card! : source;
  const legacy = !usesCard;
  const intent: NormalizedFeedIntent = {
    version: FEED_INTENT_VERSION,
    project: textField(raw.project, legacy),
    challenge: textField(raw.challenge, legacy),
    requiredConcepts: strings(raw.requiredConcepts ?? raw.topics),
    preferredConcepts: strings(raw.preferredConcepts ?? raw.softTopics),
    exclusions: exclusions(raw.exclusions ?? raw.negativeTopics),
    methods: strings(raw.methods),
    selectedSenseConcepts: selectedSenseConcepts(raw.selectedSenseConcepts, legacy),
  };

  const hasText = intent.project.presence === "value" || intent.challenge.presence === "value";
  return hasText || intent.requiredConcepts.length > 0 || intent.preferredConcepts.length > 0 || intent.selectedSenseConcepts.length > 0
    ? { ok: true, intent }
    : { ok: false, reason: "intent_required" };
}

/** Stable serialization is safe to use as a private-cache identity input. */
export function serializeFeedIntent(intent: NormalizedFeedIntent): string {
  return JSON.stringify({
    version: intent.version,
    project: intent.project,
    challenge: intent.challenge,
    requiredConcepts: intent.requiredConcepts,
    preferredConcepts: intent.preferredConcepts,
    exclusions: intent.exclusions,
    methods: intent.methods,
    selectedSenseConcepts: intent.selectedSenseConcepts,
  });
}

export function feedIntentEquals(left: NormalizedFeedIntent, right: NormalizedFeedIntent): boolean {
  return serializeFeedIntent(left) === serializeFeedIntent(right);
}

/** Browser/server callers use this to form the v1 card without an owner field. */
export function feedIntentCard(input: unknown): NormalizedFeedIntent | undefined {
  const result = normalizeFeedIntent(input);
  return result.ok ? result.intent : undefined;
}

/**
 * Browser profile fields are current user input, not imported database rows.
 * Build the v1 envelope before normalization so a deliberate browser "" stays
 * explicit-empty while absent fields remain omitted. Cron/test-digest continue
 * to call normalizeFeedIntent on raw profile rows until v1 persistence exists.
 */
export function browserFeedIntentCard(input: unknown): NormalizedFeedIntent | undefined {
  const source = record(input) ?? {};
  const browserField = (value: unknown) =>
    value === undefined || value === null ? { presence: "omitted" } : value;
  const result = normalizeFeedIntent({
    intent: {
      version: FEED_INTENT_VERSION,
      project: browserField(source.project),
      challenge: browserField(source.challenge),
      requiredConcepts: source.requiredConcepts ?? source.topics,
      preferredConcepts: source.preferredConcepts ?? source.softTopics,
      exclusions: source.exclusions ?? source.negativeTopics,
      methods: source.methods,
      selectedSenseConcepts: source.selectedSenseConcepts,
    },
  });
  return result.ok ? result.intent : undefined;
}

/** Builds a profile card without applying feed-admission's non-empty rule. */
export function profileFeedIntentCard(input: unknown): NormalizedFeedIntent | undefined {
  const source = record(input) ?? {};
  if (source.feedIntent !== undefined) {
    const stored = normalizePersistedFeedIntent(source.feedIntent);
    return stored.ok ? stored.intent : undefined;
  }
  const field = (value: unknown) => value === undefined || value === null
    ? { presence: "omitted" }
    : typeof value === "string" && !value.trim()
      ? { presence: "explicit-empty" }
      : { presence: "value", value };
  const candidate = {
    version: FEED_INTENT_VERSION,
    project: field(source.currentProject),
    challenge: field(source.currentChallenges),
    requiredConcepts: source.researchTopics ?? [],
    preferredConcepts: source.softTopics ?? [],
    exclusions: (Array.isArray(source.dislikedTopics) ? source.dislikedTopics : []).map((value) => ({ kind: "exclude-term", value })),
    methods: source.preferredMethods ?? [],
    selectedSenseConcepts: source.selectedSenseConcepts ?? [],
  };
  const parsed = normalizePersistedFeedIntent(candidate);
  const hasAnyField = source.currentProject !== undefined || source.currentChallenges !== undefined ||
    (Array.isArray(source.researchTopics) && source.researchTopics.length > 0) ||
    (Array.isArray(source.preferredMethods) && source.preferredMethods.length > 0) ||
    (Array.isArray(source.softTopics) && source.softTopics.length > 0) ||
    (Array.isArray(source.dislikedTopics) && source.dislikedTopics.length > 0) ||
    (Array.isArray(source.selectedSenseConcepts) && source.selectedSenseConcepts.length > 0);
  return parsed.ok && hasAnyField ? parsed.intent : undefined;
}

export function textValue(field: FeedIntentTextField): string | undefined {
  return field.presence === "value" ? field.value : undefined;
}
