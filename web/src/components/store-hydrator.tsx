"use client";

import { useEffect } from "react";
import { useProfileStore } from "@/store/profile";
import { useFeedStore } from "@/store/feed";
import { useNotesStore } from "@/store/notes";

// The zustand stores use `persist({ skipHydration: true })` so they do NOT
// auto-load localStorage before React hydrates. That keeps the first client
// render identical to the server render (which never sees localStorage),
// avoiding hydration mismatches. We then load the persisted state here, in an
// effect that runs after hydration, which triggers a re-render with the saved
// values. Mount once near the root (in layout.tsx). The shell itself keeps no
// persisted state any more — the sidebar's open/closed flag went with the
// sidebar — so nothing here animates on load.
export function StoreHydrator() {
  useEffect(() => {
    useProfileStore.persist.rehydrate();
    useFeedStore.persist.rehydrate();
    useNotesStore.persist.rehydrate();
  }, []);

  return null;
}
