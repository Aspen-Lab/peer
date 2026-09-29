"use client";

// TAB-ICON-THEME round 2 (ABC-JEV-INTEGRATION.md §1ae, ruling §1ak). The
// browser tab's own small square mark is a plain static file
// (web/public/icon.svg) and cannot see Peer's own colour setting on its
// own. This mounts once and keeps the hand-authored `<link id="peer-tab-
// icon">` in web/src/app/layout.tsx repainted in sync with the same
// mode/accent the masthead's Mark already follows — see lib/tab-icon.ts for
// the actual logic (tested there; this wrapper is untested for the same
// reason ThemeSync/ProfileSync/FeedSync are: it is a thin effect that only
// calls into already-tested lib code). Returns null: no visible output,
// nothing server-side, no layout shift.

import { useEffect } from "react";
import { startTabIconSync } from "@/lib/tab-icon";

export function TabIconSync() {
  useEffect(() => startTabIconSync(), []);
  return null;
}
