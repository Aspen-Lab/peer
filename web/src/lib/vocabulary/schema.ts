import type { VocabularySourceId } from "./catalog";

export const VOCABULARY_RECORD_SCHEMA = "peer-vocabulary-record-v1" as const;

export type MappingRelation = "exact" | "close" | "related";

export interface MappingProvenance {
  relation: MappingRelation;
  targetSourceId: VocabularySourceId;
  targetId: string;
  // P1-03 F-A-03C (Round 3, POLICY-1 approved): the exact release of the
  // *target* source this mapping was verified against. A cross-source
  // mapping recorded today can silently go wrong if the target source
  // republishes with different term IDs; this pins which target release the
  // mapping rests on. Required and fail-closed, validated the same way
  // `VocabularyRecord.releaseId` already is (non-empty after trim).
  targetReleaseId: string;
  evidence: string;
}

export interface VocabularyRecord {
  sourceId: VocabularySourceId;
  sourceUri: string;
  releaseId: string;
  licenseName: string;
  licenseUrl: string;
  attribution: string;
  modified: boolean;
  description: string;
  assetPath: string;
  sha256: string;
  format: "json" | "jsonl" | "csv" | "tsv" | "rdf";
  schema: typeof VOCABULARY_RECORD_SCHEMA;
  importedAt: string;
  mappingProvenance: MappingProvenance[];
}

export interface VocabularyManifest {
  records: VocabularyRecord[];
}
