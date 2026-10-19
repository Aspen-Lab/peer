// Waits for what a test asserts, never for a number of timer ticks (P11-18, BACKLOG-97).
//
// The hook tests run a hook on `hook-runtime`, which renders once per round of five `setTimeout(0)` ticks, with
// real timers and a stubbed stream. A test that waits a fixed number of milliseconds, or that has its stub sleep
// between events, races that cadence: on a loaded machine a round is slow, two events are drawn as one, and a
// stub's hold ends before any render has drawn its stage. The page is slow then, not wrong. So a wait polls for
// the condition its assertion needs, with a ceiling of seconds, and a stub sends each event only after the page
// has drawn the one before.
//
// Use: call `pacing.draws += 1` in the render the test records; `await until(() => condition, "what", signal)`
// in a stub or an act; `await drawn(signal)` in a stub between events; `throwIfLapsed(opened.unmount)` after the
// page is driven, so a wait that ran out its ceiling fails the test naming what it waited for. `resetPacing()` in
// `beforeEach`, and `vi.setConfig({ testTimeout: TEST_TIMEOUT_MS })` at the top of the file so the runner's 5 s
// does not cut a slow machine off before the ceiling speaks. No dependency; no React; no DOM.

/** The longest any wait waits: generous, so a loaded machine is slow and not wrong. */
export const CEILING_MS = 20_000;
/** A test is several waits long at worst. */
export const TEST_TIMEOUT_MS = 3 * CEILING_MS;

export const pacing = {
  /** Renders of the page so far: what a stub paces its events on. */
  draws: 0,
  /** Waits that ran out their ceiling, named. */
  lapsed: [] as string[],
};

export function resetPacing() {
  pacing.draws = 0;
  pacing.lapsed.length = 0;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll `condition` on real timers until it holds: the wait for what an assertion needs. It stops when `signal`
 * aborts (the page was let go), and at the ceiling, which is recorded under `what` for `throwIfLapsed`.
 */
export async function until(condition: () => boolean, what: string, signal?: AbortSignal): Promise<boolean> {
  const stop = Date.now() + CEILING_MS;
  while (!condition()) {
    if (signal?.aborted) return false;
    if (Date.now() >= stop) {
      pacing.lapsed.push(what);
      return false;
    }
    await sleep(2);
  }
  return true;
}

/**
 * Resolves once the page has drawn again. The hook's own state change comes first (a stub calls this after an event
 * the hook has handled), so the render it waits for carries that event: each event is on the page before the next
 * one is sent, however slow the machine.
 */
export async function drawn(signal?: AbortSignal): Promise<void> {
  const from = pacing.draws;
  await until(() => pacing.draws > from, "the page to draw", signal);
}

/** After the page is driven: a wait that ran out the ceiling unmounts the page and fails the test, naming it. */
export function throwIfLapsed(unmount: () => void) {
  if (pacing.lapsed.length === 0) return;
  unmount();
  throw new Error(`timed out after ${CEILING_MS} ms waiting for: ${pacing.lapsed.join("; ")}`);
}
