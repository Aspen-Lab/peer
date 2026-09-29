import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALLOWED_VOCABULARY_SOURCE_IDS } from "./catalog";
import { verifyVocabularyManifest } from "./verifier";

const fictionalAsset = "test-only fictional vocabulary fixture\n";
const fictionalSha256 = createHash("sha256").update(fictionalAsset).digest("hex");

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "peer-vocabulary-"));
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "assets", "fictional.json"), fictionalAsset);
  return root;
}

function fictionalRecord(sourceId = "openalex") {
  return {
    sourceId,
    sourceUri: "https://example.invalid/test-only-source",
    releaseId: "TEST-ONLY-2026-09-23",
    licenseName: sourceId === "openalex" ? "CC0-1.0" : "CC-BY-4.0",
    licenseUrl: sourceId === "openalex"
      ? "https://creativecommons.org/publicdomain/zero/1.0/"
      : "https://creativecommons.org/licenses/by/4.0/",
    attribution: "Test-only fictional attribution; not an imported vocabulary.",
    modified: true,
    description: "A tiny invented test fixture; it contains no third-party vocabulary text.",
    assetPath: "assets/fictional.json",
    sha256: fictionalSha256,
    format: "json",
    schema: "peer-vocabulary-record-v1",
    importedAt: "2026-09-23T00:00:00.000Z",
    mappingProvenance: [{ relation: "exact", targetSourceId: "openalex", targetId: "test-only-target", targetReleaseId: "TARGET-TEST-RELEASE", evidence: "locally-authored-test-fixture" }],
  };
}

describe("safe offline vocabulary verifier", () => {
  it("limits the catalog to exactly the three approved source IDs", () => {
    expect(ALLOWED_VOCABULARY_SOURCE_IDS).toEqual(["openalex", "thesoz", "stw"]);
  });

  it("approves only a complete fictional record with matching asset checksum", async () => {
    const root = await fixtureRoot();
    expect(await verifyVocabularyManifest({ records: [fictionalRecord()] }, root)).toEqual({
      approved: [fictionalRecord()],
      rejected: [],
    });
  });

  it.each([
    ["APA is excluded", fictionalRecord("apa")],
    ["unknown sources are excluded", fictionalRecord("unknown")],
    ["source-specific licenses must match", { ...fictionalRecord("stw"), licenseName: "CC0-1.0" }],
    ["absolute asset paths are rejected", { ...fictionalRecord(), assetPath: "C:/outside.json" }],
    ["traversal paths are rejected", { ...fictionalRecord(), assetPath: "../outside.json" }],
    ["missing assets are rejected", { ...fictionalRecord(), assetPath: "assets/missing.json" }],
    ["checksum mismatches are rejected", { ...fictionalRecord(), sha256: "0".repeat(64) }],
    ["missing provenance is rejected", { ...fictionalRecord(), sourceUri: "" }],
    ["missing release ID is rejected", { ...fictionalRecord(), releaseId: "" }],
    ["missing license identity is rejected", { ...fictionalRecord(), licenseUrl: "" }],
    ["missing attribution is rejected", { ...fictionalRecord(), attribution: "" }],
    ["missing modification statement is rejected", { ...fictionalRecord(), modified: undefined }],
    ["missing description is rejected", { ...fictionalRecord(), description: "" }],
    ["missing format is rejected", { ...fictionalRecord(), format: "" }],
    ["missing schema is rejected", { ...fictionalRecord(), schema: "" }],
    ["missing import timestamp is rejected", { ...fictionalRecord(), importedAt: "" }],
    ["derived mappings need provenance", { ...fictionalRecord(), mappingProvenance: [{ relation: "exact" }] }],
    // P1-03 F-A-03C (Round 3): a cross-source mapping recorded today could
    // silently become wrong if the *target* source republishes with
    // different term IDs; nothing previously pinned which target release the
    // mapping was verified against. This case uses the mapping's old shape
    // explicitly (relation/targetSourceId/targetId/evidence, no
    // targetReleaseId) regardless of what fictionalRecord()'s own default
    // mapping later becomes.
    ["derived mappings need a target release ID", { ...fictionalRecord(), mappingProvenance: [{ relation: "exact", targetSourceId: "openalex", targetId: "test-only-target", evidence: "locally-authored-test-fixture" }] }],
  ])("%s", async (_name, record) => {
    const root = await fixtureRoot();
    const result = await verifyVocabularyManifest({ records: [record] }, root);
    expect(result.approved).toEqual([]);
    expect(result.rejected).toHaveLength(1);
  });
});
