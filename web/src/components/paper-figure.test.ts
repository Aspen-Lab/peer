import { describe, expect, it } from "vitest";
import { buildFigureRequestKey } from "./paper-figure";

// 9-15 (A9-10): `buildFigureRequestKey` is a pure extraction of the
// in-flight/settled map key so it can be unit-tested without rendering the
// hook (this project's Vitest config runs in a plain Node environment, no
// DOM). The load-bearing behavior: an optional `revision` (9-12), when
// present, must change the key — otherwise a delete-then-re-upload of the
// identical bytes (the same `itemId` hash16, a fresh lifecycle instance)
// could join an in-flight request or read a settled result left over from
// the asset's previous instance.
describe("buildFigureRequestKey", () => {
  it("is unchanged for a caller that never passes a revision (the vast majority of callers)", () => {
    const withoutField = buildFigureRequestKey({ itemId: "arxiv:2607.00001" });
    const withUndefined = buildFigureRequestKey({ itemId: "arxiv:2607.00001", revision: undefined });
    expect(withoutField).toBe(withUndefined);
  });

  it("differs when the revision differs, even with an otherwise identical itemId", () => {
    const keyRev1 = buildFigureRequestKey({ itemId: "upload:0123456789abcdef", revision: 1 });
    const keyRev2 = buildFigureRequestKey({ itemId: "upload:0123456789abcdef", revision: 2 });
    expect(keyRev1).not.toBe(keyRev2);
  });

  it("still differs on itemId / url / doi / query / paperTitle / figureIndex as before", () => {
    const base = buildFigureRequestKey({ itemId: "a", url: "u", doi: "d", query: "q", paperTitle: "t", figureIndex: 1 });
    expect(base).not.toBe(buildFigureRequestKey({ itemId: "b", url: "u", doi: "d", query: "q", paperTitle: "t", figureIndex: 1 }));
    expect(base).not.toBe(buildFigureRequestKey({ itemId: "a", url: "v", doi: "d", query: "q", paperTitle: "t", figureIndex: 1 }));
    expect(base).not.toBe(buildFigureRequestKey({ itemId: "a", url: "u", doi: "e", query: "q", paperTitle: "t", figureIndex: 1 }));
    expect(base).not.toBe(buildFigureRequestKey({ itemId: "a", url: "u", doi: "d", query: "r", paperTitle: "t", figureIndex: 1 }));
    expect(base).not.toBe(buildFigureRequestKey({ itemId: "a", url: "u", doi: "d", query: "q", paperTitle: "s", figureIndex: 1 }));
    expect(base).not.toBe(buildFigureRequestKey({ itemId: "a", url: "u", doi: "d", query: "q", paperTitle: "t", figureIndex: 2 }));
  });
});
