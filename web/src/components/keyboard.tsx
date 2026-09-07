"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useFeedStore } from "@/store/feed";
import { NONE, indexAfterRemoval, stepIndex } from "@/lib/navigation/card-focus";
import { readerActions, resolvePaperKey } from "@/lib/reader/reader-keys";
import { helpGroups } from "@/lib/keys/help";
import { searchKeyTarget } from "@/lib/shell/masthead";
import { Kbd } from "@/components/ui/kbd";
import { VersionLine } from "@/components/shell/version-line";

// ── Global keyboard shortcut registry ──
//
// The help sheet's groups live in `lib/keys/help.ts`: the briefing's keys
// written there, the reading page's from its own table, so the sheet cannot
// list a key a page does not answer to.
const GROUPS = helpGroups();

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

// Enter on a focused button or link already activates it; the reading page's
// `o`/Enter must not open the source on top of that.
function isActivationTarget(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "BUTTON" || tag === "A" || tag === "SUMMARY";
}

function onPaperPage(): boolean {
  return window.location.pathname.startsWith("/papers/");
}

/**
 * Runs the reading page's handler for `key` when the page registered one.
 * Nothing registered — the page is not mounted, or a deep link left `next`
 * out — and the key is inert here, free to fall through to the global keys.
 */
function runReaderKey(key: string, e: KeyboardEvent): boolean {
  const action = resolvePaperKey(key);
  const run = action ? readerActions()?.[action] : undefined;
  if (!run) return false;
  run();
  e.preventDefault();
  return true;
}

export function KeyboardLayer() {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);
  const [awaitingG, setAwaitingG] = useState(false);
  const loadFeed = useFeedStore((s) => s.loadFeed);
  const undoDismiss = useFeedStore((s) => s.undoDismiss);
  const pendingDismissal = useFeedStore((s) => s.pendingDismissal);

  // ── Card focus on the briefing ──
  // The ring is a DOM attribute, the index a ref: no React state, so moving
  // between ten cards re-renders nothing. The list is read from the DOM on
  // each press, in document order — which, in a CSS-columns masonry, is the
  // column-major reading order j/k should follow.
  const focusedRef = useRef<number>(NONE);

  const cardEls = () =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-paper-id]"));

  const paintFocus = useCallback((index: number) => {
    const els = cardEls();
    els.forEach((el, i) => {
      if (i === index) el.setAttribute("data-focused", "true");
      else el.removeAttribute("data-focused");
    });
    focusedRef.current = index;
    const el = els[index];
    if (el) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    }
  }, []);

  // Stable like paintFocus: it reads a ref and the store getter, nothing
  // from render scope.
  const focusedPaper = useCallback(() => {
    const el = cardEls()[focusedRef.current];
    const id = el?.getAttribute("data-paper-id");
    if (!id) return null;
    return useFeedStore.getState().papers.find((p) => p.id === id) ?? null;
  }, []);

  // Clear pending `g` chord after 1.5s
  useEffect(() => {
    if (!awaitingG) return;
    const t = window.setTimeout(() => setAwaitingG(false), 1500);
    return () => window.clearTimeout(t);
  }, [awaitingG]);

  const handler = useCallback(
    (e: KeyboardEvent) => {
      // Allow Esc globally even when typing
      if (e.key === "Escape") {
        if (helpOpen) {
          setHelpOpen(false);
          e.preventDefault();
          return;
        }
        const active = document.activeElement;
        if (active instanceof HTMLElement && isTypingTarget(active)) {
          active.blur();
          e.preventDefault();
          return;
        }
        // On a paper, Esc is "back to the briefing" — once the help sheet and
        // any focused field have had their turn.
        if (onPaperPage() && runReaderKey(e.key, e)) return;
        if (focusedRef.current !== NONE) {
          paintFocus(NONE);
          e.preventDefault();
        }
        return;
      }

      // Don't hijack typing
      if (isTypingTarget(e.target)) return;

      // Ignore modifier combos
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Two-key `g` chord
      if (awaitingG) {
        if (e.key === "h") {
          router.push("/");
          setAwaitingG(false);
          e.preventDefault();
          return;
        }
        if (e.key === "s") {
          router.push("/saved");
          setAwaitingG(false);
          e.preventDefault();
          return;
        }
        if (e.key === "p") {
          router.push("/profile");
          setAwaitingG(false);
          e.preventDefault();
          return;
        }
        setAwaitingG(false);
        return;
      }

      // Card-level keys — the briefing only.
      if (window.location.pathname === "/") {
        const els = cardEls();
        if (e.key === "j" || e.key === "ArrowDown") {
          paintFocus(stepIndex(focusedRef.current, +1, els.length));
          e.preventDefault();
          return;
        }
        if (e.key === "k" || e.key === "ArrowUp") {
          paintFocus(stepIndex(focusedRef.current, -1, els.length));
          e.preventDefault();
          return;
        }
        if (focusedRef.current !== NONE) {
          const paper = focusedPaper();
          if (paper) {
            if (e.key === "Enter" || e.key === "o") {
              router.push(`/papers/${paper.id}`);
              e.preventDefault();
              return;
            }
            if (e.key === "s") {
              const store = useFeedStore.getState();
              if (paper.isSaved) store.unsavePaper(paper.id);
              else store.savePaper(paper);
              e.preventDefault();
              return;
            }
            if (e.key === "l") {
              useFeedStore.getState().moreLikePaper(paper);
              e.preventDefault();
              return;
            }
            if (e.key === "x") {
              useFeedStore.getState().notInterestedPaper(paper);
              // The card leaves the DOM on the next paint; keep the ring in
              // place so the next paper slides under it.
              window.requestAnimationFrame(() => {
                paintFocus(indexAfterRemoval(focusedRef.current, cardEls().length));
              });
              e.preventDefault();
              return;
            }
          }
        }
      } else if (onPaperPage()) {
        // Paper-level keys — the reading page. No ring: every key acts on the
        // one paper on screen, through the handlers the page registered.
        // Backspace reaches here only past the typing guard above, so it
        // never eats a character; a `u` with nothing registered falls
        // through to the global undo below.
        if (e.key === "Enter" && isActivationTarget(document.activeElement)) return;
        // Arrows never take a live text selection: Shift+Arrow extends one,
        // and a plain arrow on a selection is the reader adjusting it, not
        // asking for the next paper. j/k and the brackets are unaffected.
        if (e.key.startsWith("Arrow")) {
          if (e.shiftKey) return;
          if (!(window.getSelection()?.isCollapsed ?? true)) return;
        }
        if (runReaderKey(e.key, e)) return;
      }

      switch (e.key) {
        case "/": {
          // Global: from anywhere it goes to Search, whose box focuses
          // itself on arrival; on Search it focuses in place. It used to
          // look for the box and do nothing where there was none.
          const input = document.getElementById("peer-search");
          const target = searchKeyTarget(
            window.location.pathname,
            input instanceof HTMLInputElement,
          );
          if (target.action === "focus" && input instanceof HTMLInputElement) {
            input.focus();
            input.select();
          } else {
            router.push("/search");
          }
          e.preventDefault();
          return;
        }
        case "?": {
          setHelpOpen((v) => !v);
          e.preventDefault();
          return;
        }
        case "g": {
          setAwaitingG(true);
          e.preventDefault();
          return;
        }
        case "r": {
          if (window.location.pathname === "/") {
            void loadFeed({ advanceHistory: true });
            e.preventDefault();
          }
          return;
        }
        case "u": {
          if (pendingDismissal) {
            undoDismiss();
            e.preventDefault();
          }
          return;
        }
      }
    },
    [
      awaitingG,
      helpOpen,
      router,
      loadFeed,
      undoDismiss,
      pendingDismissal,
      paintFocus,
      focusedPaper,
    ],
  );

  useEffect(() => {
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handler]);

  // External trigger from UI (the masthead's "?" chip)
  useEffect(() => {
    const toggle = () => setHelpOpen((v) => !v);
    window.addEventListener("peer:toggle-help", toggle);
    return () => window.removeEventListener("peer:toggle-help", toggle);
  }, []);

  return (
    <>
      {awaitingG && <ChordHint />}
      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}

// ── "g … " chord hint ──

function ChordHint() {
  return (
    <div
      className="fixed bottom-6 right-6 z-[65] pointer-events-none animate-fade-in-up"
      style={{ "--i": 0} as React.CSSProperties}
    >
      <div className="flex items-center gap-2 bg-heading text-bg rounded-full px-3.5 py-2 text-meta shadow-card-hover">
        <Kbd>g</Kbd>
        <span className="text-bg/60">then</span>
        <Kbd>h</Kbd>
        <span className="text-bg/60">·</span>
        <Kbd>s</Kbd>
        <span className="text-bg/60">·</span>
        <Kbd>p</Kbd>
      </div>
    </div>
  );
}

// ── Help overlay ──

function HelpOverlay({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <button
        type="button"
        aria-label="Close help"
        className="absolute inset-0 bg-heading/30 backdrop-blur-[2px] animate-fade-in"
        onClick={onClose}
      />

      {/* `max-h-full overflow-y-auto`: four groups run to ~940px, taller
          than a 800px laptop, and a centred sheet that cannot scroll cuts
          both its title and its footer — the changelog's only route. */}
      <div
        className="relative w-full max-w-[440px] max-h-full overflow-y-auto rounded-2xl glass shadow-card-hover p-6 animate-fade-in-up"
        style={{ "--i": 0} as React.CSSProperties}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-body-sm font-medium text-heading">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex items-center justify-center w-7 h-7 rounded-full text-text-faint hover:text-heading hover:bg-bg-secondary transition-colors active:scale-[0.92]"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-5">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="text-meta text-text-faint mb-2">{group.title}</h3>
              <ul className="space-y-1.5">
                {group.items.map((s) => (
                  <li
                    key={s.keys}
                    className="flex items-center justify-between gap-4 text-body-sm"
                  >
                    <span className="text-text">{s.label}</span>
                    <span className="flex items-center gap-1">
                      {s.keys.split(" ").map((k, i, arr) => (
                        <span key={i} className="flex items-center gap-1">
                          <Kbd>{k}</Kbd>
                          {i < arr.length - 1 && (
                            <span className="text-text-faint text-caption">then</span>
                          )}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {/* The version's only home. The `?` chip at the right of every
            desktop page says how to come back. */}
        <VersionLine onNavigate={onClose} className="mt-5 pt-4 border-t border-border" />
      </div>
    </div>
  );
}
