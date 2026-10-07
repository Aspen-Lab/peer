"use client";

import { useEffect } from "react";
import { useProfileStore } from "@/store/profile";
import { useFeedStore } from "@/store/feed";
import { useJevScreeningStore } from "@/store/jev-screening";
import { useNotesStore } from "@/store/notes";
import { useReadingPrefsStore } from "@/store/reading-prefs";
import { useReadingQuestionsStore } from "@/store/reading-questions";
import { useExplainThreadsStore } from "@/store/explain-threads";
import { usePlainRewritesStore } from "@/store/plain-rewrites";

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
    useJevScreeningStore.persist.rehydrate();
    useNotesStore.persist.rehydrate();
    useReadingPrefsStore.persist.rehydrate();
    useReadingQuestionsStore.persist.rehydrate();
    useExplainThreadsStore.persist.rehydrate();
    usePlainRewritesStore.persist.rehydrate();
  }, []);

  return null;
}
