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
  const arrivals = new Set<() => void>();
  const pictures = { above: 0, below: 0 };
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
    onArrive: (run) => {
      arrivals.add(run);
      return () => void arrivals.delete(run);
    },
    pendingAbove: () => pictures.above,
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
  /** A picture somewhere on the page arrives. */
  const arrive = () => [...arrivals].forEach((run) => run());
  return { scene, calls, queue, listeners, arrivals, pictures, arrive, target, env, step, top: () => scene.docTop - scene.y };
}

/** The browser's smooth jump: `frames` frames from where the page is to where the heading stood at the press. */
function smoothJump(w: ReturnType<typeof world>, frames: number) {
  const from = w.scene.y;
  const to = w.scene.docTop - MARGIN;
  return (frame: number) => {
    if (frame <= frames) w.scene.y = from + ((to - from) * frame) / frames;
  };
}

describe("settleOnSection (P10-19, X-A7)", () => {
  it("scrolls to the heading again when the layout grew above it during the jump, and stops there", () => {
    const w = world(3000);
    const travel = smoothJump(w, 20);
    settleOnSection(() => w.target, w.env);
    w.step(120, (frame) => {
      travel(frame);
      if (frame === 22) w.scene.docTop += 1200; // the figures above the heading loaded as the page passed them
    });
    expect(w.top()).toBe(MARGIN);
    expect(w.calls.length).toBeGreaterThan(0);
    expect(w.calls.length).toBeLessThanOrEqual(3);
    expect(w.calls.every((options) => options?.block === "start" && options.behavior === "instant")).toBe(true);
    expect(w.queue).toHaveLength(0); // a second after the page came to rest the loop is over
  });

  it("follows a layout that grows more than once, also after it has landed (a picture that arrives late)", () => {
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
    w.step(120);
    expect(w.top()).toBe(MARGIN);
    expect(w.queue).toHaveLength(0);
    expect(w.calls.length).toBeLessThanOrEqual(1);
  });

  it("is capped: a layout that never stops growing ends the loop about a second after the page came to rest", () => {
    const w = world(3000);
    const travel = smoothJump(w, 20);
    let ended: number | null = null;
    settleOnSection(() => w.target, w.env);
    w.step(400, (frame) => {
      travel(frame);
      if (frame % 6 === 0) w.scene.docTop += 100; // a picture arrives every sixth frame, for ever
      if (w.queue.length === 0 && ended === null) ended = w.scene.t;
    });
    expect(w.queue).toHaveLength(0);
    expect(w.calls.length).toBeGreaterThan(0);
    expect(w.calls.length).toBeLessThan(40);
    expect(ended).not.toBeNull();
    expect(ended as unknown as number).toBeLessThan(20 * FRAME + 8 * FRAME + 1000 + 8 * FRAME);
  });

  it("a picture that arrives after the watching by frames is over lands the heading again, for ten seconds", () => {
    const w = world(3000);
    const travel = smoothJump(w, 20);
    settleOnSection(() => w.target, w.env);
    w.step(120, travel);
    expect(w.queue).toHaveLength(0);
    expect(w.top()).toBe(MARGIN);
    const settled = w.calls.length;
    w.arrive(); // a picture that changed nothing
    w.step(80);
    expect(w.calls.length).toBe(settled);
    w.scene.docTop -= 103; // a figure above the heading came in shorter than its room
    w.arrive();
    expect(w.top()).toBe(MARGIN - 103); // the layout has not been looked at yet: by frames, not at the event
    w.step(80);
    expect(w.top()).toBe(MARGIN);
    expect(w.calls.length).toBe(settled + 1);
    expect(w.queue).toHaveLength(0);
    w.scene.t += 11000;
    w.scene.docTop += 300;
    w.arrive(); // too late: the loop ends and does not move the page
    w.step(20);
    expect(w.calls.length).toBe(settled + 1);
    expect(w.arrivals.size).toBe(0);
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
    expect(w.arrivals.size).toBe(0);
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

// P10-26 (A's X-A8): the heading was landed, and a picture above it came in shorter than its room after the settle's
// watching by frames was over — the page moved in front of the reader. The settle does not declare the landing final
// while a picture above the heading is still loading: it goes on looking at the heading by frames (within the same
// ten seconds), and lands it once more after the pictures have settled. A picture below the heading changes nothing.
describe("settleOnSection waits for the pictures above the heading (P10-26, X-A8)", () => {
  it("a picture above is still loading when the watch would end: the heading is looked at until it arrives, then lands once more", () => {
    const w = world(3000);
    const travel = smoothJump(w, 20);
    w.pictures.above = 1;
    settleOnSection(() => w.target, w.env);
    w.step(120, travel); // 2 s: the jump, the rest, and well past the 1 s watch
    expect(w.top()).toBe(MARGIN);
    const settled = w.calls.length;
    expect(w.queue).toHaveLength(1); // still watching: not final while the picture is on the way
    w.scene.docTop -= 103; // the picture came in shorter than its room...
    w.pictures.above = 0; // ...and has settled — no load event reached the settle
    w.step(20);
    expect(w.top()).toBe(MARGIN);
    expect(w.calls.length).toBe(settled + 1);
    w.step(120);
    expect(w.queue).toHaveLength(0); // and once the pictures have settled the watch ends
    expect(w.calls.length).toBe(settled + 1);
  });

  it("a picture that settles above the heading moves it: it is landed again on the first frame that sees it, not after three still ones", () => {
    const w = world(3000);
    const travel = smoothJump(w, 20);
    w.pictures.above = 1;
    settleOnSection(() => w.target, w.env);
    w.step(60, travel);
    expect(w.top()).toBe(MARGIN);
    const settled = w.calls.length;
    w.scene.docTop -= 103; // the picture came in shorter than its room: the next frame finds the heading moved...
    w.pictures.above = 0;
    w.step(1);
    expect(w.calls.length).toBe(settled + 1); // ...and lands it at once (three held frames would be the page twitching)
    expect(w.top()).toBe(MARGIN);
  });

  it("while the smooth scroll is still travelling, a picture pending above does not make the settle jump", () => {
    const w = world(3000);
    const travel = smoothJump(w, 40);
    w.pictures.above = 1;
    settleOnSection(() => w.target, w.env);
    w.step(39, travel);
    expect(w.calls).toEqual([]);
  });

  it("a picture below the heading is not waited for: the loop ends a second after the rest, as it did", () => {
    const w = world(3000);
    const travel = smoothJump(w, 20);
    w.pictures.below = 1; // the world's `pendingAbove` counts only what is above the heading
    settleOnSection(() => w.target, w.env);
    w.step(120, travel);
    expect(w.queue).toHaveLength(0);
    const settled = w.calls.length;
    w.scene.docTop -= 103;
    w.step(40);
    expect(w.calls.length).toBe(settled); // no more landing: nothing above was pending
  });

  it("the wait is capped at the ten seconds the late arrivals have, and the reader's input ends it at once", () => {
    const w = world(3000);
    const travel = smoothJump(w, 20);
    w.pictures.above = 1; // a picture that never arrives
    settleOnSection(() => w.target, w.env);
    w.step(900, travel); // 14 s of frames
    expect(w.queue).toHaveLength(0);
    const again = world(3000);
    again.pictures.above = 1;
    settleOnSection(() => again.target, again.env);
    again.step(130, smoothJump(again, 20));
    expect(again.queue).toHaveLength(1);
    for (const stop of [...again.listeners]) stop();
    expect(again.queue).toHaveLength(0);
  });

  it("a settle env with no picture count (the old one) behaves as it did", () => {
    const w = world(3000);
    const env: SettleEnv = { ...w.env, pendingAbove: undefined };
    settleOnSection(() => w.target, env);
    w.step(120, smoothJump(w, 20));
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
