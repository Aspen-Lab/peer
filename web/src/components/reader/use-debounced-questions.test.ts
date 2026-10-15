import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P7-13 (R11b, the owner's R11): the page read the question store directly, so every keystroke in
// "Before you read" re-rendered the whole page — the route over all five questions, the term
// scan and every child (290-320 ms a key in the browser, P7-03 §10). `useDebouncedQuestions`
// gives the page its own copy of the store's questions, updated once the typing has paused for
// 250 ms. The field still writes every keystroke to the store (persistence is unchanged); only
// the page's reading of it waits. A settle is not a keystroke and goes through at once, so the
// deep report is asked the moment the reader presses Submit.
//
// The hook runs on the minimal hook runtime, which re-renders only while a mount is alive, so a
// scripted page keeps the mount going with a 1 ms poll (as `question-box.flow.test.tsx` does)
// and records each DISTINCT value the hook handed the page: a distinct value is a re-render of
// the page that matters, and the number of them is what the page pays.
//
// The clock is the test's (P9-46, BACKLOG-53). `setTimeout`, `clearTimeout` and `Date` are Vitest's
// fakes, and time moves only when `elapse` moves it, one millisecond at a time, letting the
// runtime's promises settle after each. The first version of this file waited on the real clock,
// so on a busy machine the gap between two scripted keys could grow past 250 ms and the debounce
// fired, as it should for that gap, in a test that said it never would. Now a gap is exactly the
// gap the script asked for, whatever else the machine is doing, and no assertion has a slack for
// a slow machine in it.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import { useEffect, useState } from "react";
import { hookRuntime } from "@/test-support/hook-runtime";
import { useReadingQuestionsStore, type PaperQuestions } from "@/store/reading-questions";
import { QUESTIONS_DEBOUNCE_MS, useDebouncedQuestions } from "./use-debounced-questions";

const PAPER = "openalex:W1";
const OTHER = "openalex:W2";
const AT = "2026-10-11T00:00:00.000Z";
const store = () => useReadingQuestionsStore.getState();

/**
 * Move the fake clock on by `ms` milliseconds, one at a time. After each, one turn of the real event
 * loop (`setImmediate` is not faked) lets every promise the runtime is awaiting run to its end, so
 * the runtime's own `setTimeout(…, 0)` settle steps and the page's polls advance in step with the
 * clock and with nothing else.
 */
async function elapse(ms: number): Promise<void> {
  for (let passed = 0; passed < ms; passed++) {
    vi.advanceTimersByTime(1);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

interface Live {
  /** Set once the reader has done everything the script holds: the poll stops and the mount ends. */
  over: boolean;
}

/** What keeps a mount alive: a 1 ms poll that re-renders the page until the script is over. */
function useKeepAlive(live: Live): void {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (live.over) return;
    const timer = setTimeout(() => setTick((n) => n + 1), 1);
    return () => clearTimeout(timer);
  }, [tick, live]);
}

/**
 * Mount `hook`, let `play` move the clock (and do what the reader does) while the mount is alive,
 * then let the mount finish its last round. Returns the finished mount, not yet unmounted.
 */
async function mountAndPlay<T>(hook: (live: Live) => T, play: () => Promise<void>, { maxRounds = 4000 } = {}) {
  const live: Live = { over: false };
  let finished = false;
  const mounting = hookRuntime.mount(() => hook(live), { maxRounds }).finally(() => {
    finished = true;
  });
  await play();
  live.over = true;
  // The last round: a few fake milliseconds. A mount that never ends is a bug in the test, not a wait.
  for (let spent = 0; !finished; spent++) {
    if (spent > maxRounds * 10) throw new Error("the mount did not finish");
    await elapse(1);
  }
  return mounting;
}

interface Seen {
  /** When the page was handed this value (the fake clock's time). */
  at: number;
  asked: PaperQuestions | undefined;
  byPaper: Record<string, PaperQuestions>;
}
type Step = (() => void) | { wait: number };
const wait = (ms: number): Step => ({ wait: ms });

/**
 * A page open on `paperId`, with a scripted reader: each step in turn, a function being what the
 * reader does at that instant and a wait being exactly that many milliseconds of the test's clock.
 * Returns every distinct value the hook handed the page, the first being what the page opened on.
 */
async function page(script: Step[], { paperId = PAPER, delayMs }: { paperId?: string; delayMs?: number } = {}) {
  const seen: Seen[] = [];
  const mounted = await mountAndPlay(
    (live) => {
      const value = useDebouncedQuestions(paperId, delayMs);
      if (seen.length === 0 || seen[seen.length - 1].byPaper !== value.byPaper) seen.push({ at: Date.now(), ...value });
      useKeepAlive(live);
      return value;
    },
    async () => {
      for (const step of script) {
        if (typeof step === "function") step();
        else await elapse(step.wait);
      }
    },
  );
  mounted.unmount();
  return { seen, updates: seen.length - 1, last: seen[seen.length - 1] };
}

/** Wait for the pause to be over: the debounce, and room for the page's next render round. */
const pause = wait(QUESTIONS_DEBOUNCE_MS + 150);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useDebouncedQuestions — a page that does not follow every keystroke", () => {
  it("the delay is 250 ms", () => {
    expect(QUESTIONS_DEBOUNCE_MS).toBe(250);
  });

  it("opens on what the store holds: this paper's entry, and the whole map for the examples", async () => {
    store().set(PAPER, ["Does tungsten delay rafting?"], false, AT);
    store().set(OTHER, ["Why 1100 C?"], false, AT);
    const { seen } = await page([wait(20)]);

    expect(seen[0].asked?.items).toEqual(["Does tungsten delay rafting?"]);
    expect(Object.keys(seen[0].byPaper).sort()).toEqual([PAPER, OTHER]);
  });

  it("has no entry for a paper with no questions", async () => {
    const { seen } = await page([wait(20)]);

    expect(seen[0].asked).toBeUndefined();
  });

  it("five rapid sets produce one update, 250 ms after the last", async () => {
    let lastSet = 0;
    const key = (text: string): Step => () => {
      store().set(PAPER, [text], false, AT);
      lastSet = Date.now();
    };
    const { seen, updates } = await page([
      wait(20),
      key("D"),
      wait(5),
      key("Do"),
      wait(5),
      key("Does"),
      wait(5),
      key("Does tung"),
      wait(5),
      key("Does tungsten delay rafting?"),
      pause,
    ]);

    // One update for five keys…
    expect(updates).toBe(1);
    // …carrying the last…
    expect(seen[1].asked?.items).toEqual(["Does tungsten delay rafting?"]);
    // …no sooner than 250 ms after it (the clock is the test's: no slack for timers firing early),
    // and not much later.
    expect(seen[1].at - lastSet).toBeGreaterThanOrEqual(QUESTIONS_DEBOUNCE_MS);
    expect(seen[1].at - lastSet).toBeLessThan(QUESTIONS_DEBOUNCE_MS + 150);
  });

  it("each set starts the wait afresh: keys less than 250 ms apart never update", async () => {
    const key = (n: number): Step => () => store().set(PAPER, [`question ${n}`], false, AT);
    // Four keys 150 ms apart: 450 ms since the first, yet never 250 ms since the last until the end.
    const { updates } = await page([wait(20), key(0), wait(150), key(1), wait(150), key(2), wait(150), key(3), wait(150)]);

    expect(updates).toBe(0);
  });

  // P9-46: the other side of the test above. That one passes just as well for a hook that never
  // updates; this one needs the update to come, once per gap of 250 ms or more, and to carry the key
  // before its gap.
  it("keys 250 ms or more apart each update: the wait is per key, and what it carries is the key before the gap", async () => {
    const key = (n: number): Step => () => store().set(PAPER, [`question ${n}`], false, AT);
    const { seen, updates } = await page([wait(20), key(0), wait(300), key(1), wait(300), key(2), pause]);

    expect(updates).toBe(3);
    expect(seen.slice(1).map((s) => s.asked?.items)).toEqual([["question 0"], ["question 1"], ["question 2"]]);
  });

  it("the store has every keystroke at once, though the page does not", async () => {
    const seenInStore: string[][] = [];
    const key = (text: string): Step => () => {
      store().set(PAPER, [text], false, AT);
      seenInStore.push(store().byPaper[PAPER].items);
    };
    const { updates } = await page([wait(20), key("Does"), key("Does tungsten"), key("Does tungsten delay")]);

    expect(seenInStore).toEqual([["Does"], ["Does tungsten"], ["Does tungsten delay"]]);
    expect(updates).toBe(0);
  });

  it("takes the latest state when it updates, not the state of the first change", async () => {
    const { last } = await page([
      wait(20),
      () => store().set(PAPER, ["first"], false, AT),
      wait(40),
      () => store().set(PAPER, ["first, then more"], false, AT),
      pause,
    ]);

    expect(last.asked?.items).toEqual(["first, then more"]);
  });

  it("the delay is a parameter", async () => {
    const { updates, last } = await page([wait(20), () => store().set(PAPER, ["quick"], false, AT), wait(150)], { delayMs: 30 });

    expect(updates).toBe(1);
    expect(last.asked?.items).toEqual(["quick"]);
  });
});

describe("a settle goes through at once", () => {
  it("Submit (a settle) is on the page without the wait, with the typed questions in the same update", async () => {
    let settledAt = 0;
    const { seen, updates } = await page([
      wait(20),
      () => store().set(PAPER, ["Does tungsten delay rafting?"], false, AT),
      () => {
        store().settle(PAPER);
        settledAt = Date.now();
      },
      wait(60),
    ]);

    expect(updates).toBe(1);
    expect(seen[1].asked?.settled).toEqual(["Does tungsten delay rafting?"]);
    expect(seen[1].asked?.items).toEqual(["Does tungsten delay rafting?"]);
    expect(seen[1].at - settledAt).toBeLessThan(QUESTIONS_DEBOUNCE_MS / 2);
  });

  it("clearing every line of a settled paper (the entry goes) reaches the page at once", async () => {
    store().set(PAPER, ["Does tungsten delay rafting?"], false, AT);
    store().settle(PAPER);
    const { seen, updates } = await page([wait(20), () => store().set(PAPER, [""], false, AT), wait(60)]);

    expect(seen[0].asked?.settled).toEqual(["Does tungsten delay rafting?"]);
    expect(updates).toBe(1);
    expect(seen[1].asked).toBeUndefined();
  });

  it("a store replaced with a settled set (the rehydration after mount) reaches the page at once", async () => {
    const { seen, updates } = await page([
      wait(20),
      () =>
        useReadingQuestionsStore.setState({
          byPaper: { [PAPER]: { items: ["From the last visit?"], settled: ["From the last visit?"], gist: false, updatedAt: AT } },
        }),
      wait(60),
    ]);

    expect(updates).toBe(1);
    expect(seen[1].asked?.settled).toEqual(["From the last visit?"]);
  });

  it("a settle takes the wait a keystroke had started with it: one update, not two", async () => {
    const { updates } = await page([
      wait(20),
      () => store().set(PAPER, ["Does tungsten delay rafting?"], false, AT),
      wait(30),
      () => store().settle(PAPER),
      pause,
    ]);

    expect(updates).toBe(1);
  });
});

describe("what does not move the page", () => {
  it("another paper's questions change the map after the wait and leave this paper's entry the same object", async () => {
    store().set(PAPER, ["Does tungsten delay rafting?"], false, AT);
    const { seen, updates } = await page([wait(20), () => store().set(OTHER, ["Why 1100 C?"], false, AT), pause]);

    expect(updates).toBe(1);
    expect(seen[1].asked).toBe(seen[0].asked);
    expect(Object.keys(seen[1].byPaper)).toContain(OTHER);
  });

  it("a store change that leaves the questions alone makes no update", async () => {
    store().set(PAPER, ["Does tungsten delay rafting?"], false, AT);
    const { updates } = await page([wait(20), () => useReadingQuestionsStore.setState({ lastPaperId: "somewhere-else" }), pause]);

    expect(updates).toBe(0);
  });

  it("opening and waiting with nothing changed makes no update", async () => {
    store().set(PAPER, ["Does tungsten delay rafting?"], false, AT);
    const { updates } = await page([pause]);

    expect(updates).toBe(0);
  });
});

describe("a change between the first render and the subscription is not lost", () => {
  it("is picked up after the wait", async () => {
    let first = true;
    const seen: Array<PaperQuestions | undefined> = [];
    const mounted = await mountAndPlay(
      (live) => {
        const value = useDebouncedQuestions(PAPER);
        if (first) {
          first = false;
          // The store is rehydrated after the page's first render and before its effects subscribe.
          useReadingQuestionsStore.setState({ byPaper: { [PAPER]: { items: ["Hydrated?"], gist: false, updatedAt: AT } } });
        }
        useKeepAlive(live);
        seen.push(value.asked);
        return value;
      },
      () => elapse(QUESTIONS_DEBOUNCE_MS + 150),
    );
    mounted.unmount();

    expect(seen[0]).toBeUndefined();
    expect(seen[seen.length - 1]?.items).toEqual(["Hydrated?"]);
  });
});

describe("leaving the page", () => {
  it("unsubscribes from the store", async () => {
    const real = useReadingQuestionsStore.subscribe;
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    const subscribe = vi.spyOn(useReadingQuestionsStore, "subscribe").mockImplementation((listener) => {
      const stop = vi.fn(real(listener));
      stops.push(stop);
      return stop;
    });
    await page([wait(20)]);

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toHaveBeenCalledTimes(1);
  });

  it("a wait in progress at the unmount never fires: the page is not asked to update once it is gone", async () => {
    const getState = vi.spyOn(useReadingQuestionsStore, "getState");
    // The last step starts a wait; the page is unmounted a few milliseconds later, long before 250 ms.
    const { updates } = await page([wait(20), () => store().set(PAPER, ["Does tungsten"], false, AT)]);
    const reads = getState.mock.calls.length;

    // A timer that survived the unmount would read the store when it fired.
    await elapse(QUESTIONS_DEBOUNCE_MS + 100);

    expect(updates).toBe(0);
    expect(getState.mock.calls.length).toBe(reads);
  });
});

describe("the paper it is given", () => {
  it("reads this paper's entry from the map it holds, and follows the id when the id changes", async () => {
    store().set(PAPER, ["On the first paper?"], false, AT);
    store().set(OTHER, ["On the second paper?"], false, AT);
    const asked: Array<string | undefined> = [];
    const mounted = await mountAndPlay(
      () => {
        // The id is the first paper for the first polls, then the second.
        const [tick, setTick] = useState(0);
        const id = tick < 30 ? PAPER : OTHER;
        const value = useDebouncedQuestions(id);
        asked.push(value.asked?.items[0]);
        useEffect(() => {
          if (tick > 40) return;
          const timer = setTimeout(() => setTick((n) => n + 1), 1);
          return () => clearTimeout(timer);
        }, [tick]);
        return value;
      },
      // Nothing for the reader to do: the page's own polls end the mount, 41 of them.
      () => Promise.resolve(),
      { maxRounds: 400 },
    );
    mounted.unmount();

    expect(asked[0]).toBe("On the first paper?");
    expect(asked[asked.length - 1]).toBe("On the second paper?");
  });
});
