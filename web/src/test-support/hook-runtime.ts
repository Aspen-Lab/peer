// A minimal hook runtime for tests that need a hook's EFFECTS to run.
//
// This project's Vitest runs in plain Node: no DOM, no @testing-library, and
// `react-dom/server` never runs effects — so a hook test mounted that way can
// show what a hook reads during render, never what it requests or writes in
// its effects. P0-06 (§1e.2, A's F2) needs the second half: "the second open
// of a private PDF makes no request" lives in the effect. This stands in for
// React's state hooks just enough to run a hook the way a page open does:
// render, run the effects, let their promises settle, re-render on a state
// change, repeat until nothing changes. Adapted from A's P0-04 probe
// `p3-hooks`. No dependency; no React scheduler, no DOM, no browser — it
// exercises the hook's own code and nothing else.
//
// Use: in the test file,
//
//   vi.mock("react", async (importOriginal) => {
//     const actual = await importOriginal<typeof import("react")>();
//     const { hookRuntime } = await import("@/test-support/hook-runtime");
//     return { ...actual, ...hookRuntime.hooks };
//   });
//   import { hookRuntime } from "@/test-support/hook-runtime";
//   const opened = await hookRuntime.mount(() => useSomething(args));
//   opened.unmount();
//
// Each `mount` is a fresh component instance (a fresh page open); anything a
// test stubs outside React — `localStorage`, `fetch` — persists across mounts
// for as long as the test keeps it.

type Deps = readonly unknown[] | undefined;

interface Slot {
  value?: unknown;
  deps?: Deps;
  current?: unknown;
  cleanup?: () => void;
}

function depsChanged(previous: Deps, next: Deps): boolean {
  if (!previous || !next || previous.length !== next.length) return true;
  return previous.some((value, index) => !Object.is(value, next[index]));
}

export interface Mounted<T> {
  /** What the hook returned on its last render. */
  value: T;
  /** Run every effect's cleanup, as an unmount does. */
  unmount: () => void;
}

export function createHookRuntime() {
  let slots: Slot[] = [];
  let index = 0;
  let pending: Array<() => void> = [];
  let dirty = false;

  const hooks = {
    useState<T>(initial: T | (() => T)): [T, (next: T | ((previous: T) => T)) => void] {
      const at = index++;
      if (!slots[at]) {
        slots[at] = { value: typeof initial === "function" ? (initial as () => T)() : initial };
      }
      const slot = slots[at];
      const set = (next: T | ((previous: T) => T)) => {
        const value = typeof next === "function" ? (next as (previous: T) => T)(slot.value as T) : next;
        if (!Object.is(value, slot.value)) {
          slot.value = value;
          dirty = true;
        }
      };
      return [slot.value as T, set];
    },

    useMemo<T>(compute: () => T, deps: Deps): T {
      const at = index++;
      if (!slots[at] || depsChanged(slots[at].deps, deps)) slots[at] = { value: compute(), deps };
      return slots[at].value as T;
    },

    useCallback<T>(callback: T, deps: Deps): T {
      return hooks.useMemo(() => callback, deps);
    },

    useRef<T>(initial: T): { current: T } {
      const at = index++;
      if (!slots[at]) slots[at] = { current: initial };
      return slots[at] as { current: T };
    },

    useEffect(effect: () => void | (() => void), deps?: Deps): void {
      const at = index++;
      const previous = slots[at];
      if (previous && !depsChanged(previous.deps, deps)) return;
      const slot: Slot = { deps };
      slots[at] = slot;
      pending.push(() => {
        previous?.cleanup?.();
        const cleanup = effect();
        slot.cleanup = typeof cleanup === "function" ? cleanup : undefined;
      });
    },

    useLayoutEffect(effect: () => void | (() => void), deps?: Deps): void {
      hooks.useEffect(effect, deps);
    },
  };

  /** Let promises and timers queued by the effects run. */
  async function settle(): Promise<void> {
    for (let tick = 0; tick < 5; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  /** One page open: render, run effects, re-render until nothing changes. */
  async function mount<T>(hook: () => T, { maxRounds = 30 } = {}): Promise<Mounted<T>> {
    slots = [];
    pending = [];
    dirty = false;
    let value!: T;
    const render = () => {
      index = 0;
      value = hook();
    };
    render();
    for (let round = 0; round < maxRounds; round++) {
      const effects = pending.splice(0);
      effects.forEach((run) => run());
      await settle();
      if (dirty || pending.length > 0) {
        dirty = false;
        render();
        continue;
      }
      break;
    }
    const mounted = slots;
    return { value, unmount: () => mounted.forEach((slot) => slot?.cleanup?.()) };
  }

  return { hooks, mount };
}

/** The runtime a test file's `vi.mock("react")` and its test body share. */
export const hookRuntime = createHookRuntime();
