"use client";

// One line that stays on the home page after the sample card is gone (P7-16,
// the owner's R12).
//
// The card (`starter-strip.tsx`) is the home page's only mention of a key, and
// the first tap on a field removes it for good — so a reader who tapped, and
// never opened the longer setup, had nothing left on the page that said a key
// exists. This takes the card's place in the page's flow: "Add a key to turn
// on the model", linking to the key step, until a key exists or the reader
// sends it away. It asks once and is quiet about it: no colour, no motion, and
// a dismissal that is remembered in this browser (`lib/briefing/key-hint.ts`).
//
// On a server render, and on the first client paint, it renders nothing — the
// browser has not been asked whether the reader sent it away, and a row that
// flashes in for a reader who dismissed it is worse than one a frame late.

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { useProfileStore } from "@/store/profile";
import { hasUserLlmOverride } from "@/lib/feed/ai-tier";
import { IconX } from "@/components/icons";
import { KEY_HINT } from "@/lib/briefing/copy";
import {
  KEY_HINT_EVENT,
  readKeyHintDismissed,
  shouldShowKeyHint,
  writeKeyHintDismissed,
} from "@/lib/briefing/key-hint";
import { ADD_KEY_HREF } from "@/lib/navigation/add-key-destination";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(KEY_HINT_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(KEY_HINT_EVENT, onChange);
  };
}

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The row itself: the link, and the way out. */
export function KeyHintRow({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="flex items-center gap-3 border-l border-border-strong pl-3 text-meta sm:text-body-sm">
      <Link
        href={ADD_KEY_HREF}
        className="min-w-0 truncate text-text-muted underline decoration-border-strong underline-offset-4 transition-colors hover:text-heading"
      >
        {KEY_HINT.line}
      </Link>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={KEY_HINT.dismiss}
        className="ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center text-text-faint transition-colors hover:text-heading"
      >
        <IconX size={12} />
      </button>
    </div>
  );
}

export function KeyHint() {
  const hasKey = useProfileStore((s) => hasUserLlmOverride(s.profile));
  const dismissed = useSyncExternalStore(
    subscribe,
    () => readKeyHintDismissed(browserStorage()),
    () => true,
  );

  if (!shouldShowKeyHint({ hasKey, dismissed })) return null;

  return (
    <KeyHintRow
      onDismiss={() => {
        writeKeyHintDismissed(browserStorage());
        window.dispatchEvent(new Event(KEY_HINT_EVENT));
      }}
    />
  );
}
