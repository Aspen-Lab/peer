import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { tabId } from "@/components/reader/reader-tabs";
import { READER_TABS } from "@/components/reader/use-reader-tab";
import {
  HEIGHT_SLACK_PX,
  HOLD_MS,
  RETURN_KEY,
  SETTLE_MS,
  backTarget,
  decideRestore,
  dropPlace,
  leaseReturn,
  paragraphAtTop,
  peekPlace,
  readPlace,
  rememberPlace,
  restorePlace,
  restoreStep,
  tabOnShow,
  type PlaceDoc,
  type PlaceEnv,
  type PlaceRecord,
} from "./return-to-paper";

// P11-06 (the owner's item 3): after "Open your notes" on a paper, the notes page's top-left button reads
// "Back to paper" and goes back to the paper — on the tab the reader was on, at the place they left. The
// record of that place is `return-to-paper.ts`'s. The page cannot be mounted in this Node-only suite (no jsdom),
// so what it holds is tested as pure functions over a fake document, a fake storage and a fake clock; the
// page's one call is held to its join by reading its source (`page.return.test.ts`).

const PAPER = "openalex:W9";
const NOTE = "note-1";

/** A `sessionStorage` that can be inspected, or made to fail the way a blocked one does. */
function fakeStorage(initial: Record<string, string> = {}, broken = false) {
  const data = new Map(Object.entries(initial));
  const guard = () => {
    if (broken) throw new Error("storage blocked");
  };
  return {
    data,
    getItem: (key: string) => (guard(), data.get(key) ?? null),
    setItem: (key: string, value: string) => (guard(), void data.set(key, value)),
    removeItem: (key: string) => (guard(), void data.delete(key)),
  };
}

const paragraph = (id: string, top: number, bottom: number) => ({ id, getBoundingClientRect: () => ({ top, bottom }) });

/** A document with the tab strip on `tab` (none: a paper without a body has no strip), these paragraphs and this height. */
function fakeDoc({ tab, paragraphs = [], height = 9000 }: { tab?: "summary" | "digestion"; paragraphs?: ReturnType<typeof paragraph>[]; height?: number }): PlaceDoc {
  return {
    documentElement: { scrollHeight: height },
    getElementById: (id: string) => {
      const known = READER_TABS.find((name) => tabId(name) === id);
      if (!tab || !known) return null;
      return { getAttribute: (attr: string) => (attr === "aria-selected" ? String(known === tab) : null) };
    },
    querySelectorAll: () => paragraphs,
  };
}

const record = (over: Partial<PlaceRecord> = {}): PlaceRecord => ({
  paperId: PAPER,
  noteId: NOTE,
  tab: "digestion",
  scrollY: 3012,
  height: 9000,
  paragraphId: "paper-section-2-p3",
  paragraphTop: -20,
  ...over,
});

describe("what the press records (rule 1)", () => {
  it("is the paper, the note, the tab on show, the scroll, and the paragraph at the top of the view", () => {
    const doc = fakeDoc({
      tab: "digestion",
      paragraphs: [
        paragraph("paper-section-2-p2", -400, -30),
        paragraph("paper-section-2-p3", -20, 260),
        paragraph("paper-section-2-p4", 260, 500),
      ],
    });

    expect(readPlace({ scrollY: 3012 }, doc, { paperId: PAPER, noteId: NOTE })).toEqual(record());
  });

  it("reads the Summary tab as it is shown, with no paragraph (the Summary has none)", () => {
    const place = readPlace({ scrollY: 840 }, fakeDoc({ tab: "summary", height: 2600 }), { paperId: PAPER, noteId: NOTE });

    expect(place).toEqual(record({ tab: "summary", scrollY: 840, height: 2600, paragraphId: null, paragraphTop: 0 }));
  });

  it("calls a page with no tab strip (a paper without a body) the Summary", () => {
    expect(tabOnShow(fakeDoc({}))).toBe("summary");
    expect(tabOnShow(fakeDoc({ tab: "digestion" }))).toBe("digestion");
    expect(tabOnShow(fakeDoc({ tab: "summary" }))).toBe("summary");
  });

  it("finds the tab by the strip's own ids, so the two cannot drift apart", () => {
    for (const name of READER_TABS) expect(tabOnShow(fakeDoc({ tab: name }))).toBe(name);
  });

  it("takes the first paragraph that reaches below the masthead, and only the body's paragraphs", () => {
    const doc = fakeDoc({
      tab: "digestion",
      paragraphs: [
        paragraph("paper-section-1", -900, -10), // a section, not a paragraph
        paragraph("paper-section-1-p1", -500, 40), // ends under the masthead (48 + 8 = 56): above the view
        paragraph("paper-section-1-p2", 40, 330),
      ],
    });

    expect(paragraphAtTop(doc)).toEqual({ id: "paper-section-1-p2", top: 40 });
    expect(paragraphAtTop(fakeDoc({ tab: "summary" }))).toBeNull();
  });
});

describe("kept per tab in sessionStorage, and nowhere else (rule 1)", () => {
  const env = (storage = fakeStorage(), doc = fakeDoc({ tab: "digestion", paragraphs: [paragraph("paper-section-2-p3", -20, 260)] })) => ({
    win: { scrollY: 3012 },
    doc,
    storage,
  });

  it("writes one record under one key", () => {
    const e = env();

    expect(rememberPlace({ paperId: PAPER, noteId: NOTE }, e)).toBe(true);

    expect([...e.storage.data.keys()]).toEqual([RETURN_KEY]);
    expect(JSON.parse(e.storage.data.get(RETURN_KEY) as string)).toEqual(record());
  });

  it("holds no network call and no shared store: the module never touches localStorage, fetch, a beacon or a zustand store", () => {
    const source = readFileSync(resolve(__dirname, "return-to-paper.ts"), "utf8");
    const code = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

    expect(code).toMatch(/sessionStorage/);
    for (const banned of [/localStorage/, /\bfetch\s*\(/, /sendBeacon/, /XMLHttpRequest/, /zustand/, /from "@\/store\//, /document\.cookie/]) {
      expect(code).not.toMatch(banned);
    }
  });

  it("is quiet where storage is blocked: nothing is kept, nothing throws, and the button stays Saved", () => {
    const blocked = fakeStorage({}, true);

    expect(rememberPlace({ paperId: PAPER, noteId: NOTE }, env(blocked))).toBe(false);
    expect(peekPlace(PAPER, blocked)).toBeNull();
    expect(() => dropPlace(blocked)).not.toThrow();
  });

  it("lets the paper's page read the record only for that paper, and leaves another paper's alone", () => {
    const storage = fakeStorage();
    rememberPlace({ paperId: PAPER, noteId: NOTE }, env(storage));

    expect(peekPlace(PAPER, storage)).toEqual(record());
    expect(peekPlace("openalex:W-other", storage)).toBeNull();
    expect(storage.data.has(RETURN_KEY)).toBe(true);
  });

  it("is cleared by dropPlace, and a record of a different shape is not one", () => {
    const storage = fakeStorage({ [RETURN_KEY]: JSON.stringify({ paperId: PAPER, noteId: NOTE, tab: "digestion" }) });

    expect(peekPlace(PAPER, storage)).toBeNull(); // no scroll, no height
    storage.data.set(RETURN_KEY, JSON.stringify(record()));
    expect(peekPlace(PAPER, storage)).not.toBeNull();
    dropPlace(storage);
    expect(storage.data.size).toBe(0);
    expect(peekPlace(PAPER, storage)).toBeNull();
    storage.data.set(RETURN_KEY, "{not json");
    expect(peekPlace(PAPER, storage)).toBeNull();
    storage.data.set(RETURN_KEY, JSON.stringify(record({ tab: "elsewhere" as never })));
    expect(peekPlace(PAPER, storage)).toBeNull();
  });
});

describe("the notes page's button (rule 1)", () => {
  const raw = (over: Partial<PlaceRecord> = {}) => JSON.stringify(record(over));

  it('reads "Back to paper" and goes to that paper when this note was opened from it', () => {
    expect(backTarget(NOTE, raw())).toEqual({ label: "Back to paper", href: `/papers/${encodeURIComponent(PAPER)}`, fromPaper: true });
  });

  it('stays "Saved", going to the Saved library, when there is no record (from Saved, a deep link, a reload with none)', () => {
    expect(backTarget(NOTE, null)).toEqual({ label: "Saved", href: "/saved", fromPaper: false });
  });

  it('stays "Saved" for a record that names another note, or one that cannot be read', () => {
    expect(backTarget(NOTE, raw({ noteId: "note-2" })).label).toBe("Saved");
    expect(backTarget(NOTE, "{not json").label).toBe("Saved");
    expect(backTarget(NOTE, JSON.stringify({ paperId: PAPER, noteId: NOTE })).label).toBe("Saved");
    expect(backTarget(NOTE, raw({ paperId: "" })).label).toBe("Saved");
  });
});

describe("leaving the notes page (rule 1: any other way out is not a way back)", () => {
  it("drops the record when the page is left by anything but the button, and keeps it for the button", () => {
    const later: Array<() => void> = [];
    const drop = vi.fn();
    const lease = leaseReturn(drop, (cb) => later.push(cb));

    lease.mount();
    lease.unmount();
    later.splice(0).forEach((cb) => cb());
    expect(drop).toHaveBeenCalledTimes(1);

    const kept = leaseReturn(drop, (cb) => later.push(cb));
    kept.mount();
    kept.leave(); // "Back to paper" pressed
    kept.unmount();
    later.splice(0).forEach((cb) => cb());
    expect(drop).toHaveBeenCalledTimes(1);
  });

  it("does not drop it for a mount that is straight away mounted again (React's development double run)", () => {
    const later: Array<() => void> = [];
    const drop = vi.fn();
    const lease = leaseReturn(drop, (cb) => later.push(cb));

    lease.mount();
    lease.unmount();
    lease.mount();
    later.splice(0).forEach((cb) => cb());

    expect(drop).not.toHaveBeenCalled();
  });
});

describe("which step back on the paper takes (rule 2: the tab first)", () => {
  const view = { ready: true, hasBody: true, tab: "digestion" as const };

  it("does nothing without a record, and waits for the reading to arrive", () => {
    expect(restoreStep(null, view)).toEqual({ kind: "none" });
    expect(restoreStep(record(), { ...view, ready: false })).toEqual({ kind: "wait" });
  });

  it("switches to the recorded tab when the page is on the other, and only then places the scroll", () => {
    expect(restoreStep(record({ tab: "summary" }), view)).toEqual({ kind: "select", tab: "summary" });
    expect(restoreStep(record({ tab: "summary" }), { ...view, tab: "summary" })).toEqual({ kind: "place" });
    expect(restoreStep(record({ tab: "digestion" }), { ...view, tab: "summary" })).toEqual({ kind: "select", tab: "digestion" });
    expect(restoreStep(record({ tab: "digestion" }), view)).toEqual({ kind: "place" });
  });

  it("places the scroll on a paper that has no tabs, whichever tab was recorded (there is only the one page)", () => {
    expect(restoreStep(record({ tab: "digestion" }), { ready: true, hasBody: false, tab: "summary" })).toEqual({ kind: "place" });
  });
});

describe("where the scroll lands (rule 2)", () => {
  it("is the recorded scroll when the page is as tall as it was", () => {
    expect(decideRestore(record(), { height: 9000, paragraphTop: 300 })).toEqual({ kind: "scroll", top: 3012 });
    expect(decideRestore(record(), { height: 9000 + HEIGHT_SLACK_PX, paragraphTop: 300 })).toEqual({ kind: "scroll", top: 3012 });
    expect(decideRestore(record(), { height: 9000 - HEIGHT_SLACK_PX, paragraphTop: null })).toEqual({ kind: "scroll", top: 3012 });
  });

  it("is the recorded paragraph, back at the height it stood, when the page's height changed", () => {
    // The paragraph stood 20 px above the top of the view; now it is 640 px below it: the page moves down by 660.
    expect(decideRestore(record(), { height: 9000 + HEIGHT_SLACK_PX + 1, paragraphTop: 640 })).toEqual({ kind: "paragraph", by: 660 });
    expect(decideRestore(record(), { height: 5000, paragraphTop: -20 })).toEqual({ kind: "paragraph", by: 0 });
  });

  it("waits while the height is wrong and the paragraph is not on the page (nothing to land on yet)", () => {
    expect(decideRestore(record(), { height: 4000, paragraphTop: null })).toEqual({ kind: "wait" });
    expect(decideRestore(record({ paragraphId: null, paragraphTop: 0 }), { height: 4000, paragraphTop: null })).toEqual({ kind: "wait" });
  });
});

/**
 * A page whose frames, clock, scroll and reader are all under the test's hand. `docY` is where each paragraph stands in the DOCUMENT; its
 * top in the window is that less the scroll, as in a browser, so a scroll call moves what the next frame sees.
 */
function fakeEnv(init: { height: number; scrollY?: number; docY?: Record<string, number> }) {
  const page = { height: init.height, scrollY: init.scrollY ?? 0, docY: { ...init.docY } as Record<string, number> };
  const frames: Array<() => void> = [];
  let clock = 0;
  const listeners = new Set<() => void>();
  const anchoring = { off: false };
  const env: PlaceEnv & { calls: string[] } = {
    calls: [],
    scrollHeight: () => page.height,
    scrollY: () => page.scrollY,
    paragraphTop: (id) => (id in page.docY ? page.docY[id] - page.scrollY : null),
    scrollTo: (top) => {
      env.calls.push(`to:${top}`);
      page.scrollY = top;
    },
    scrollBy: (dy) => {
      env.calls.push(`by:${dy}`);
      page.scrollY += dy;
    },
    drop: () => void env.calls.push("drop"),
    now: () => clock,
    frame: (cb) => {
      frames.push(cb);
      return () => {
        const at = frames.indexOf(cb);
        if (at >= 0) frames.splice(at, 1);
      };
    },
    onUserScroll: (cb) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    hold: () => {
      anchoring.off = true;
      return () => {
        anchoring.off = false;
      };
    },
  };
  return {
    env,
    page,
    frame: (ms = 16) => {
      clock += ms;
      frames.splice(0).forEach((cb) => cb());
    },
    pending: () => frames.length,
    listening: () => listeners.size,
    reader: () => [...listeners].forEach((cb) => cb()),
    anchoring,
  };
}

describe("restoring the place once the reading has rendered (rule 2)", () => {
  it("scrolls to the recorded place after the first frame, never before it, once, and then clears the record", () => {
    const world = fakeEnv({ height: 9000, docY: { "paper-section-2-p3": 2992 } });

    restorePlace(record(), world.env);
    expect(world.env.calls).toEqual([]); // nothing in the render itself
    world.frame();
    expect(world.env.calls).toEqual(["to:3012", "drop"]);
    world.frame();
    world.frame();
    expect(world.env.calls).toEqual(["to:3012", "drop"]); // once: a place that holds is not touched again
  });

  it("lands on the recorded paragraph instead when the page's height changed", () => {
    const world = fakeEnv({ height: 6400, docY: { "paper-section-2-p3": 640 } });

    restorePlace(record(), world.env);
    world.frame();
    world.frame();

    // The paragraph stood 20 px above the top of the view; it is 640 below it now: the page moves down by 660, and stays.
    expect(world.env.calls).toEqual(["by:660", "drop"]);
    expect(world.env.paragraphTop("paper-section-2-p3")).toBe(-20);
  });

  it("waits for the paragraph to be on the page, then lands on it", () => {
    const world = fakeEnv({ height: 1200 });

    restorePlace(record(), world.env);
    world.frame();
    world.frame();
    expect(world.env.calls).toEqual([]);
    world.page.docY["paper-section-2-p3"] = 100;
    world.frame();

    expect(world.env.calls).toEqual(["by:120", "drop"]);
  });

  it("gives up the wait and uses the recorded scroll when nothing to land on ever comes", () => {
    const world = fakeEnv({ height: 1200 });

    restorePlace(record({ tab: "summary", paragraphId: null, paragraphTop: 0 }), world.env);
    world.frame(SETTLE_MS - 100);
    expect(world.env.calls).toEqual([]);
    world.frame(200);

    expect(world.env.calls).toEqual(["to:3012", "drop"]);
  });

  it("leaves the page to the reader the moment they scroll, and clears the record", () => {
    const world = fakeEnv({ height: 1200 });

    restorePlace(record(), world.env);
    world.frame();
    world.reader();
    world.frame();
    world.frame();

    expect(world.env.calls).toEqual(["drop"]);
    expect(world.pending()).toBe(0);
    expect(world.listening()).toBe(0);
    expect(world.anchoring.off).toBe(false);
  });

  it("stops without clearing when the page is torn down first (the record is kept for the page that stays)", () => {
    const world = fakeEnv({ height: 9000 });

    const stop = restorePlace(record(), world.env);
    stop();
    world.frame();

    expect(world.env.calls).toEqual([]);
    expect(world.pending()).toBe(0);
    expect(world.listening()).toBe(0);
    expect(world.anchoring.off).toBe(false);
  });
});

describe("holding the place while the page settles (rule 2: it stops where the reader left, not a few lines off)", () => {
  it("puts right a scroll the browser moved after the landing (scroll anchoring moved it by 47 px, 200 ms on)", () => {
    const world = fakeEnv({ height: 9000, docY: { "paper-section-2-p3": 2992 } });

    restorePlace(record(), world.env);
    world.frame();
    world.page.scrollY = 3012 - 47; // the browser's doing, not the reader's
    world.frame();

    expect(world.env.calls).toEqual(["to:3012", "drop", "to:3012"]);
    expect(world.page.scrollY).toBe(3012);
  });

  it("keeps the recorded paragraph where it stood when content above it grows after the landing (56 px, in one column)", () => {
    const world = fakeEnv({ height: 6400, docY: { "paper-section-2-p3": 640 } });

    restorePlace(record(), world.env);
    world.frame();
    world.page.docY["paper-section-2-p3"] += 56;
    world.frame();

    expect(world.env.calls).toEqual(["by:660", "drop", "by:56"]);
    expect(world.env.paragraphTop("paper-section-2-p3")).toBe(-20);
  });

  it("keeps the browser's scroll anchoring off from the start until the hold ends, then gives it back and stops", () => {
    const world = fakeEnv({ height: 9000, docY: { "paper-section-2-p3": 2992 } });

    restorePlace(record(), world.env);
    expect(world.anchoring.off).toBe(true); // before the first frame
    world.frame();
    expect(world.anchoring.off).toBe(true); // landed, still settling
    world.frame(HOLD_MS - 20);
    expect(world.anchoring.off).toBe(true);
    world.frame(20);

    expect(world.anchoring.off).toBe(false);
    expect(world.pending()).toBe(0);
    expect(world.listening()).toBe(0);
    // And once it has let go, a later move is the page's own and the reader's.
    world.page.scrollY = 100;
    world.frame();
    expect(world.env.calls).toEqual(["to:3012", "drop"]);
  });

  it("lets go of the page at once when it is torn down in the hold, or the reader takes over in it", () => {
    const torn = fakeEnv({ height: 9000, docY: { "paper-section-2-p3": 2992 } });
    const stop = restorePlace(record(), torn.env);
    torn.frame();
    stop();
    expect(torn.anchoring.off).toBe(false);
    expect(torn.pending()).toBe(0);
    torn.page.scrollY = 5;
    torn.frame();
    expect(torn.env.calls).toEqual(["to:3012", "drop"]);

    const taken = fakeEnv({ height: 9000, docY: { "paper-section-2-p3": 2992 } });
    restorePlace(record(), taken.env);
    taken.frame();
    taken.reader();
    taken.page.scrollY = 3500; // the reader's scroll is not put back
    taken.frame();
    expect(taken.env.calls).toEqual(["to:3012", "drop"]);
    expect(taken.anchoring.off).toBe(false);
  });
});
