"use client";

// "Explain this?" — the button beside a selected passage, and the card it opens
// (P3-02; ruling §1h.2; user decision §1a.10; blueprint §3.5 ⑤ 词, relaxed from
// a word to a passage up to a paragraph).
//
// The reader selects words of the body (`paper-body.tsx` reads the selection);
// a small button appears just below them. Clicking it is the send: nothing goes
// anywhere before it. The card then shows, in order,
//
//   - the passage's opening words, quoted from the paper with their section —
//     the paper's words go through `EvidenceQuote`, always (§1f.17);
//   - when the paper itself defines a term inside the passage (Tier 0,
//     P3-01's list), that sentence as a quote. With no key this is the whole
//     card, and with no key and no paper definition there is no button at all
//     (a locked block is not shown);
//   - with a key, the model's two parts: "What it means" (Peer's words, labelled)
//     and "Why it is here" — Peer's prose, then the paper's own sentence as a
//     quote, or, when that sentence could not be verified, the prose labelled as
//     Peer's own reading and no quote.
//
// An answer already kept for the passage opens at once with no request. Escape,
// a press outside the card, or a new selection closes it; a selection that
// merely goes away (a click in the card collapses it) does not. Nothing here
// links off the page.
//
// Positioned `fixed` from the selection's rectangle, measured again as the page
// scrolls. A phone gets the card at the full width under the selection.

import { useEffect, useState, type CSSProperties } from "react";
import { ApiError, apiFetch } from "@/lib/api";
import { hasUserLlmOverride } from "@/lib/feed/ai-tier";
import type { ProviderOverrideConfig } from "@/lib/llm/providers/types";
import type { ExplainAnswer } from "@/lib/papers/explain";
import type { PaperReading } from "@/lib/papers/reading";
import type { PaperTerm } from "@/lib/papers/report";
import type { Paper, UserProfile } from "@/types";
import { EXPLAIN, PEERS_READING } from "./copy";
import { EvidenceQuote } from "./evidence-quote";
import type { ExplainSelection, SelectionTarget, ViewRect, ViewRects } from "./paper-body";

// ── What the card shows ────────────────────────────────────────────────

/** `none`: no model is asked (no key) — the paper's own definition is all there is. */
export type ExplainStatus =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "answer"; answer: ExplainAnswer }
  | { kind: "unavailable" }
  | { kind: "not_in_paper" };

/** What asking comes to. */
export type AskResult = ExplainAnswer | "unavailable" | "not_in_paper";

const PREVIEW_CHARS = 80;

/** The passage's opening words, for the card's first line — cut at a word. */
export function previewOf(passage: string): string {
  if (passage.length <= PREVIEW_CHARS) return passage;
  const space = passage.lastIndexOf(" ", PREVIEW_CHARS);
  return `${(space > 0 ? passage.slice(0, space) : passage.slice(0, PREVIEW_CHARS)).trimEnd()}…`;
}

const escapeForPattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether `term` is a word (or words) of `passage`: whole, in any case — "DM"
 *  is not found inside "admission". */
export function termInPassage(term: string, passage: string): boolean {
  const wanted = term.trim();
  if (!wanted) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeForPattern(wanted)}(?![\\p{L}\\p{N}])`, "iu").test(passage);
}

/** The first term whose definition is the paper's own sentence (not Peer's)
 *  that lies inside the passage — the Tier 0 answer. */
export function definingTerm(terms: readonly PaperTerm[], passage: string): PaperTerm | null {
  return terms.find((term) => term.evidence && termInPassage(term.term, passage)) ?? null;
}

/** Where a term's sentence is from, for its attribution: its own place, else the
 *  map's heading and page for its section, else the abstract (as the strip does). */
export function termSource(term: PaperTerm, reading: Pick<PaperReading, "map">): { where: string; page: number | undefined } {
  const section = term.sectionId ? reading.map?.sections.find((candidate) => candidate.id === term.sectionId) : undefined;
  return { where: term.evidenceWhere ?? section?.heading ?? "abstract", page: term.page ?? section?.page };
}

// ── Where it stands ────────────────────────────────────────────────────

export interface Viewport {
  width: number;
  height: number;
}

const BUTTON_WIDTH = 120;
const BUTTON_HEIGHT = 32;
const BUTTON_GAP = 6;
const BUTTON_MARGIN = 8;
const CARD_WIDTH = 360;
const CARD_MARGIN = 12;
const CARD_GAP = 8;
const CARD_ROOM = 220;
const CARD_MIN_HEIGHT = 120;
/** Below this the card takes the window's width: a phone. */
const PHONE_WIDTH = 640;

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));

/** The button: just below where the selection ends, centred on its end; above
 *  it when there is no room below; always inside the window. */
export function placeButton(rect: ViewRect, viewport: Viewport): { left: number; top: number } {
  const left = clamp(rect.right - BUTTON_WIDTH / 2, BUTTON_MARGIN, viewport.width - BUTTON_WIDTH - BUTTON_MARGIN);
  const below = rect.bottom + BUTTON_GAP;
  const top = below + BUTTON_HEIGHT > viewport.height - BUTTON_MARGIN ? Math.max(BUTTON_MARGIN, rect.top - BUTTON_GAP - BUTTON_HEIGHT) : below;
  return { left, top };
}

/** The card: 360 px wide under the whole selection on a spread, the window's
 *  width less a margin on a phone; above it when there is more room there than
 *  below — it never covers the words it explains. Its height is bounded by the
 *  room it has, and it scrolls inside. */
export function placeCard(
  rect: ViewRect,
  viewport: Viewport,
): { left: number; width: number; top?: number; bottom?: number; maxHeight: number } {
  const phone = viewport.width < PHONE_WIDTH;
  const width = phone ? viewport.width - 2 * CARD_MARGIN : CARD_WIDTH;
  const left = phone ? CARD_MARGIN : clamp(rect.left, CARD_MARGIN, viewport.width - CARD_WIDTH - CARD_MARGIN);
  const roomBelow = viewport.height - rect.bottom - CARD_GAP - CARD_MARGIN;
  const roomAbove = rect.top - CARD_GAP - CARD_MARGIN;
  if (roomBelow >= CARD_ROOM || roomBelow >= roomAbove) {
    const maxHeight = Math.max(roomBelow, CARD_MIN_HEIGHT);
    return { left, width, maxHeight, top: Math.min(rect.bottom + CARD_GAP, viewport.height - CARD_MARGIN - maxHeight) };
  }
  const maxHeight = Math.max(roomAbove, CARD_MIN_HEIGHT);
  return { left, width, maxHeight, bottom: Math.min(viewport.height - rect.top + CARD_GAP, viewport.height - CARD_MARGIN - maxHeight) };
}

function currentViewport(): Viewport {
  return typeof window === "undefined" ? { width: 1024, height: 768 } : { width: window.innerWidth, height: window.innerHeight };
}

// ── Asking ─────────────────────────────────────────────────────────────

/** The reader's own provider and key, when they have set one — the shape the
 *  report request carries; nothing for Peer's own model. */
export function explainLlmOverride(profile: Pick<UserProfile, "feedAiProvider" | "feedAiApiKey">): ProviderOverrideConfig | undefined {
  if (!hasUserLlmOverride(profile as UserProfile)) return undefined;
  return { provider: profile.feedAiProvider as ProviderOverrideConfig["provider"], apiKey: (profile.feedAiApiKey ?? "").trim() };
}

const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/** The two parts, as the server sent them — or null for anything else. */
function asAnswer(value: unknown): ExplainAnswer | null {
  const answer = (value as { answer?: unknown } | null)?.answer as { meaning?: unknown; here?: Record<string, unknown> } | undefined;
  if (!answer || !isText(answer.meaning) || !answer.here || !isText(answer.here.text)) return null;
  const { here } = answer;
  return {
    meaning: answer.meaning,
    here: {
      text: here.text as string,
      ...(isText(here.evidence) ? { evidence: here.evidence } : {}),
      ...(isText(here.evidenceWhere) ? { evidenceWhere: here.evidenceWhere } : {}),
      ...(isText(here.sectionId) ? { sectionId: here.sectionId } : {}),
      ...(typeof here.page === "number" ? { page: here.page } : {}),
      ...(here.peer === true ? { peer: true as const } : {}),
    },
  };
}

/**
 * The one request "Explain this?" makes, when the reader clicks: the paper, the
 * passage and where it sits (the first message has no thread), and the reader's
 * own key only when they have one. An answer, "not_in_paper" when the server
 * says the words are not the paper's (422), and "unavailable" for everything
 * else — an outage, a refusal, a gone upload, a reply that is not what was promised.
 */
export async function requestExplanation(args: {
  paper: Paper;
  selection: SelectionTarget;
  sectionId: string;
  llmOverride?: ProviderOverrideConfig;
}): Promise<AskResult> {
  const { paper, selection, sectionId, llmOverride } = args;
  try {
    const reply = await apiFetch<unknown>(`/api/papers/${encodeURIComponent(paper.id)}/explain`, {
      method: "POST",
      body: JSON.stringify({
        paper,
        passage: selection.passage,
        sectionId,
        paragraphIndex: selection.paragraphIndex,
        thread: [],
        ...(llmOverride ? { llmOverride } : {}),
      }),
    });
    return asAnswer(reply) ?? "unavailable";
  } catch (error) {
    return error instanceof ApiError && error.status === 422 ? "not_in_paper" : "unavailable";
  }
}

// ── The card ───────────────────────────────────────────────────────────

/** A part's label, in the label face — with Peer's own label beside it when the
 *  words under it are Peer's. */
function PartHeading({ children, peers }: { children: string; peers: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3">
      <p className="font-mono text-caption text-text-muted">{children}</p>
      {peers && <span className="annotation text-text-faint">{PEERS_READING}</span>}
    </div>
  );
}

/**
 * The card itself: its passage as a quote, the paper's own definition when it
 * has one, and, with a key, the model's two parts or the state it is in.
 * Presentational — `ExplainPopover` owns what it shows and where.
 */
export function ExplainCard({
  passage,
  heading,
  term,
  termWhere,
  canAsk,
  status,
  onClose,
  style,
}: {
  passage: string;
  /** The heading of the section the passage sits in. */
  heading: string;
  /** The paper's own definition of a term inside the passage, if it has one. */
  term: PaperTerm | null;
  termWhere: { where: string; page?: number } | null;
  canAsk: boolean;
  status: ExplainStatus;
  onClose: () => void;
  style?: CSSProperties;
}) {
  return (
    <div
      role="dialog"
      aria-label={EXPLAIN.card}
      data-explain-card=""
      style={style}
      className="fixed z-[70] overflow-y-auto rounded-lg border border-border-strong bg-surface p-4 shadow-card-hover"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <EvidenceQuote text={previewOf(passage)} where={heading} />
        </div>
        <button type="button" onClick={onClose} className="annotation shrink-0 text-text-faint transition-colors hover:text-heading">
          {EXPLAIN.close}
        </button>
      </div>

      {term?.evidence && termWhere && (
        <div className="mt-4">
          <p className="font-mono text-caption text-text-muted">{EXPLAIN.defines(term.term)}</p>
          <EvidenceQuote text={term.evidence} where={termWhere.where} page={termWhere.page} />
        </div>
      )}

      {canAsk && status.kind !== "none" && (
        <div role="status" aria-live="polite" className="mt-4 space-y-4">
          {status.kind === "loading" && <p className="annotation text-text-faint">{EXPLAIN.loading}</p>}
          {status.kind === "unavailable" && <p className="annotation text-text-faint">{EXPLAIN.unavailable}</p>}
          {status.kind === "not_in_paper" && <p className="annotation text-text-faint">{EXPLAIN.notInPaper}</p>}
          {status.kind === "answer" && (
            <>
              <section>
                <PartHeading peers>{EXPLAIN.meaning}</PartHeading>
                <p className="font-reading text-body leading-[1.6] text-text mt-2">{status.answer.meaning}</p>
              </section>
              <section>
                <PartHeading peers={status.answer.here.peer === true}>{EXPLAIN.here}</PartHeading>
                <p className="font-reading text-body leading-[1.6] text-text mt-2">{status.answer.here.text}</p>
                {status.answer.here.evidence && status.answer.here.peer !== true && (
                  <EvidenceQuote text={status.answer.here.evidence} where={status.answer.here.evidenceWhere ?? "abstract"} page={status.answer.here.page} />
                )}
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── The popover ────────────────────────────────────────────────────────

interface Session {
  /** The selection the card was opened for. */
  selection: ExplainSelection;
  status: ExplainStatus;
}

export interface ExplainPopoverProps {
  /** What the reader has selected in the body, or null. */
  target: ExplainSelection | null;
  /** P3-01's terms as the page holds them: the paper's definitions and the model's. */
  terms: readonly PaperTerm[];
  /** Whether the reader has a model to ask (their own key, or Peer's signed in). */
  canAsk: boolean;
  /** The one request, made when the reader clicks — never before. */
  onAsk: (target: SelectionTarget) => Promise<AskResult>;
  /** An answer already kept for this passage: opens at once, no request. */
  cached?: ExplainAnswer;
  /** The body the passage sits in and the map its sections are named by. */
  reading: Pick<PaperReading, "body" | "map">;
}

export function ExplainPopover({ target, terms, canAsk, onAsk, cached, reading }: ExplainPopoverProps) {
  const [session, setSession] = useState<Session | null>(null);
  // A new selection closes the card; one that merely went away does not (a click
  // in the card collapses it). Derived, so the stale card never paints.
  const stale = session !== null && target !== null && target.passage !== session.selection.passage;
  const open = stale ? null : session;
  if (stale) setSession(null);

  const anchor = open?.selection ?? target;
  const [measured, setMeasured] = useState<{ of: ExplainSelection; where: ViewRects } | null>(null);
  const [viewport, setViewport] = useState<Viewport>(currentViewport);

  // Where the selection is, measured again as the page scrolls or resizes.
  useEffect(() => {
    if (!anchor) return;
    let frame: number | undefined;
    const update = () => {
      frame = undefined;
      setViewport(currentViewport());
      const where = anchor.measure?.();
      if (where) setMeasured({ of: anchor, where });
    };
    const onMove = () => {
      if (frame === undefined) frame = window.requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [anchor]);

  // While the card is open: Escape closes it (and goes no further — the page's
  // own Escape means "back"), and so does a press outside it.
  const isOpen = open !== null;
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setSession(null);
    };
    const onPointerDown = (event: PointerEvent) => {
      const node = event.target as Element | null;
      if (node?.closest?.("[data-explain-card]")) return;
      setSession(null);
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [isOpen]);

  const term = anchor ? definingTerm(terms, anchor.passage) : null;
  if (!anchor) return null;
  const where = measured !== null && measured.of === anchor ? measured.where : anchor;

  if (!open) {
    // A locked block is not shown: with no key, only the paper's own definition is worth a button.
    if (!term && !canAsk) return null;
    const start = () => {
      const selection = anchor;
      if (!canAsk) {
        setSession({ selection, status: { kind: "none" } });
        return;
      }
      if (cached) {
        setSession({ selection, status: { kind: "answer", answer: cached } });
        return;
      }
      setSession({ selection, status: { kind: "loading" } });
      const asked: SelectionTarget = { sectionIndex: selection.sectionIndex, paragraphIndex: selection.paragraphIndex, passage: selection.passage };
      void onAsk(asked)
        .catch((): AskResult => "unavailable")
        .then((result) =>
          setSession((current) =>
            current !== null && current.selection.passage === selection.passage
              ? { ...current, status: typeof result === "string" ? { kind: result } : { kind: "answer", answer: result } }
              : current,
          ),
        );
    };
    const at = placeButton(where.rect, viewport);
    return (
      <button
        type="button"
        data-explain-ask=""
        // The press must not take the selection with it: it is what is explained.
        onMouseDown={(event) => event.preventDefault()}
        onClick={start}
        style={{ left: at.left, top: at.top }}
        className="fixed z-[70] rounded-full border border-border-strong bg-surface px-3 py-2 font-mono text-caption text-heading shadow-card-hover transition-colors hover:bg-surface-hover"
      >
        {EXPLAIN.ask}
      </button>
    );
  }

  const place = placeCard(where.bounds, viewport);
  const heading = reading.body[open.selection.sectionIndex]?.heading ?? "";
  return (
    <ExplainCard
      passage={open.selection.passage}
      heading={heading}
      term={term}
      termWhere={term ? termSource(term, reading) : null}
      canAsk={canAsk}
      status={open.status}
      onClose={() => setSession(null)}
      style={{
        left: place.left,
        width: place.width,
        maxHeight: place.maxHeight,
        ...(place.top !== undefined ? { top: place.top } : { bottom: place.bottom }),
      }}
    />
  );
}
