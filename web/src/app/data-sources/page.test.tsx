import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { listApprovedProductionVocabularyRecords } from "@/lib/vocabulary/production";
import DataSourcesPage, { DataSourcesPageContent } from "./page";

describe("DataSourcesPage", () => {
  it("renders only verifier-approved production records", () => {
    const html = renderToStaticMarkup(createElement(DataSourcesPageContent, {
      records: [{
        sourceId: "openalex",
        sourceUri: "https://example.invalid/approved",
        releaseId: "APPROVED-TEST-RELEASE",
        licenseName: "CC0-1.0",
        licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
        attribution: "Approved test attribution",
        modified: false,
        description: "Approved test-only record",
        assetPath: "assets/approved.json",
        sha256: "a".repeat(64),
        format: "json",
        schema: "peer-vocabulary-record-v1",
        importedAt: "2026-09-23T00:00:00.000Z",
        mappingProvenance: [],
      }],
    }));
    expect(html).toContain("APPROVED-TEST-RELEASE");
    expect(html).not.toContain("unverified fixture");
  });

  it("is honest when the production manifest has no approved records", () => {
    const html = renderToStaticMarkup(createElement(DataSourcesPageContent, { records: [] }));
    expect(html).toContain("No reviewed vocabulary assets are installed yet");
  });

  // P1-03 F-A-03A (Round 3): the heading must be a human-readable display
  // name, not the raw machine source ID. "thesoz" is an opaque abbreviation
  // a reader cannot recognize.
  it("renders a human display name in the heading, not the raw machine source ID", () => {
    const html = renderToStaticMarkup(createElement(DataSourcesPageContent, {
      records: [{
        sourceId: "thesoz",
        sourceUri: "https://example.invalid/display-name-probe",
        releaseId: "DISPLAY-NAME-TEST-RELEASE",
        licenseName: "CC-BY-4.0",
        licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
        attribution: "Test-only display-name attribution",
        modified: false,
        description: "Test-only display-name record",
        assetPath: "assets/display-name.json",
        sha256: "b".repeat(64),
        format: "json",
        schema: "peer-vocabulary-record-v1",
        importedAt: "2026-09-23T00:00:00.000Z",
        mappingProvenance: [],
      }],
    }));
    expect(html).not.toMatch(/<h2[^>]*>thesoz<\/h2>/);
    expect(html).toContain("TheSoz — Thesaurus for the Social Sciences");
  });

  // P1-03 F-A-03B (Round 3): sourceUri is required and HTTPS-validated by the
  // verifier specifically for transparency/provenance, but page.tsx never
  // rendered it. Both off-site anchors (sourceUri and the pre-existing
  // licenseUrl) must carry rel="noopener noreferrer" and target="_blank".
  it("links the record's sourceUri, and both off-site links carry rel/target", () => {
    const html = renderToStaticMarkup(createElement(DataSourcesPageContent, {
      records: [{
        sourceId: "openalex",
        sourceUri: "https://example.invalid/source-b-probe",
        releaseId: "SOURCE-URI-TEST-RELEASE",
        licenseName: "CC0-1.0",
        licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
        attribution: "Test-only source-uri attribution",
        modified: false,
        description: "Test-only source-uri record",
        assetPath: "assets/source-uri.json",
        sha256: "c".repeat(64),
        format: "json",
        schema: "peer-vocabulary-record-v1",
        importedAt: "2026-09-23T00:00:00.000Z",
        mappingProvenance: [],
      }],
    }));
    expect(html).toContain('<a href="https://example.invalid/source-b-probe" rel="noopener noreferrer" target="_blank"');
    expect(html).toMatch(/<a[^>]*href="https:\/\/creativecommons\.org\/publicdomain\/zero\/1\.0\/"[^>]*rel="noopener noreferrer"[^>]*target="_blank"/);
  });
});

// P1-03 F-A-03D (Round 3): the tests above only ever exercise the
// presentational component in isolation. Nothing in this file previously
// rendered the real `DataSourcesPage` composition
// (DataSourcesPage -> listApprovedProductionVocabularyRecords ->
// verifyVocabularyManifest), so a regression in either the production loader
// or the verifier gate would go undetected.
describe("DataSourcesPage production composition", () => {
  it("is honest when the default page export renders against the real, empty production manifest", async () => {
    // Coverage-only: this passes today, before any production-code change,
    // because the real production manifest.json is genuinely {"records":[]}
    // and the honest empty-state branch already exists and is already
    // correct. This test only locks that behaviour in against regression;
    // it is not a failing-before/red case.
    const element = await DataSourcesPage();
    const html = renderToStaticMarkup(element);
    expect(html).toContain("No reviewed vocabulary assets are installed yet");
    expect(html).not.toContain("License:");
    expect(html).not.toContain("Modified locally");
  });

  it("lists only the verifier-approved record when given an invented production root", async () => {
    const root = await mkdtemp(join(tmpdir(), "peer-data-sources-page-test-"));
    await mkdir(join(root, "assets"), { recursive: true });

    const validAsset = "test-only production-loader fixture asset\n";
    const validSha256 = createHash("sha256").update(validAsset).digest("hex");
    await writeFile(join(root, "assets", "valid.json"), validAsset);

    const validRecord = {
      sourceId: "openalex",
      sourceUri: "https://example.invalid/production-loader-valid",
      releaseId: "PRODUCTION-LOADER-TEST-VALID",
      licenseName: "CC0-1.0",
      licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      attribution: "Test-only production-loader attribution; not an imported vocabulary.",
      modified: false,
      description: "Invented production-loader test fixture; not a real vocabulary asset.",
      assetPath: "assets/valid.json",
      sha256: validSha256,
      format: "json",
      schema: "peer-vocabulary-record-v1",
      importedAt: "2026-09-23T00:00:00.000Z",
      mappingProvenance: [],
    };
    const invalidRecord = {
      ...validRecord,
      releaseId: "",
      description: "REJECTED-PRODUCTION-LOADER-FIXTURE-SHOULD-NEVER-RENDER",
    };

    await writeFile(
      join(root, "assets", "manifest.json"),
      JSON.stringify({ records: [validRecord, invalidRecord] }),
    );

    const result = await listApprovedProductionVocabularyRecords(root);
    expect(result).toHaveLength(1);
    expect(result[0]?.releaseId).toBe("PRODUCTION-LOADER-TEST-VALID");

    const html = renderToStaticMarkup(createElement(DataSourcesPageContent, { records: result }));
    expect(html).toContain("PRODUCTION-LOADER-TEST-VALID");
    expect(html).not.toContain("REJECTED-PRODUCTION-LOADER-FIXTURE-SHOULD-NEVER-RENDER");
  });
});
