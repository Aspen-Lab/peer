import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// No DOM here (this project's tests run in plain Node): the divider runs on the minimal hook runtime, the element tree it returns is
// inspected and its handlers are called with the few members of a pointer event it reads.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import type { ReactElement } from "react";
import { hookRuntime } from "@/test-support/hook-runtime";
import { PaneDivider, type PaneDividerProps } from "./pane-divider";

// P11-10 rule 2 (B P11-01 §2.6; ruling §1h.113 (a)): the divider's pointer path (the lightbox's capture pattern, a 4 px threshold, the
// delta divided by --page-zoom, the CSS variable written per frame, the store written on release) and its keyboard path.

type Handler = (event: unknown) => void;
type Props = Record<string, unknown> & { ref: { current: unknown } };

/** The separator's element, rendered once, with its element handed to the ref as a browser would. */
async function stand(over: Partial<PaneDividerProps> = {}, zoom = 1) {
  const style = { setProperty: vi.fn() };
  const grid = { style } as unknown as HTMLElement;
  const attributes: Record<string, string> = {};
  const captured = new Set<number>();
  const element = {
    dataset: {} as Record<string, string>,
    focus: vi.fn(),
    setAttribute: (name: string, value: string) => {
      attributes[name] = value;
    },
    setPointerCapture: vi.fn((id: number) => captured.add(id)),
    releasePointerCapture: vi.fn((id: number) => captured.delete(id)),
    hasPointerCapture: (id: number) => captured.has(id),
  };
  const commits: number[] = [];
  const props: PaneDividerProps = {
    pane: "left",
    value: 320,
    room: { viewport: 1440, other: 360 },
    target: { current: grid },
    variable: "--left-pane-w",
    label: "Resize left panel",
    controls: "reader-left-pane",
    onCommit: (width) => commits.push(width),
    ...over,
  };
  vi.stubGlobal("window", { getComputedStyle: () => ({ getPropertyValue: (name: string) => (name === "--page-zoom" ? String(zoom) : "") }) });
  const mounted = await hookRuntime.mount(() => PaneDivider(props));
  const root = mounted.value as unknown as ReactElement<Props>;
  root.props.ref.current = element;
  const on = (name: string): Handler => root.props[name] as Handler;
  return { root, on, element, attributes, commits, writes: style.setProperty, mounted };
}

/** The members of a pointer event the divider reads. */
const pointer = (element: unknown, type: string, over: Record<string, unknown> = {}) => ({
  type,
  button: 0,
  isPrimary: true,
  pointerId: 1,
  clientX: 500,
  clientY: 300,
  currentTarget: element,
  preventDefault: vi.fn(),
  ...over,
});

const key = (name: string, over: Record<string, unknown> = {}) => ({ key: name, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, preventDefault: vi.fn(), ...over });

let frames: Array<() => void>;
let body: { style: { userSelect: string; cursor: string } };
const runFrames = () => frames.splice(0).forEach((frame) => frame());

beforeEach(() => {
  frames = [];
  body = { style: { userSelect: "", cursor: "" } };
  vi.stubGlobal("document", { body });
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames[id - 1] = () => {};
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("the pointer path — the lightbox's capture pattern", () => {
  it("takes the pointer on a primary left-button press, and focuses the separator", async () => {
    const s = await stand();
    const down = pointer(s.element, "pointerdown");
    s.on("onPointerDown")(down);
    expect(s.element.setPointerCapture).toHaveBeenCalledWith(1);
    expect(s.element.focus).toHaveBeenCalled();
    expect(down.preventDefault).toHaveBeenCalled();
  });

  it("ignores a secondary button and a non-primary pointer", async () => {
    const s = await stand();
    s.on("onPointerDown")(pointer(s.element, "pointerdown", { button: 2 }));
    s.on("onPointerDown")(pointer(s.element, "pointerdown", { isPrimary: false }));
    s.on("onPointerMove")(pointer(s.element, "pointermove", { clientX: 600 }));
    expect(s.element.setPointerCapture).not.toHaveBeenCalled();
    expect(frames).toHaveLength(0);
    expect(s.commits).toEqual([]);
  });

  it("moves nothing until the pointer has travelled 4 px, and a press-and-release without travel is no choice", async () => {
    const s = await stand();
    s.on("onPointerDown")(pointer(s.element, "pointerdown"));
    s.on("onPointerMove")(pointer(s.element, "pointermove", { clientX: 503 }));
    expect(frames).toHaveLength(0);
    s.on("onPointerUp")(pointer(s.element, "pointerup", { clientX: 503 }));
    expect(s.writes).not.toHaveBeenCalled();
    expect(s.commits).toEqual([]);

    s.on("onPointerDown")(pointer(s.element, "pointerdown"));
    s.on("onPointerMove")(pointer(s.element, "pointermove", { clientX: 496 }));
    expect(frames).toHaveLength(1);
    s.on("onPointerUp")(pointer(s.element, "pointerup", { clientX: 496 }));
    expect(s.commits).toEqual([316]);
  });

  it("a drag of 8 steps: the variable is written once per frame, the width is committed once, on release", async () => {
    const s = await stand();
    s.on("onPointerDown")(pointer(s.element, "pointerdown"));
    for (let step = 1; step <= 8; step++) s.on("onPointerMove")(pointer(s.element, "pointermove", { clientX: 500 + step * 10 }));

    // Eight moves, one frame waiting: nothing has been written yet, and nothing has been committed.
    expect(s.writes).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);
    expect(s.commits).toEqual([]);

    runFrames();
    expect(s.writes).toHaveBeenCalledTimes(1);
    expect(s.writes).toHaveBeenLastCalledWith("--left-pane-w", "400px");
    expect(s.attributes["aria-valuenow"]).toBe("400");
    expect(s.element.dataset.dragging).toBe("true");
    expect(s.commits).toEqual([]);

    // A second stretch of the drag is a second frame.
    s.on("onPointerMove")(pointer(s.element, "pointermove", { clientX: 600 }));
    runFrames();
    expect(s.writes).toHaveBeenCalledTimes(2);
    expect(s.writes).toHaveBeenLastCalledWith("--left-pane-w", "420px");

    s.on("onPointerUp")(pointer(s.element, "pointerup", { clientX: 600 }));
    expect(s.commits).toEqual([420]);
    expect(s.element.dataset.dragging).toBeUndefined();
    expect(s.element.releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it("writes the last width at once on release, if its frame has not come", async () => {
    const s = await stand();
    s.on("onPointerDown")(pointer(s.element, "pointerdown"));
    s.on("onPointerMove")(pointer(s.element, "pointermove", { clientX: 550 }));
    s.on("onPointerUp")(pointer(s.element, "pointerup", { clientX: 550 }));
    expect(s.writes).toHaveBeenLastCalledWith("--left-pane-w", "370px");
    expect(s.commits).toEqual([370]);
    // The frame that was waiting is cancelled: it writes nothing more.
    const before = s.writes.mock.calls.length;
    runFrames();
    expect(s.writes.mock.calls.length).toBe(before);
  });

  it("divides the pointer's travel by --page-zoom: window px to layout px", async () => {
    const s = await stand({}, 1.25);
    s.on("onPointerDown")(pointer(s.element, "pointerdown"));
    s.on("onPointerMove")(pointer(s.element, "pointermove", { clientX: 600 }));
    s.on("onPointerUp")(pointer(s.element, "pointerup", { clientX: 600 }));
    // 100 window px at zoom 1.25 is 80 layout px.
    expect(s.commits).toEqual([400]);
  });

  it("the margin's divider: the pointer going left widens the margin", async () => {
    const s = await stand({ pane: "margin", value: 360, variable: "--margin-w", room: { viewport: 1440, other: 320 } });
    s.on("onPointerDown")(pointer(s.element, "pointerdown", { clientX: 1000 }));
    s.on("onPointerMove")(pointer(s.element, "pointermove", { clientX: 940 }));
    runFrames();
    expect(s.writes).toHaveBeenLastCalledWith("--margin-w", "420px");
    s.on("onPointerUp")(pointer(s.element, "pointerup", { clientX: 940 }));
    expect(s.commits).toEqual([420]);
  });

  it("never goes past the pane's range or the centre's minimum", async () => {
    const s = await stand({ value: 280, room: { viewport: 1024, other: 280 } });
    s.on("onPointerDown")(pointer(s.element, "pointerdown"));
    s.on("onPointerMove")(pointer(s.element, "pointermove", { clientX: 900 }));
    s.on("onPointerUp")(pointer(s.element, "pointerup", { clientX: 900 }));
    expect(s.commits).toEqual([280]);
  });

  it("puts the pane back where it stood when the pointer is cancelled or its capture is lost, and commits nothing", async () => {
    for (const [handler, type] of [["onPointerCancel", "pointercancel"], ["onLostPointerCapture", "lostpointercapture"]] as const) {
      const s = await stand();
      s.on("onPointerDown")(pointer(s.element, "pointerdown"));
      s.on("onPointerMove")(pointer(s.element, "pointermove", { clientX: 580 }));
      runFrames();
      expect(s.writes).toHaveBeenLastCalledWith("--left-pane-w", "400px");
      s.on(handler)(pointer(s.element, type));
      expect(s.writes).toHaveBeenLastCalledWith("--left-pane-w", "320px");
      expect(s.attributes["aria-valuenow"]).toBe("320");
      expect(s.commits).toEqual([]);
    }
  });

  it("commits once: the lost capture that follows a release finds no drag", async () => {
    const s = await stand();
    s.on("onPointerDown")(pointer(s.element, "pointerdown"));
    s.on("onPointerMove")(pointer(s.element, "pointermove", { clientX: 540 }));
    s.on("onPointerUp")(pointer(s.element, "pointerup", { clientX: 540 }));
    s.on("onLostPointerCapture")(pointer(s.element, "lostpointercapture"));
    expect(s.commits).toEqual([360]);
  });

  it("follows one pointer: another pointer's moves are not the drag's", async () => {
    const s = await stand();
    s.on("onPointerDown")(pointer(s.element, "pointerdown"));
    s.on("onPointerMove")(pointer(s.element, "pointermove", { pointerId: 2, clientX: 700 }));
    expect(frames).toHaveLength(0);
    s.on("onPointerUp")(pointer(s.element, "pointerup", { pointerId: 2, clientX: 700 }));
    expect(s.commits).toEqual([]);
  });

  it("holds the page still while it drags: no text selection, a col-resize cursor, given back after", async () => {
    body.style.userSelect = "text";
    body.style.cursor = "wait";
    const s = await stand();
    s.on("onPointerDown")(pointer(s.element, "pointerdown"));
    expect(body.style.userSelect).toBe("text");
    s.on("onPointerMove")(pointer(s.element, "pointermove", { clientX: 540 }));
    expect(body.style.userSelect).toBe("none");
    expect(body.style.cursor).toBe("col-resize");
    s.on("onPointerUp")(pointer(s.element, "pointerup", { clientX: 540 }));
    expect(body.style.userSelect).toBe("text");
    expect(body.style.cursor).toBe("wait");
  });

  it("gives the page back if the separator goes in the middle of a drag", async () => {
    const s = await stand();
    s.on("onPointerDown")(pointer(s.element, "pointerdown"));
    s.on("onPointerMove")(pointer(s.element, "pointermove", { clientX: 540 }));
    expect(body.style.userSelect).toBe("none");
    s.mounted.unmount();
    expect(body.style.userSelect).toBe("");
    expect(body.style.cursor).toBe("");
  });

  it("writes straight away where there is no animation frame to wait for", async () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    const s = await stand();
    s.on("onPointerDown")(pointer(s.element, "pointerdown"));
    s.on("onPointerMove")(pointer(s.element, "pointermove", { clientX: 540 }));
    expect(s.writes).toHaveBeenLastCalledWith("--left-pane-w", "360px");
  });
});

describe("the keyboard path", () => {
  it("← → move the boundary 16 px, Shift 64", async () => {
    const s = await stand();
    const press = (name: string, shiftKey = false) => {
      const event = key(name, { shiftKey });
      s.on("onKeyDown")(event);
      return event;
    };
    expect(press("ArrowRight").preventDefault).toHaveBeenCalled();
    press("ArrowLeft");
    press("ArrowRight", true);
    press("ArrowLeft", true);
    expect(s.commits).toEqual([336, 304, 384, 256]);
  });

  it("the margin's arrows move the boundary the way they point: → narrows the margin", async () => {
    const s = await stand({ pane: "margin", value: 360, room: { viewport: 1440, other: 320 } });
    s.on("onKeyDown")(key("ArrowRight"));
    s.on("onKeyDown")(key("ArrowLeft", { shiftKey: true }));
    expect(s.commits).toEqual([344, 424]);
  });

  it("Home is the least width, End the greatest, Enter the default", async () => {
    const s = await stand({ value: 400 });
    s.on("onKeyDown")(key("Home"));
    s.on("onKeyDown")(key("End"));
    s.on("onKeyDown")(key("Enter"));
    expect(s.commits).toEqual([240, 480, 320]);
  });

  it("commits nothing when the key changes nothing (at a bound), and still takes the key", async () => {
    const s = await stand({ value: 480 });
    const event = key("ArrowRight");
    s.on("onKeyDown")(event);
    expect(s.commits).toEqual([]);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("leaves every other key alone — Tab moves on, nothing is prevented", async () => {
    const s = await stand();
    for (const name of ["Tab", "ArrowUp", "ArrowDown", "Escape", " ", "a"]) {
      const event = key(name);
      s.on("onKeyDown")(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(s.commits).toEqual([]);
  });

  it("leaves a chord alone: Alt+← is the browser's Back, Ctrl/Cmd + arrows the system's", async () => {
    const s = await stand();
    for (const over of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
      const event = key("ArrowLeft", over);
      s.on("onKeyDown")(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(s.commits).toEqual([]);
  });
});

// P12-95 rule 2 (the owner's O1; ruling §1h.484): the keys and the pointer reach the end of the range the drag floor gives.
describe("at 853 px with the drag floor for the centre's minimum (P12-95)", () => {
  const W3 = { pane: "margin", value: 281, variable: "--margin-w", room: { viewport: 853, other: 48, centreMinimum: 434 } } as const;

  it("End commits 347 (the reading budget gave 281), Home 280, an arrow 16 px", async () => {
    const s = await stand(W3);
    s.on("onKeyDown")(key("End"));
    s.on("onKeyDown")(key("Home"));
    s.on("onKeyDown")(key("ArrowLeft"));
    expect(s.commits).toEqual([347, 280, 297]);
    const budget = await stand({ ...W3, room: { viewport: 853, other: 48, centreMinimum: 500 } });
    budget.on("onKeyDown")(key("End"));
    expect(budget.commits).toEqual([]);
  });

  it("a pointer dragged far to the left stops at 347 and commits it, the variable following frame by frame", async () => {
    const s = await stand(W3);
    s.on("onPointerDown")(pointer(s.element, "pointerdown", { clientX: 800 }));
    s.on("onPointerMove")(pointer(s.element, "pointermove", { clientX: 760 }));
    runFrames();
    expect(s.writes).toHaveBeenLastCalledWith("--margin-w", "321px");
    s.on("onPointerMove")(pointer(s.element, "pointermove", { clientX: 100 }));
    runFrames();
    expect(s.writes).toHaveBeenLastCalledWith("--margin-w", "347px");
    s.on("onPointerUp")(pointer(s.element, "pointerup", { clientX: 100 }));
    expect(s.commits).toEqual([347]);
  });
});

describe("a double-click", () => {
  it("is the pane's default width: 320 for the left pane, 360 from 1536, 360 for the margin", async () => {
    const left = await stand({ value: 450 });
    left.on("onDoubleClick")({});
    expect(left.commits).toEqual([320]);

    const wide = await stand({ value: 450, room: { viewport: 1920, other: 360 } });
    wide.on("onDoubleClick")({});
    expect(wide.commits).toEqual([360]);

    const margin = await stand({ pane: "margin", value: 500, room: { viewport: 1440, other: 320 } });
    margin.on("onDoubleClick")({});
    expect(margin.commits).toEqual([360]);
  });

  it("is clamped to what the window leaves: at 1024 the left pane's default 320 gives way to 280", async () => {
    const s = await stand({ value: 240, room: { viewport: 1024, other: 280 } });
    s.on("onDoubleClick")({});
    expect(s.commits).toEqual([280]);
  });
});
