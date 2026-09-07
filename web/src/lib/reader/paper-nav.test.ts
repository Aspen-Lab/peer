import { describe, expect, it } from "vitest";
import { NONE } from "@/lib/navigation/card-focus";
import { paperNav } from "./paper-nav";

const ids = ["arxiv:1", "arxiv:2", "openalex:W3"];

describe("paperNav", () => {
  it("steps both ways from the middle", () => {
    expect(paperNav(ids, "arxiv:2")).toEqual({
      index: 1,
      total: 3,
      prevId: "arxiv:1",
      nextId: "openalex:W3",
    });
  });

  it("has no previous on the first paper", () => {
    expect(paperNav(ids, "arxiv:1")).toEqual({
      index: 0,
      total: 3,
      prevId: null,
      nextId: "arxiv:2",
    });
  });

  it("has no next on the last paper", () => {
    expect(paperNav(ids, "openalex:W3")).toEqual({
      index: 2,
      total: 3,
      prevId: "arxiv:2",
      nextId: null,
    });
  });

  it("is a deep link when the id is not in the briefing", () => {
    // Nothing to step to; the rail shows no position. `total` still reports
    // the briefing's size so a caller can tell an empty store from an
    // unknown id.
    expect(paperNav(ids, "arxiv:9")).toEqual({
      index: NONE,
      total: 3,
      prevId: null,
      nextId: null,
    });
    expect(paperNav([], "arxiv:1")).toEqual({
      index: NONE,
      total: 0,
      prevId: null,
      nextId: null,
    });
  });

  it("stands alone in a one-paper briefing", () => {
    expect(paperNav(["arxiv:1"], "arxiv:1")).toEqual({
      index: 0,
      total: 1,
      prevId: null,
      nextId: null,
    });
  });
});
