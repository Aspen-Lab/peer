import { describe, expect, it } from "vitest";
import { block } from "@/lib/notes/blocks";
import { reconcileWindow, mergeBlocks } from "./notes-window";

// P10-29 (BACKLOG-71): the window's unsaved blocks and an outside change to the same block, together — the words each side
// added stay; only a rewrite of the same words is the outside one's (written last), and the window's editor then restarts
// on the merge, so it shows the newer text before the next keystroke.

describe("mergeBlocks — the same block edited in the window and from outside (P10-29)", () => {
  const a = block("text", "alpha beta");
  const b = block("text", "gamma");

  it("keeps the window's words and the sticky's words when they changed different places of one block", () => {
    const merged = mergeBlocks([a, b], [{ ...a, text: "ALPHA beta" }, b], [{ ...a, text: "alpha BETA" }, b]);
    expect(merged.map((x) => x.text)).toEqual(["ALPHA BETA", "gamma"]);
  });

  it("keeps both when each added words at the end of the same block", () => {
    const merged = mergeBlocks([a], [{ ...a, text: "alpha beta window" }], [{ ...a, text: "alpha beta sticky" }]);
    expect(merged.map((x) => x.text)).toEqual(["alpha beta sticky window"]);
  });

  it("a rewrite of the same words is the outside one's; the block beside it keeps the window's edit", () => {
    const merged = mergeBlocks([a, b], [{ ...a, text: "mine" }, { ...b, text: "gamma, window" }], [{ ...a, text: "theirs" }, b]);
    expect(merged.map((x) => x.text)).toEqual(["theirs", "gamma, window"]);
  });

  it("keeps the window's kind of block when the outside changed only the words", () => {
    const merged = mergeBlocks([a], [{ ...a, type: "h2" }], [{ ...a, text: "alpha beta, sticky" }]);
    expect(merged).toEqual([{ ...a, type: "h2", text: "alpha beta, sticky" }]);
  });

  it("reconcileWindow merges it rather than restarting on the outside's block alone", () => {
    const v = reconcileWindow([a], [{ ...a, text: "ALPHA beta" }], [{ ...a, text: "alpha BETA" }]);
    expect(v.kind).toBe("merge");
    expect(v.kind === "merge" && v.blocks.map((x) => x.text)).toEqual(["ALPHA BETA"]);
  });
});
