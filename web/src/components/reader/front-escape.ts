"use client";

// P11-17c rule 1 (C P11-15 "For the manager" 1; owner item 1): one Escape closes exactly one card — the front one. The cards of the margin's
// stack that answer Escape (the explain card, a sticky, the notes window, the figure) used to take it each by itself, and with a sticky in
// front and the figure and Explain behind, one key closed Explain — a card the reader could not see answering: its listener had no "front
// card only" check, the figure host's had (`figureIsFront`). And a sticky or the notes window answered only with the focus INSIDE it.
//
// A card takes the key only while it is the front of `useWindows`' stack — the window raised last, which is also a lone card — wherever
// the focus is; it then prevents and stops it, so the page's "back to the briefing" (the keyboard layer, a window listener) does not run.
// A key something else has handled (`defaultPrevented`) and a modal dialog over the page (`MODAL_OVER_PAGE`: the lightbox, the shortcuts
// sheet) still win. Below 1024 css px there is no stack: the explain card and its sheet stand outside it and the lightbox is a modal of its
// own, so nothing here applies to them (the explain box asks `isFrontCard` only when it is in the stack).
//
// The stack is read at the moment of the key, from the store — not at render — so a card that has just been sent behind or brought forward
// never answers with the order of the last commit, and nothing re-registers when the order changes.

import { useEffect } from "react";
import { MODAL_OVER_PAGE } from "./explain-dock";
import { useWindows, type FloatingWindow, type WindowKind } from "@/lib/reader/windows";

/** The id of the card in front — the window raised last — or null with no card in the stack. Pure. */
export function frontWindowId(windows: readonly FloatingWindow[]): string | null {
  let front: FloatingWindow | undefined;
  for (const w of windows) if (!front || w.order > front.order) front = w;
  return front?.id ?? null;
}

/** Whether `id` is the card in front: the front of the stack, or the only card in it. A card that is not in the stack is not. Pure. */
export function isFrontCard(windows: readonly FloatingWindow[], id: string): boolean {
  return frontWindowId(windows) === id;
}

/** Which card a listener answers for: the one with this id, or whichever window of this kind is in front (the stickies are many). */
export type FrontCard = string | { kind: WindowKind };

type Key = Pick<KeyboardEvent, "key" | "defaultPrevented" | "preventDefault" | "stopPropagation">;

/**
 * Escape, when it is this card's to take: the key is prevented and stopped, and `take` closes the card (it is handed the card's id). Returns
 * whether the card took it. It does not, when the key is not Escape or something has handled it, when the card is not the one in front of the
 * stack, and when a modal dialog is over the page.
 */
export function takeFrontEscape(event: Key, doc: Pick<Document, "querySelector">, card: FrontCard, take: (id: string) => void): boolean {
  if (event.key !== "Escape" || event.defaultPrevented) return false;
  const { windows } = useWindows.getState();
  const frontId = frontWindowId(windows);
  const front = frontId === null ? undefined : windows.find((w) => w.id === frontId);
  if (!front || (typeof card === "string" ? front.id !== card : front.kind !== card.kind)) return false;
  if (typeof doc.querySelector === "function" && doc.querySelector(MODAL_OVER_PAGE)) return false;
  event.preventDefault();
  event.stopPropagation();
  take(front.id);
  return true;
}

/**
 * The card's Escape: a listener on the document, in the BUBBLE phase (after every capture listener and every React handler, so a control
 * that is open takes the key first), for as long as `enabled`. Whether the card is in front is asked when the key comes, not when the
 * listener is registered: a card that becomes the front because the one over it has just closed answers the very next key. `take` should be
 * stable: the listener is registered again when it changes.
 */
export function useFrontEscape(card: FrontCard, enabled: boolean, take: (id: string) => void): void {
  const kind = typeof card === "string" ? null : card.kind;
  const id = typeof card === "string" ? card : null;
  useEffect(() => {
    if (!enabled) return;
    const which: FrontCard = id !== null ? id : { kind: kind as WindowKind };
    const onKeyDown = (event: KeyboardEvent) => void takeFrontEscape(event, document, which, take);
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [id, kind, enabled, take]);
}
