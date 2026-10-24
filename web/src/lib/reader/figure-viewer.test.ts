import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWindows } from "./windows";
import {
  closeFigure,
  getOpenFigure,
  getParkedFigure,
  openFigure,
  openFigureKey,
  parkFigure,
  resumeFigure,
  subscribeOpenFigure,
  useFigureOpen,
  useOpenFigure,
  useParkedFigure,
  type FigureRef,
} from "./figure-viewer";

// P11-12 (owner item 1; B P11-05 §2.3; ruling §1h.113): the figure the reader opened from the paper's body, one at a time,
// in memory only. D2: a second figure replaces the first. D4: the open figure pressed again stays open. No floating window
// is opened and no place is held here — the card that shows the figure in the margin does that, later. Every text is invented.

const ref = (n: number, over: Partial<FigureRef> = {}): FigureRef => ({
  key: `Figure ${n}:${n}`,
  src: `/api/papers/openalex%3AW1/figure-image?page=${n}&fig=${n}`,
  label: `Figure ${n}`,
  caption: `Creep rate against grain size, panel ${n}.`,
  natural: { width: 1400, height: 900 },
  origin: { left: 300, top: 120 * n, width: 640, height: 411 },
  ...over,
});

beforeEach(() => closeFigure());
afterEach(() => {
  closeFigure();
  vi.restoreAllMocks();
});

describe("openFigure / closeFigure", () => {
  it("holds nothing until a figure is opened", () => {
    expect(getOpenFigure()).toBeNull();
    expect(openFigureKey()).toBeNull();
  });

  it("holds the figure it was given: its key, picture, label, caption, natural size and origin", () => {
    openFigure(ref(3));

    expect(getOpenFigure()).toEqual(ref(3));
    expect(openFigureKey()).toBe("Figure 3:3");
  });

  it("holds a figure whose size and place are not known as it is", () => {
    openFigure(ref(2, { natural: null, origin: null }));

    expect(getOpenFigure()).toMatchObject({ key: "Figure 2:2", natural: null, origin: null });
  });

  it("keeps its own copy: changing what was passed in changes nothing in the store", () => {
    const given = ref(1);
    openFigure(given);
    given.natural!.width = 1;
    given.origin!.top = -5;

    expect(getOpenFigure()).toEqual(ref(1));
  });

  it("replaces the figure that is open when another is opened (D2): one at a time, the first gone", () => {
    openFigure(ref(1));
    openFigure(ref(2));

    expect(openFigureKey()).toBe("Figure 2:2");
    expect(getOpenFigure()).toEqual(ref(2));
  });

  it("keeps the open figure when it is opened again (D4): the same key, not closed, a new open", () => {
    openFigure(ref(1));
    const first = getOpenFigure();
    const heard = vi.fn();
    const stop = subscribeOpenFigure(heard);

    openFigure(ref(1, { origin: { left: 300, top: 40, width: 640, height: 411 } }));

    expect(openFigureKey()).toBe("Figure 1:1");
    expect(getOpenFigure()).not.toBe(first); // a host that acts on the ref's identity acts on a second press too
    expect(getOpenFigure()?.origin?.top).toBe(40);
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
  });

  it("closes the open figure, and closing with nothing open is a no-op nobody hears", () => {
    openFigure(ref(1));
    const heard = vi.fn();
    const stop = subscribeOpenFigure(heard);

    closeFigure();
    expect(getOpenFigure()).toBeNull();
    expect(openFigureKey()).toBeNull();
    expect(heard).toHaveBeenCalledTimes(1);

    closeFigure();
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe("subscribeOpenFigure", () => {
  it("tells a subscriber each time a figure opens, replaces, or closes, until it stops", () => {
    const heard = vi.fn();
    const stop = subscribeOpenFigure(heard);

    openFigure(ref(1));
    openFigure(ref(2));
    closeFigure();
    expect(heard).toHaveBeenCalledTimes(3);

    stop();
    openFigure(ref(3));
    expect(heard).toHaveBeenCalledTimes(3);
  });

  it("lets a subscriber stop itself while it is being told, without skipping the next", () => {
    const order: string[] = [];
    const stopFirst = subscribeOpenFigure(() => {
      order.push("first");
      stopFirst();
    });
    const stopSecond = subscribeOpenFigure(() => order.push("second"));

    openFigure(ref(1));
    expect(order).toEqual(["first", "second"]);
    stopSecond();
  });
});

describe("the hooks", () => {
  function Probe() {
    const open = useOpenFigure();
    return createElement("p", null, open ? `${open.key}|${open.label}|${open.caption}` : "none");
  }
  function Mark({ figureKey }: { figureKey: string }) {
    return createElement("p", null, useFigureOpen(figureKey) ? "open" : "shut");
  }
  const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

  it("useOpenFigure reads the open figure, or null", () => {
    expect(html(createElement(Probe))).toBe("<p>none</p>");
    openFigure(ref(4));
    expect(html(createElement(Probe))).toBe(`<p>Figure 4:4|Figure 4|${ref(4).caption}</p>`);
    closeFigure();
    expect(html(createElement(Probe))).toBe("<p>none</p>");
  });

  it("useFigureOpen is true for the open figure's key and for no other", () => {
    expect(html(createElement(Mark, { figureKey: "Figure 1:1" }))).toBe("<p>shut</p>");
    openFigure(ref(1));
    expect(html(createElement(Mark, { figureKey: "Figure 1:1" }))).toBe("<p>open</p>");
    expect(html(createElement(Mark, { figureKey: "Figure 2:2" }))).toBe("<p>shut</p>");
    openFigure(ref(2));
    expect(html(createElement(Mark, { figureKey: "Figure 1:1" }))).toBe("<p>shut</p>");
    expect(html(createElement(Mark, { figureKey: "Figure 2:2" }))).toBe("<p>open</p>");
  });
});

describe("in memory only, and not the floating windows (rule 1)", () => {
  // Comments say what the file does not do; the code is what is read.
  const code = readFileSync(new URL("./figure-viewer.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("never touches storage, a cookie, a network or the console", () => {
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(|console\./);
  });

  it("calls no useWindows and no holdInPlace, and imports nothing of the windows' store", () => {
    expect(code).not.toMatch(/useWindows|holdInPlace|from "\.\/windows"|from "@\/lib\/reader\/windows"|reserveDock/);
  });

  it("opening and closing writes nothing to the console and opens no window", () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
    useWindows.setState({ windows: [], clock: 0 });

    openFigure(ref(1));
    openFigure(ref(2));
    closeFigure();

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(useWindows.getState().windows).toEqual([]);
  });
});

// P11-41 (round 2, Theme B (c); ruling §1h.138 (d)): a figure card that the window's narrowing takes out of the margin is PARKED, not closed: held in
// memory (this module's variable; nothing is stored), so that the host brings the very same figure back when the window is wide again. Parked, it is not
// open — the body's button is not pressed, Escape has nothing to close, the key is not "the open figure's" — and it is gone the moment the reader opens
// or closes a figure (a figure closed while the window was narrow stays closed).
describe("a parked figure (P11-41; ruling §1h.138 (d))", () => {
  it("parks the open figure: nothing is open, the same ref is held, and a subscriber is told once", () => {
    openFigure(ref(3));
    const open = getOpenFigure();
    const heard = vi.fn();
    const stop = subscribeOpenFigure(heard);

    expect(parkFigure()).toBe(true);

    expect(getOpenFigure()).toBeNull();
    expect(openFigureKey()).toBeNull();
    expect(getParkedFigure()).toBe(open);
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
  });

  it("parks nothing when nothing is open, and nobody hears", () => {
    const heard = vi.fn();
    const stop = subscribeOpenFigure(heard);

    expect(parkFigure()).toBe(false);

    expect(getParkedFigure()).toBeNull();
    expect(heard).not.toHaveBeenCalled();
    stop();
  });

  it("resumes the parked figure as the open one: the same ref, not a copy (a host that acts on a new ref — the card's focus — does not act)", () => {
    openFigure(ref(3));
    const open = getOpenFigure();
    parkFigure();
    const heard = vi.fn();
    const stop = subscribeOpenFigure(heard);

    expect(resumeFigure()).toBe(true);

    expect(getOpenFigure()).toBe(open);
    expect(openFigureKey()).toBe("Figure 3:3");
    expect(getParkedFigure()).toBeNull();
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
  });

  it("resumes nothing when nothing is parked", () => {
    expect(resumeFigure()).toBe(false);
    openFigure(ref(1));
    expect(resumeFigure()).toBe(false);
    expect(openFigureKey()).toBe("Figure 1:1");
  });

  it("is replaced by a figure opened meanwhile (D2: one figure at a time): the parked one is gone, and does not come back", () => {
    openFigure(ref(1));
    parkFigure();

    openFigure(ref(2));

    expect(getParkedFigure()).toBeNull();
    expect(openFigureKey()).toBe("Figure 2:2");
    expect(resumeFigure()).toBe(false);
    expect(openFigureKey()).toBe("Figure 2:2");
  });

  it("the same figure opened again while it is parked is an open figure, and the parked one is gone", () => {
    openFigure(ref(1));
    parkFigure();

    openFigure(ref(1));
    closeFigure();

    expect(getParkedFigure()).toBeNull();
    expect(getOpenFigure()).toBeNull();
    expect(resumeFigure()).toBe(false);
  });

  it("is forgotten by a close: a figure closed while the window was narrow stays closed — and the close is heard once", () => {
    openFigure(ref(1));
    parkFigure();
    const heard = vi.fn();
    const stop = subscribeOpenFigure(heard);

    closeFigure();

    expect(getParkedFigure()).toBeNull();
    expect(getOpenFigure()).toBeNull();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(resumeFigure()).toBe(false);
    closeFigure();
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
  });

  it("is not the open figure for the body's button, and is again when it resumes", () => {
    const mark = (key: string) => renderToStaticMarkup(createElement(function Mark() { return createElement("p", null, useFigureOpen(key) ? "open" : "shut"); }));
    openFigure(ref(1));
    expect(mark("Figure 1:1")).toBe("<p>open</p>");
    parkFigure();
    expect(mark("Figure 1:1")).toBe("<p>shut</p>");
    resumeFigure();
    expect(mark("Figure 1:1")).toBe("<p>open</p>");
  });

  it("useParkedFigure reads the parked figure, or null", () => {
    const Probe = () => createElement("p", null, useParkedFigure()?.key ?? "none");
    expect(renderToStaticMarkup(createElement(Probe))).toBe("<p>none</p>");
    openFigure(ref(4));
    expect(renderToStaticMarkup(createElement(Probe))).toBe("<p>none</p>");
    parkFigure();
    expect(renderToStaticMarkup(createElement(Probe))).toBe("<p>Figure 4:4</p>");
    closeFigure();
    expect(renderToStaticMarkup(createElement(Probe))).toBe("<p>none</p>");
  });
});
