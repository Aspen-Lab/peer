"use client";

// What Jev did the last time a briefing was built, kept in this browser so the
// Profile row can say so ("Last briefing: 50 of 50 papers screened by Jev.").
//
// Counts and one status word, nothing else: never the key, never a paper. It is
// local to this browser, like the key it describes, and it describes ONE key: the
// profile store clears it (`updateJevApiKey`, `logOut`) when a key that was set is
// replaced or removed, and by a confirmed sign-out (which resets the profile and
// with it the key). It is NOT cleared when the profile merely rehydrates and the
// key appears from nothing, so a reload keeps the last report. This module imports
// nothing from the profile store (the dependency runs the other way). Same
// persist-with-skipHydration pattern as the other stores: the first client render
// matches the server's (no report), and <StoreHydrator/> loads the saved one after
// mount.

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type JevScreeningReport = {
  status: "applied" | "partial" | "unavailable" | "rejected";
  screened: number;
  of: number;
};

const STATUSES = new Set(["applied", "partial", "unavailable", "rejected"]);

function validReport(value: unknown): value is JevScreeningReport {
  if (!value || typeof value !== "object") return false;
  const report = value as Record<string, unknown>;
  return (
    typeof report.status === "string" &&
    STATUSES.has(report.status) &&
    typeof report.screened === "number" &&
    Number.isInteger(report.screened) &&
    report.screened >= 0 &&
    typeof report.of === "number" &&
    Number.isInteger(report.of) &&
    report.of >= 0
  );
}

interface JevScreeningState {
  report: JevScreeningReport | null;
  /** Keep what a briefing reported. Only the three known fields are kept; anything else in the response is dropped. */
  record: (report: JevScreeningReport) => void;
  clear: () => void;
}

export const useJevScreeningStore = create<JevScreeningState>()(
  persist(
    (set) => ({
      report: null,
      record: (report) => {
        if (!validReport(report)) return;
        set({ report: { status: report.status, screened: report.screened, of: report.of } });
      },
      clear: () => set({ report: null }),
    }),
    {
      name: "peer-jev-screening",
      version: 1,
      skipHydration: true,
      partialize: (state) => ({ report: state.report }) as JevScreeningState,
    },
  ),
);
