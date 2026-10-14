import { beforeEach, describe, expect, it } from "vitest";
import { anchorMap } from "@/lib/notes/blocks";
import { locatePassage, repairAnchors, resolveAnchors, useLostPassages, useNotesStore } from "./notes";

// P10-35 (BACKLOG-91; ruling §1h.101): a saved note's anchor is positional (`paper-section-<i>-p<j>`) with `start` / `end` and
// its `quote`. When a re-read splits a paragraph or adds one, the paragraph under the id holds other words: the note must
// find its passage again by its quote (the same section's paragraphs nearest first, then the whole body), be repaired once,
// and draw nothing on words that are not its own. Every text is invented.

const PAPER = { id: "p1", title: "A Paper", authors: ["Ann Lee"], publishedDate: "2024", abstract: "It tests mulch." };
const id = (s: number, p: number) => `paper-section-${s}-p${p}`;
const A = "Creep limits the life of hot parts in service.";
const B = "Grain boundaries carry the strain when the load is held.";
const C = "The finest grains crept fastest when annealed at the lowest temperature.";
const QUOTE = "finest grains crept fastest";
const body = (...sections: string[][]) => sections.map((paragraphs) => ({ paragraphs }));

/** A note with one sticky on `quote` in paragraph `at` of the old body; its header id. */
function sticky(oldBody: { paragraphs: string[] }[], at: [number, number], quote = QUOTE): string {
  const { ensureReadingNote, addSticky } = useNotesStore.getState();
  const noteId = ensureReadingNote(PAPER);
  const made = addSticky(noteId, { paperId: "p1", paragraphId: id(...at), passage: quote, paragraphText: oldBody[at[0]].paragraphs[at[1]] });
  return made!.id;
}
const mapNow = () => anchorMap(useNotesStore.getState().notes[Object.keys(useNotesStore.getState().notes)[0]], "p1");
const anchorOf = (headerId: string) => {
  const note = Object.values(useNotesStore.getState().notes)[0];
  return note.blocks.find((b) => b.id === headerId)!.anchor!;
};

beforeEach(() => {
  useNotesStore.setState({ notes: {} });
  useLostPassages.setState({ lost: {} });
});

describe("locatePassage — from", () => {
  it("finds the next occurrence from a position, and the first one by default", () => {
    const text = "grain size and grain size again";
    expect(locatePassage(text, "grain size")).toEqual({ start: 0, end: 10 });
    expect(locatePassage(text, "grain size", 1)).toEqual({ start: 15, end: 25 });
    expect(locatePassage(text, "grain size", 16)).toBeNull();
  });
});

describe("resolveAnchors — an anchor whose words still stand is left alone, with no search (P10-35 rule 3)", () => {
  /** An array that throws on every read except the listed indexes. */
  const onlyReads = (items: string[], ...allowed: number[]) =>
    new Proxy(items, {
      get(target, key) {
        if (typeof key === "string" && /^\d+$/.test(key) && !allowed.includes(Number(key))) throw new Error(`paragraph ${key} was read`);
        return Reflect.get(target, key);
      },
    });

  it("returns the anchor as it is and reads no paragraph but its own", () => {
    sticky(body([A], [A, B, C]), [1, 2]);
    const next = [{ paragraphs: onlyReads([A]) }, { paragraphs: onlyReads([A, B, C], 2) }];
    const result = resolveAnchors(next, mapNow());
    expect(result.fixes).toEqual([]);
    expect(result.lost).toEqual([]);
    expect(result.map[id(1, 2)]).toEqual(mapNow()[id(1, 2)]);
  });
});

describe("resolveAnchors — the paragraphs moved (P10-35 rule 2)", () => {
  it("finds the passage again when a paragraph above it was split in two, and repairs the anchor", () => {
    const old = body([A, B, C]);
    const header = sticky(old, [0, 2]);
    const split = body([A.slice(0, 20), A.slice(20), B, C]);
    const { map, fixes, lost } = resolveAnchors(split, mapNow());
    const start = C.indexOf(QUOTE);
    expect(lost).toEqual([]);
    expect(map[id(0, 2)]).toBeUndefined();
    expect(map[id(0, 3)]).toEqual([{ id: header, n: 1, start, end: start + QUOTE.length, quote: QUOTE }]);
    expect(fixes).toEqual([
      { id: header, was: { paragraphId: id(0, 2), start, end: start + QUOTE.length }, paragraphId: id(0, 3), start, end: start + QUOTE.length },
    ]);
  });

  it("finds it when the section gains a paragraph before it, and when a section is added before the section", () => {
    const old = body([A], [B, C]);
    const header = sticky(old, [1, 1]);
    const gained = resolveAnchors(body([A], [A, B, C]), mapNow());
    expect(gained.map[id(1, 2)]?.[0].id).toBe(header);
    const added = resolveAnchors(body([A], [A], [B, C]), mapNow());
    expect(added.map[id(2, 1)]?.[0].id).toBe(header);
    expect(added.lost).toEqual([]);
  });

  it("searches the same section first, nearest paragraph first, before the whole body", () => {
    const old = body([A, B, C]);
    sticky(old, [0, 2]);
    // a copy of the words stands in the section far from the old place, another in an earlier section
    const next = body([C], [A, B, C, A, A, A, C]);
    // the anchor's section is 0: the same section's paragraphs are [C] alone
    const { map } = resolveAnchors(next, mapNow());
    expect(Object.keys(map)).toEqual([id(0, 0)]);
  });

  it("takes the nearest to the old position when the quote stands more than once", () => {
    const old = body([A, B, A, C, B]);
    const header = sticky(old, [0, 3]);
    const next = body([C, A, B, A, B, C, B]);
    const { fixes } = resolveAnchors(next, mapNow());
    // the old place was paragraph 3: copies at 0 and 5; 5 is two away, 0 is three
    expect(fixes.map((f) => [f.id, f.paragraphId])).toEqual([[header, id(0, 5)]]);
    const tie = resolveAnchors(body([C, A, B, A, C]), mapNow()).fixes;
    // copies at 0 and 4, the old place 3: 4 is one away
    expect(tie.map((f) => f.paragraphId)).toEqual([id(0, 4)]);
  });

  it("falls back to the whole body when the section no longer holds it, nearest section first", () => {
    const old = body([A], [B], [C], [A]);
    const header = sticky(old, [2, 0]);
    const next = body([C], [A, B], [A], [A], [C]);
    // section 2 holds no copy; sections 0 and 4 do, 2 away each: the earlier first
    const { fixes } = resolveAnchors(next, mapNow());
    expect(fixes.map((f) => [f.id, f.paragraphId])).toEqual([[header, id(0, 0)]]);
    const near = resolveAnchors(body([A], [B], [A], [C]), mapNow()).fixes;
    expect(near.map((f) => f.paragraphId)).toEqual([id(3, 0)]);
  });

  it("keeps a quote that the paragraph holds at another place in the same paragraph (the words moved inside it)", () => {
    const old = body([C]);
    sticky(old, [0, 0]);
    const next = body([`First, a new sentence opens it. ${C}`]);
    const { fixes, map } = resolveAnchors(next, mapNow());
    const start = next[0].paragraphs[0].indexOf(QUOTE);
    expect(fixes).toHaveLength(1);
    expect(map[id(0, 0)]?.[0]).toMatchObject({ start, end: start + QUOTE.length });
  });

  it("repairs two notes on their own words after the same split", () => {
    const old = body([A, B, C]);
    const one = sticky(old, [0, 2]);
    const two = sticky(old, [0, 1], "Grain boundaries carry");
    const { map } = resolveAnchors(body([A.slice(0, 20), A.slice(20), B, C]), mapNow());
    expect(map[id(0, 3)]?.map((s) => s.id)).toEqual([one]);
    expect(map[id(0, 2)]?.map((s) => s.id)).toEqual([two]);
    expect(map[id(0, 2)]?.[0].quote).toBe("Grain boundaries carry");
  });
});

describe("resolveAnchors — a passage the paper no longer holds (P10-35 rules 1 and 2)", () => {
  it("draws nothing for it and lists it as lost", () => {
    const old = body([A, B, C]);
    const header = sticky(old, [0, 2]);
    const next = body([A, B, "A different sentence stands here instead."]);
    const { map, fixes, lost } = resolveAnchors(next, mapNow());
    expect(map).toEqual({});
    expect(fixes).toEqual([]);
    expect(lost).toEqual([header]);
  });

  it("does not draw a mark on another paragraph's words that sit at the old offsets", () => {
    const old = body([A, B, C]);
    sticky(old, [0, 2]);
    const next = body([A, B, "Zzzzzzzzzz".repeat(10) + " other words entirely."]);
    expect(resolveAnchors(next, mapNow()).map).toEqual({});
  });

  it("leaves an anchor with no range as it was (its tag stands at its paragraph's end)", () => {
    const old = body([A, B, C]);
    const header = sticky(old, [0, 2], "words that cross two paragraphs");
    const result = resolveAnchors(body([A, A, B, C]), mapNow());
    expect(result.map[id(0, 2)]).toEqual([{ id: header, n: 1 }]);
    expect(result.fixes).toEqual([]);
    expect(result.lost).toEqual([]);
  });
});

describe("repairAnchors — written back once (P10-35 rules 2 and 3)", () => {
  it("writes the repaired paragraphId, start and end into the note's anchor, and nothing else", () => {
    const old = body([A, B, C]);
    const header = sticky(old, [0, 2]);
    const before = Object.values(useNotesStore.getState().notes)[0];
    const { fixes } = resolveAnchors(body([A.slice(0, 20), A.slice(20), B, C]), mapNow());
    repairAnchors(fixes);
    const after = Object.values(useNotesStore.getState().notes)[0];
    const start = C.indexOf(QUOTE);
    expect(anchorOf(header)).toEqual({ ...before.blocks.find((b) => b.id === header)!.anchor, paragraphId: id(0, 3), start, end: start + QUOTE.length });
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.blocks.filter((b) => b.id !== header)).toEqual(before.blocks.filter((b) => b.id !== header));
  });

  it("needs no search on the next load: the repaired anchor matches, and a second repair changes nothing", () => {
    const old = body([A, B, C]);
    sticky(old, [0, 2]);
    const next = body([A.slice(0, 20), A.slice(20), B, C]);
    repairAnchors(resolveAnchors(next, mapNow()).fixes);
    const stored = useNotesStore.getState().notes;
    const again = resolveAnchors(next, mapNow());
    expect(again.fixes).toEqual([]);
    repairAnchors(again.fixes);
    expect(useNotesStore.getState().notes).toBe(stored);
  });

  it("skips a repair whose anchor is no longer the one it was worked out from (written meanwhile)", () => {
    const old = body([A, B, C]);
    const header = sticky(old, [0, 2]);
    const { fixes } = resolveAnchors(body([A.slice(0, 20), A.slice(20), B, C]), mapNow());
    const note = Object.values(useNotesStore.getState().notes)[0];
    useNotesStore.getState().save(note.id, { blocks: note.blocks.map((b) => (b.id === header ? { ...b, anchor: { ...b.anchor!, paragraphId: id(0, 1) } } : b)) });
    const stored = useNotesStore.getState().notes;
    repairAnchors(fixes);
    expect(useNotesStore.getState().notes).toBe(stored);
    expect(anchorOf(header).paragraphId).toBe(id(0, 1));
  });
});

describe("useLostPassages — what a sticky says when its passage is not in this paper", () => {
  it("holds the lost sticky ids the body found, replacing the earlier ones", () => {
    useLostPassages.getState().setLost(["a", "b"]);
    expect(Object.keys(useLostPassages.getState().lost).sort()).toEqual(["a", "b"]);
    useLostPassages.getState().setLost(["b"]);
    expect(Object.keys(useLostPassages.getState().lost)).toEqual(["b"]);
  });
});
