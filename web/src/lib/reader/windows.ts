// P10-09a (review 7.1a; ruling §1h.78): the floating windows at the right of the reading page, as one small store.
// A sticky note opens one; the page's other windows (the notes window of P10-09b, the explain window) join the
// stack in the next round, so their kinds are in the type already. Nothing here is persisted: a reload closes
// every window, and what a window wrote is already in the paper's note.
//
// `order` is the stacking: the window raised last has the highest, and stands in front.

import { create } from "zustand";

export type WindowKind = "sticky" | "notes" | "explain";

export interface FloatingWindow {
  /** A sticky's is its header block's id in the paper's note. */
  id: string;
  kind: WindowKind;
  title: string;
  order: number;
}

interface WindowsState {
  windows: FloatingWindow[];
  /** The last `order` handed out. */
  clock: number;
  /** Open a window, or raise it (and retitle it) when it is open already. */
  open: (window: Pick<FloatingWindow, "id" | "kind" | "title">) => void;
  close: (id: string) => void;
  raise: (id: string) => void;
}

export const useWindows = create<WindowsState>()((set) => ({
  windows: [],
  clock: 0,
  open: (next) =>
    set((s) => {
      const order = s.clock + 1;
      const exists = s.windows.some((w) => w.id === next.id);
      const windows = exists
        ? s.windows.map((w) => (w.id === next.id ? { ...w, title: next.title, order } : w))
        : [...s.windows, { ...next, order }];
      return { windows, clock: order };
    }),
  close: (id) => set((s) => (s.windows.some((w) => w.id === id) ? { windows: s.windows.filter((w) => w.id !== id) } : s)),
  raise: (id) =>
    set((s) => {
      if (!s.windows.some((w) => w.id === id)) return s;
      const order = s.clock + 1;
      return { windows: s.windows.map((w) => (w.id === id ? { ...w, order } : w)), clock: order };
    }),
}));
