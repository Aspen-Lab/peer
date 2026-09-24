import { describe, expect, it } from "vitest";
import {
  PEER_LOCAL_SENSE_CATALOG_VERSION,
  resolveSenseEvidence,
  selectedSenseConcept,
} from "./senses";

describe("Peer-authored finite sense resolver", () => {
  const hr = selectedSenseConcept("hr.role_conflict");
  const materials = selectedSenseConcept("materials.scanning_electron_microscopy");
  const statistics = selectedSenseConcept("statistics.structural_equation_modeling");

  it("admits only deliberately bound English and Chinese HR aliases", () => {
    expect(resolveSenseEvidence(hr, "Role conflict among employees")).toMatchObject({
      kind: "exactAlias",
      alias: "role conflict",
      language: "en",
    });
    expect(resolveSenseEvidence(hr, "员工角色冲突：组织行为研究")).toMatchObject({
      kind: "exactAlias",
      alias: "员工角色冲突",
      language: "zh",
    });
  });

  it("does not treat conflict-of-interest or software boilerplate as HR role conflict", () => {
    expect(resolveSenseEvidence(hr, "The authors declare no conflict of interest")).toMatchObject({
      kind: "conflict",
    });
    expect(resolveSenseEvidence(hr, "Resolve the dependency conflict in npm")).toMatchObject({
      kind: "conflict",
    });
    expect(resolveSenseEvidence(hr, "利益冲突声明")).toMatchObject({ kind: "conflict" });
    expect(resolveSenseEvidence(hr, "依赖冲突修复")).toMatchObject({ kind: "conflict" });
  });

  it("keeps plain ambiguous conflict and SEM uncertain without a bound context", () => {
    expect(resolveSenseEvidence(hr, "Conflict and performance")).toMatchObject({
      kind: "contextInsufficient",
    });
    expect(resolveSenseEvidence(materials, "SEM results")).toMatchObject({
      kind: "contextInsufficient",
    });
    expect(resolveSenseEvidence(statistics, "SEM results")).toMatchObject({
      kind: "contextInsufficient",
    });
  });

  it("separates statistical and materials SEM with Unicode/CJK punctuation normalization", () => {
    expect(resolveSenseEvidence(materials, "Scanning-electron microscopy（SEM）images")).toMatchObject({
      kind: "exactAlias",
      senseId: "materials.scanning_electron_microscopy",
    });
    expect(resolveSenseEvidence(statistics, "Structural equation modeling（SEM）results")).toMatchObject({
      kind: "exactAlias",
      senseId: "statistics.structural_equation_modeling",
    });
    expect(resolveSenseEvidence(materials, "Structural equation modeling（SEM）results")).toMatchObject({
      kind: "conflict",
    });
    expect(resolveSenseEvidence(statistics, "Scanning electron microscopy (SEM) images")).toMatchObject({
      kind: "conflict",
    });
  });

  it("preserves provenance/version and does not let close fulfill exact", () => {
    const close = resolveSenseEvidence(hr, "Inter-role conflict at work");
    expect(close).toMatchObject({ kind: "closeAlias", relation: "close" });
    expect(close.satisfiesExact).toBe(false);
    expect(hr.vocabularyVersion).toBe(PEER_LOCAL_SENSE_CATALOG_VERSION);
    expect(hr.provenance).toMatchObject({ source: "peer-authored" });
  });
});
