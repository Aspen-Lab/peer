"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UIState {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
    }),
    // skipHydration: the persisted value is loaded after mount (see
    // <StoreHydrator/>), so the first client render matches the server's
    // default state. Without this, persist rehydrates synchronously before
    // React hydrates and the saved sidebar state mismatches the SSR markup.
    { name: "peer-ui", skipHydration: true },
  ),
);
