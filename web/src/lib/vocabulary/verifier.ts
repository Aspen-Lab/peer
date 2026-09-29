import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { vocabularySourcePolicy } from "./catalog";
import { VOCABULARY_RECORD_SCHEMA, type VocabularyManifest, type VocabularyRecord } from "./schema";

export interface RejectedVocabularyRecord {
  record: unknown;
  reason: string;
}

export interface VocabularyVerification {
  approved: VocabularyRecord[];
  rejected: RejectedVocabularyRecord[];
}

const FORMATS = new Set(["json", "jsonl", "csv", "tsv", "rdf"]);
const SHA256 = /^[a-f0-9]{64}$/;

function escapesRoot(path: string): boolean {
  return path === "" || path === ".." || path.startsWith("../") || path.startsWith("..\\") || isAbsolute(path);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function httpsUrl(value: unknown): value is string {
  if (!nonEmpty(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function recordError(record: unknown): string | undefined {
  if (!record || typeof record !== "object") return "record must be an object";
  const candidate = record as Record<string, unknown>;
  const policy = vocabularySourcePolicy(candidate.sourceId);
  if (!policy) return "source is not allowlisted";
  if (!httpsUrl(candidate.sourceUri)) return "sourceUri must be an HTTPS URL";
  if (!nonEmpty(candidate.releaseId)) return "releaseId is required";
  if (candidate.licenseName !== policy.licenseName || candidate.licenseUrl !== policy.licenseUrl) {
    return "license identity does not match this source";
  }
  if (!nonEmpty(candidate.attribution)) return "attribution is required";
  if (typeof candidate.modified !== "boolean") return "modified must be explicit";
  if (!nonEmpty(candidate.description)) return "description is required";
  if (!nonEmpty(candidate.assetPath) || isAbsolute(candidate.assetPath)) return "assetPath must be relative";
  if (!nonEmpty(candidate.sha256) || !SHA256.test(candidate.sha256)) return "sha256 must be lowercase SHA-256";
  if (!FORMATS.has(candidate.format as string)) return "format is not supported";
  if (candidate.schema !== VOCABULARY_RECORD_SCHEMA) return "schema is not supported";
  if (!nonEmpty(candidate.importedAt) || Number.isNaN(Date.parse(candidate.importedAt))) return "importedAt must be an ISO timestamp";
  if (!Array.isArray(candidate.mappingProvenance)) return "mappingProvenance is required";
  for (const mapping of candidate.mappingProvenance) {
    if (!mapping || typeof mapping !== "object") return "mapping provenance is invalid";
    const item = mapping as Record<string, unknown>;
    if (!(["exact", "close", "related"] as const).includes(item.relation as never)
      || !vocabularySourcePolicy(item.targetSourceId)
      || !nonEmpty(item.targetId)
      || !nonEmpty(item.targetReleaseId)
      || !nonEmpty(item.evidence)) return "mapping provenance is incomplete";
  }
  return undefined;
}

async function assetError(record: VocabularyRecord, root: string): Promise<string | undefined> {
  const candidatePath = resolve(root, record.assetPath);
  const lexical = relative(root, candidatePath);
  if (escapesRoot(lexical)) {
    return "assetPath escapes the vocabulary root";
  }
  try {
    const [realRoot, realAsset] = await Promise.all([realpath(root), realpath(candidatePath)]);
    const contained = relative(realRoot, realAsset);
    if (escapesRoot(contained)) {
      return "assetPath escapes the vocabulary root";
    }
    const actual = createHash("sha256").update(await readFile(realAsset)).digest("hex");
    return actual === record.sha256 ? undefined : "asset checksum mismatch";
  } catch {
    return "asset is missing or unreadable";
  }
}

/**
 * Fail closed: malformed records, unknown sources, unsafe paths, missing
 * assets, and checksum mismatches never reach an attribution surface.
 */
export async function verifyVocabularyManifest(manifest: unknown, root: string): Promise<VocabularyVerification> {
  if (!manifest || typeof manifest !== "object" || !Array.isArray((manifest as VocabularyManifest).records)) {
    return { approved: [], rejected: [{ record: manifest, reason: "manifest.records must be an array" }] };
  }
  const approved: VocabularyRecord[] = [];
  const rejected: RejectedVocabularyRecord[] = [];
  for (const record of (manifest as VocabularyManifest).records) {
    const error = recordError(record);
    if (error) {
      rejected.push({ record, reason: error });
      continue;
    }
    const assetFailure = await assetError(record, root);
    if (assetFailure) rejected.push({ record, reason: assetFailure });
    else approved.push(record);
  }
  return { approved, rejected };
}
