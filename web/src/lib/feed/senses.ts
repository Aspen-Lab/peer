import { canonicalize } from "@/lib/scoring/term-expand";

/**
 * A deliberately finite, Peer-authored product/test catalog. It is not an
 * imported vocabulary asset and must not be expanded without P1-03 evidence.
 */
export const PEER_LOCAL_SENSE_CATALOG_VERSION = "peer-local-senses-v1" as const;

export type PeerLocalSenseId =
  | "hr.role_conflict"
  | "compliance.conflict_of_interest"
  | "software.dependency_conflict"
  | "statistics.structural_equation_modeling"
  | "materials.scanning_electron_microscopy";

export type SenseAliasRelation = "exact" | "close" | "related";
export type SenseEvidenceKind = "exactAlias" | "closeAlias" | "contextInsufficient" | "conflict";

export interface SenseAlias {
  readonly value: string;
  readonly language: "en" | "zh";
  readonly relation: SenseAliasRelation;
  /** Short forms may only resolve when a non-ambiguous context is present. */
  readonly requiresContext?: boolean;
  readonly contextMarkers?: readonly string[];
}

export interface SelectedSenseConcept {
  readonly conceptId: string;
  readonly senseId: PeerLocalSenseId;
  readonly domain: string;
  readonly vocabularyVersion: string;
  readonly provenance: {
    readonly source: "peer-authored";
    readonly release: string;
    readonly mappingVersion: string;
  };
  readonly context?: string;
  readonly matchRequirement?: "exact" | "exact-or-close";
}

interface LocalSenseDefinition {
  readonly senseId: PeerLocalSenseId;
  readonly domain: string;
  readonly aliases: readonly SenseAlias[];
}

const LOCAL_SENSES: readonly LocalSenseDefinition[] = Object.freeze([
  {
    senseId: "hr.role_conflict",
    domain: "hr-organizational",
    aliases: [
      { value: "role conflict", language: "en", relation: "exact" },
      { value: "员工角色冲突", language: "zh", relation: "exact" },
      { value: "inter-role conflict", language: "en", relation: "close" },
    ],
  },
  {
    senseId: "compliance.conflict_of_interest",
    domain: "compliance",
    aliases: [
      { value: "conflict of interest", language: "en", relation: "exact" },
      { value: "利益冲突", language: "zh", relation: "exact" },
    ],
  },
  {
    senseId: "software.dependency_conflict",
    domain: "software",
    aliases: [
      { value: "dependency conflict", language: "en", relation: "exact" },
      { value: "依赖冲突", language: "zh", relation: "exact" },
    ],
  },
  {
    senseId: "statistics.structural_equation_modeling",
    domain: "statistics",
    aliases: [
      { value: "structural equation modeling", language: "en", relation: "exact" },
      { value: "structural equation model", language: "en", relation: "exact" },
      { value: "SEM", language: "en", relation: "exact", requiresContext: true, contextMarkers: ["structural equation"] },
    ],
  },
  {
    senseId: "materials.scanning_electron_microscopy",
    domain: "materials",
    aliases: [
      { value: "scanning electron microscopy", language: "en", relation: "exact" },
      { value: "SEM", language: "en", relation: "exact", requiresContext: true, contextMarkers: ["scanning electron", "electron microscopy"] },
    ],
  },
] as const);

const bySenseId = new Map(LOCAL_SENSES.map((sense) => [sense.senseId, sense]));
const WORD = "\\p{L}\\p{N}\\p{M}";

function includesAlias(text: string, alias: string): boolean {
  const normalized = canonicalize(alias);
  if (!normalized) return false;
  if (/\p{Script=Han}/u.test(normalized)) return text.includes(normalized);
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![${WORD}])${escaped}(?![${WORD}])`, "u").test(text);
}

function isAmbiguousLiteral(text: string): boolean {
  return includesAlias(text, "conflict") || includesAlias(text, "SEM");
}

/** Constructs a selected local sense with explicit provenance and version. */
export function selectedSenseConcept(
  senseId: PeerLocalSenseId,
  options: Pick<SelectedSenseConcept, "context" | "matchRequirement"> = {},
): SelectedSenseConcept {
  const definition = bySenseId.get(senseId);
  if (!definition) throw new Error(`Unknown Peer local sense: ${senseId}`);
  return Object.freeze({
    conceptId: senseId,
    senseId,
    domain: definition.domain,
    vocabularyVersion: PEER_LOCAL_SENSE_CATALOG_VERSION,
    provenance: Object.freeze({
      source: "peer-authored" as const,
      release: PEER_LOCAL_SENSE_CATALOG_VERSION,
      mappingVersion: PEER_LOCAL_SENSE_CATALOG_VERSION,
    }),
    ...(options.context ? { context: options.context } : {}),
    ...(options.matchRequirement ? { matchRequirement: options.matchRequirement } : {}),
  });
}

/**
 * Returns one bounded, non-context-required exact canonical phrase for each
 * explicitly selected Peer-authored sense. Query planning must never turn an
 * ambiguous short form, a close alias, or another domain's phrase into a
 * retrieval query.
 */
export function exactCanonicalSenseQueries(
  selected: readonly SelectedSenseConcept[],
): string[] {
  const seen = new Set<string>();
  return selected.flatMap((concept) => {
    const alias = bySenseId.get(concept.senseId)?.aliases.find(
      (candidate) => candidate.relation === "exact" && !candidate.requiresContext,
    );
    const query = alias ? canonicalize(alias.value) : "";
    if (!query || seen.has(query)) return [];
    seen.add(query);
    return [query];
  });
}

/** Retains an old local version for identity, but never resolves it as current. */
export function parseSelectedSenseConcept(value: unknown): SelectedSenseConcept | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const definition = typeof input.senseId === "string" ? bySenseId.get(input.senseId as PeerLocalSenseId) : undefined;
  const provenance = input.provenance as Record<string, unknown> | undefined;
  if (
    !definition ||
    input.conceptId !== definition.senseId ||
    input.domain !== definition.domain ||
    typeof input.vocabularyVersion !== "string" ||
    !/^peer-local-senses-v\d+$/u.test(input.vocabularyVersion) ||
    !provenance || provenance.source !== "peer-authored" ||
    typeof provenance.release !== "string" || typeof provenance.mappingVersion !== "string"
  ) return undefined;
  const context = typeof input.context === "string" && input.context.trim()
    ? input.context.trim().replace(/\s+/g, " ")
    : undefined;
  const matchRequirement = input.matchRequirement === "exact-or-close" ? "exact-or-close" : "exact";
  return Object.freeze({
    conceptId: definition.senseId,
    senseId: definition.senseId,
    domain: definition.domain,
    vocabularyVersion: input.vocabularyVersion,
    provenance: Object.freeze({
      source: "peer-authored" as const,
      release: provenance.release,
      mappingVersion: provenance.mappingVersion,
    }),
    ...(context ? { context } : {}),
    ...(matchRequirement === "exact-or-close" ? { matchRequirement } : {}),
  });
}

export interface SenseEvidence {
  readonly kind: SenseEvidenceKind;
  readonly senseId: PeerLocalSenseId;
  readonly alias?: string;
  readonly language?: "en" | "zh";
  readonly relation?: SenseAliasRelation;
  readonly satisfiesExact: boolean;
  readonly vocabularyVersion: string;
}

/**
 * Resolves only against an already selected sense. A shared spelling does not
 * select a sense, and a stale local mapping stays uncertain rather than being
 * silently upgraded to today's aliases.
 */
export function resolveSenseEvidence(
  selected: SelectedSenseConcept,
  candidateText: string,
  candidateContext?: string,
): SenseEvidence {
  const definition = bySenseId.get(selected.senseId);
  const text = canonicalize(`${candidateText} ${candidateContext ?? ""}`);
  const base = { senseId: selected.senseId, vocabularyVersion: selected.vocabularyVersion } as const;
  if (!definition || selected.vocabularyVersion !== PEER_LOCAL_SENSE_CATALOG_VERSION) {
    return { kind: "contextInsufficient", satisfiesExact: false, ...base };
  }
  const matching = definition.aliases
    .filter((alias) =>
      includesAlias(text, alias.value) &&
      (!alias.requiresContext || alias.contextMarkers?.some((marker) => includesAlias(text, marker))),
    )
    .sort((left, right) => canonicalize(right.value).length - canonicalize(left.value).length)[0];
  if (matching) {
    const kind = matching.relation === "exact" ? "exactAlias" : "closeAlias";
    return {
      kind,
      alias: matching.value,
      language: matching.language,
      relation: matching.relation,
      satisfiesExact: matching.relation === "exact",
      ...base,
    };
  }
  const hasOtherSense = LOCAL_SENSES.some((sense) =>
    sense.senseId !== selected.senseId && sense.aliases.some((alias) => includesAlias(text, alias.value) && !alias.requiresContext),
  );
  if (hasOtherSense) return { kind: "conflict", satisfiesExact: false, ...base };
  return {
    kind: isAmbiguousLiteral(text) ? "contextInsufficient" : "contextInsufficient",
    satisfiesExact: false,
    ...base,
  };
}
