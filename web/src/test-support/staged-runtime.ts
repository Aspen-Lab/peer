// A staged hook runtime: `hook-runtime.ts`, with the order of React's cycle in the TEST's hands.
//
// `hook-runtime.ts` runs a component's effects the moment it has rendered, so no gesture can ever
// arrive between a commit and the flush of that commit's passive effects. In a browser it can: React
// commits a render that no event started (a parent's re-render after a timer) and runs that commit's
// `useEffect`s as a task of their own, a little later; an event that is already waiting runs first.
// P9-07 (B): that gap is where the question box lost the focus it had just handed to a new line
// (`question-field.focus.test.tsx`). This runtime keeps the three steps apart:
//
//   rerender()   a render nothing discrete started: refs attach and layout effects run at once
//                (the commit), the passive effects WAIT.
//   flush()      the scheduler's task that runs the waiting passive effects.
//   event(fn)    a discrete event, as React 19 handles one: `fn` runs; if it set state, React flushes
//                the waiting passive effects of the earlier commit, renders, commits, and — the render
//                being a discrete one — runs its passive effects before the next event.
//
// Checked against real React in Chromium (19.2.4 and the 19.3.0-canary Next vendors; the order of the
// three, with a logging effect), not against its source. `useLayoutEffect` is a layout effect here, unlike `hook-runtime.ts`, where it is
// an alias of `useEffect`. No dependency, no DOM: a test says what the DOM would do in `onCommit`.
//
// Use, as `hook-runtime.ts`: `vi.mock("react", ...)` merging `stagedRuntime.hooks`, then
// `stagedRuntime.mount(() => Component(props), onCommit)`.

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

export function createStagedRuntime() {
  let slots: Slot[] = [];
  let index = 0;
  let dirty = false;
  let layout: Array<() => void> = [];
  let passive: Array<() => void> = [];
  let component: (() => unknown) | null = null;
  let onCommit: (output: unknown) => void = () => {};
  let output: unknown;

  const effectHook = (queue: () => Array<() => void>) =>
    (effect: () => void | (() => void), deps?: Deps): void => {
      const at = index++;
      const previous = slots[at];
      if (previous && !depsChanged(previous.deps, deps)) return;
      const slot: Slot = { deps };
      slots[at] = slot;
      queue().push(() => {
        previous?.cleanup?.();
        const cleanup = effect();
        slot.cleanup = typeof cleanup === "function" ? cleanup : undefined;
      });
    };

  const hooks = {
    useState<T>(initial: T | (() => T)): [T, (next: T | ((previous: T) => T)) => void] {
      const at = index++;
      if (!slots[at]) slots[at] = { value: typeof initial === "function" ? (initial as () => T)() : initial };
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
    useEffect: effectHook(() => passive),
    useLayoutEffect: effectHook(() => layout),
  };

  /** A render and its commit: the test attaches refs in `onCommit`, then the layout effects run. */
  function render(): void {
    index = 0;
    dirty = false;
    output = component!();
    onCommit(output);
    layout.splice(0).forEach((run) => run());
  }

  function flush(): void {
    passive.splice(0).forEach((run) => run());
  }

  return {
    hooks,
    /** Render and commit once; the passive effects of that first commit are still waiting. */
    mount<T>(hook: () => T, commit: (output: T) => void = () => {}) {
      slots = [];
      layout = [];
      passive = [];
      dirty = false;
      component = hook;
      onCommit = commit as (output: unknown) => void;
      render();
      return {
        get value(): T {
          return output as T;
        },
        unmount: () => slots.forEach((slot) => slot?.cleanup?.()),
      };
    },
    /** A render no discrete event started: its passive effects wait for `flush()`. */
    rerender: render,
    flush,
    /** A discrete event (a key, an input): the handler, then — if it set state — React's render. */
    event(handler: () => void): void {
      handler();
      if (!dirty) return;
      flush();
      render();
      flush();
    },
  };
}

/** The runtime a test file's `vi.mock("react")` and its test body share. */
export const stagedRuntime = createStagedRuntime();
