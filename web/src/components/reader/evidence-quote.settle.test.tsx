import { describe, expect, it } from "vitest";
import { followSectionLink, settleOnSection, type SettleEnv, type SettleTarget } from "./evidence-quote";

// P10-19 (A's X-A7, BACKLOG-78): a map row's first click landed 2,000-2,600 px short of its section from the top of the
// page. The browser's hash jump aims at where the heading stood when it was pressed; the paper's lazy figures then
// grew above the heading while the page scrolled past them, and the jump had no way to follow. The page now settles:
// once the jump has come to rest it scrolls to the heading again until that moves nothing. These tests drive that
// logic against a layout that can be made to grow, with the frame clock in the test's hands.

const FRAME = 16;
const MARGIN = 80; // the headings' scroll-mt-20

function world(docTop: number) {
  const scene = { y: 0, docTop, t: 0, frames: 0 };
  const calls: Array<ScrollIntoViewOptions | undefined> = [];
  const queue: Array<() => void> = [];
  const listeners = new Set<() => void>();
  const target: SettleTarget = {
    getBoundingClientRect: () => ({ top: scene.docTop - scene.y }),
    scrollIntoView(options) {
      calls.push(options);
      scene.y = scene.docTop - MARGIN;
    },
  };
  const env: SettleEnv = {
    now: () => scene.t,
    frame: (run) => {
      queue.push(run);
      return () => {
        const at = queue.indexOf(run);
        if (at >= 0) queue.splice(at, 1);
      };
    },
    onUser: (stop) => {
      listeners.add(stop);
      return () => void listeners.delete(stop);
    },
  };
  /** One frame: the world moves (`each`), then the frame's callbacks run. */
  const step = (count: number, each?: (frame: number) => void) => {
    for (let i = 0; i < count; i += 1) {
      scene.t += FRAME;
      scene.frames += 1;
      each?.(scene.frames);
      const run = queue.shift();
      run?.();
    }
  };
  return { scene, calls, queue, listeners, target, env, step, top: () => scene.docTop - scene.y };
}

/** The browser's smooth jump: `frames` frames from where the page is to where the heading stood at the press. */
function smoothJump(w: ReturnType<typeof world>, frames: number) {
  const from = w.scene.y;
  const to = w.scene.docTop - MARGIN;
  return (frame: number) => {
    w.scene.y = from + ((to - from) * Math.min(frame, frames)) / frames;
  };
}

describe("settleOnSection (P10-19, X-A7)", () => {
  it("scrolls to the heading again when the layout grew above it during the jump, and stops there", () => {
    const w = world(3000);
    const travel = smoothJump(w, 20);
    settleOnSection(() => w.target, w.env);
    w.step(60, (frame) => {
      travel(frame);
      if (frame === 22) w.scene.docTop += 1200; // the figures above the heading loaded as the page passed them
    });
    expect(w.top()).toBe(MARGIN);
    expect(w.calls.length).toBeGreaterThan(0);
    expect(w.calls.length).toBeLessThanOrEqual(3);
    expect(w.calls.every((options) => options?.block === "start" && options.behavior === "instant")).toBe(true);
    expect(w.queue).toHaveLength(0); // landed: the loop is over
  });

  it("follows a layout that grows more than once, each time after the page has come to rest", () => {
    const w = world(3000);
    const travel = smoothJump(w, 20);
    settleOnSection(() => w.target, w.env);
    w.step(120, (frame) => {
      travel(frame);
      if (frame === 22) w.scene.docTop += 900;
      if (frame === 40) w.scene.docTop += 600;
    });
    expect(w.top()).toBe(MARGIN);
  });

  it("does not jump while the smooth scroll is still travelling", () => {
    const w = world(3000);
    const travel = smoothJump(w, 40);
    settleOnSection(() => w.target, w.env);
    w.step(39, travel);
    expect(w.calls).toEqual([]);
    expect(w.top()).toBeGreaterThan(MARGIN);
  });

  it("a heading already in place settles without moving anything and ends", () => {
    const w = world(3000);
    w.scene.y = 3000 - MARGIN;
    settleOnSection(() => w.target, w.env);
    w.step(30);
    expect(w.top()).toBe(MARGIN);
    expect(w.queue).toHaveLength(0);
    expect(w.calls.length).toBeLessThanOrEqual(1);
  });

  it("is capped: a layout that never stops growing ends the loop about a second after the page came to rest", () => {
    const w = world(3000);
    const travel = smoothJump(w, 20);
    const grow = w.target.scrollIntoView;
    w.target.scrollIntoView = (options) => {
      w.scene.docTop += 100; // every landing is undone
      grow(options);
    };
    settleOnSection(() => w.target, w.env);
    w.step(400, travel);
    expect(w.queue).toHaveLength(0);
    expect(w.calls.length).toBeLessThan(40);
    expect(w.scene.t).toBeLessThan(20 * FRAME + 3 * FRAME + 1200);
  });

  it("stops at once when the reader scrolls, presses a key or touches the page", () => {
    const w = world(3000);
    const travel = smoothJump(w, 20);
    settleOnSection(() => w.target, w.env);
    w.step(10, travel);
    expect(w.listeners.size).toBe(1);
    for (const stop of [...w.listeners]) stop();
    expect(w.queue).toHaveLength(0);
    expect(w.listeners.size).toBe(0);
    w.scene.docTop += 1200;
    w.step(60, travel);
    expect(w.calls).toEqual([]);
  });

  it("a second settle replaces the first (one loop at a time)", () => {
    const w = world(3000);
    settleOnSection(() => w.target, w.env);
    settleOnSection(() => w.target, w.env);
    expect(w.queue).toHaveLength(1);
    expect(w.listeners.size).toBe(1);
  });

  it("a section that is gone ends the loop without a throw", () => {
    const w = world(3000);
    let there = true;
    settleOnSection(() => (there ? w.target : null), w.env);
    w.step(2);
    there = false;
    expect(() => w.step(5)).not.toThrow();
    expect(w.queue).toHaveLength(0);
  });
});

describe("followSectionLink hands the landing to the settle (P10-19)", () => {
  const press = () => ({ preventDefault: () => {} });
  const section = { scrollIntoView: () => {} };

  it("with the section on the page: the browser's own jump, then the settle", () => {
    const settled: Array<() => unknown> = [];
    followSectionLink(press(), "paper-section-4", () => {}, () => section, (find) => settled.push(find));
    expect(settled).toHaveLength(1);
    expect(settled[0]()).toBe(section);
  });

  it("with the body under the other tab: the jump runs when the body is on the page, and settles after it", () => {
    const order: string[] = [];
    const jobs: Array<() => void> = [];
    const mounted = { scrollIntoView: () => order.push("scroll") };
    followSectionLink(press(), "paper-section-4", (run) => jobs.push(run), () => (jobs.length > 0 ? mounted : null), () => order.push("settle"));
    expect(order).toEqual([]);
    jobs[0]();
    expect(order).toEqual(["scroll", "settle"]);
  });

  it("with no section and no way to reveal: nothing to settle", () => {
    const settled: unknown[] = [];
    followSectionLink(press(), "paper-section-9", undefined, () => null, () => settled.push(1));
    expect(settled).toEqual([]);
  });
});
