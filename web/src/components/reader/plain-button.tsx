"use client";

// "Say it plainly" in the browser (P4-01; blueprint §3.6 ⑥; user decision §1a.5 (b); rulings
// §1h.12 (h); §3d 15, 18).
//
// Under a paragraph the route marks read, and only for a reader who has a model (the page passes
// nothing otherwise: absent, not disabled — the locked-block rule, §1b), a small label-face
// button, "Say it plainly", with the three levels beside it. A click is the one thing that sends:
// the paragraph's words and where it sits, to the paper's plain route, on the reader's own key.
// The answer is kept in this browser (`store/plain-rewrites.ts`) and shown BESIDE the paragraph
// — never in its place — in the reading face under one `PEERS_READING` line. A rewrite already
// kept for that paragraph at that level opens at once, with no request; `u` takes the latest one
// back (the page's `undoOrToggleRead`), and the button, pressed, does the same for its own
// paragraph. When the server could not keep the paragraph's numbers exact (422) or had nothing
// to give, one line says so under the control and the original stands alone.
//
// This file holds the three small pieces the page and the body use: `PlainControl` and
// `PlainRewrite` (markup, no state), `plainOffered` (where the control is offered) and
// `sayPlainly` (what a click does with the stores and the request). `requestPlain` is the
// request itself: it reads the response whatever its status, because `apiFetch` throws on a 422
// without its body and the two 422s (`numbers_changed`, `not_in_paper`) say different things.
// Nothing here is logged: a key and a paragraph are not for a console.

import type { ReactNode } from "react";
import type { ProviderOverrideConfig } from "@/lib/llm/providers/types";
import { PLAIN_CAPS } from "@/lib/papers/plain";
import { PLAIN_LEVELS, type PlainLevel } from "@/lib/papers/plain-levels";
import { keptFor, paragraphKey, usePlainRewritesStore, type PlainNotice } from "@/store/plain-rewrites";
import type { Paper } from "@/types";
import { PEERS_READING, PLAIN } from "./copy";
import { MathText } from "./math";
import type { SectionMark } from "./paper-body";

/** A paragraph the control is for: where it sits in the body, and its words. */
export interface PlainTarget {
  sectionId: string;
  sectionIndex: number;
  paragraphIndex: number;
  text: string;
}

/** What the body is handed to draw the control and the rewrites (`PaperBody`'s `plain` prop). It is
 *  absent for a reader with no model, and the body is then the body it was. */
export interface PlainView {
  /** The reader's remembered level. */
  level: PlainLevel;
  /** The rewrite showing beside each paragraph, by `paragraphKey`. */
  shown: ReadonlyMap<string, string>;
  /** The paragraphs waiting on the model. */
  busy: ReadonlySet<string>;
  /** The paragraphs that could not be said plainly, and why. */
  notices: ReadonlyMap<string, PlainNotice>;
  /** The button: show the paragraph's rewrite (asking for it once), or hide it if it shows. */
  onToggle: (target: PlainTarget) => void;
  /** A level: remembered; if a rewrite shows beside this paragraph, it is asked at the new level. */
  onLevel: (target: PlainTarget, level: PlainLevel) => void;
}

/**
 * Whether the control is offered under paragraph `index` of a section: the paragraph's own tier
 * in the route's mark is `read`, or — a Tier 2 answer marks a section, not its paragraphs — the
 * section's tier is `read` and the section has no paragraph marks at all. Never under a paragraph
 * longer than `PLAIN_CAPS.paragraphChars` (BACKLOG-20, P4-03): the route rewrites only that many
 * characters of it, so the numbers after the cut are outside the guard's set; the control is then
 * absent, as without a model, and the paragraph is left as the paper has it. `paragraph` is the
 * paper's own text as the page holds it.
 */
export function plainOffered(mark: SectionMark | null, index: number, paragraph = ""): boolean {
  if (!mark) return false;
  if (paragraph.length > PLAIN_CAPS.paragraphChars) return false;
  if (mark.paragraphs.get(index) === "read") return true;
  return mark.tier === "read" && mark.paragraphs.size === 0;
}

// ── The markup ─────────────────────────────────────────────────────────

// A touch screen gets a taller target (the label face is small); a pointer keeps the quiet one.
const PILL = "font-mono text-caption transition-colors disabled:opacity-50 pointer-coarse:py-2";

export interface PlainControlProps {
  /** The reader's remembered level. */
  level: PlainLevel;
  /** A rewrite shows beside the paragraph: the button is pressed, and pressing it hides it. */
  showing: boolean;
  /** The request is running: the button says so and nothing can be pressed. */
  busy: boolean;
  notice?: PlainNotice | null;
  onToggle: () => void;
  onLevel: (level: PlainLevel) => void;
  /** The row spans both columns of the spread (a rewrite is beside the paragraph). */
  wide?: boolean;
}

/**
 * The control under a paragraph: the button, the three levels as one segmented choice, and — when
 * the last try failed — one line saying why there is no rewrite. Label face throughout (Peer's
 * words); no state of its own.
 */
export function PlainControl({ level, showing, busy, notice, onToggle, onLevel, wide }: PlainControlProps): ReactNode {
  return (
    <div data-plain-control="" className={`flex flex-wrap items-center gap-x-3 gap-y-1${wide ? " xl:col-span-2" : ""}`}>
      <button
        type="button"
        data-plain-say=""
        aria-pressed={showing}
        disabled={busy}
        onClick={onToggle}
        className={`${PILL} py-1 text-text-muted underline decoration-border-strong decoration-1 underline-offset-4 hover:text-heading hover:decoration-heading aria-pressed:text-heading`}
      >
        {busy ? PLAIN.busy : PLAIN.button}
      </button>
      <span role="group" aria-label={PLAIN.levelsLabel} className="inline-flex border border-border-strong">
        {PLAIN_LEVELS.map((one) => (
          <button
            key={one}
            type="button"
            data-plain-level={one}
            aria-pressed={one === level}
            disabled={busy}
            onClick={() => onLevel(one)}
            className={`${PILL} px-2 py-1 text-text-faint hover:text-heading aria-pressed:bg-[color:var(--color-bg-secondary)] aria-pressed:text-heading`}
          >
            {PLAIN.levels[one]}
          </button>
        ))}
      </span>
      {notice && (
        <p role="status" className="annotation basis-full text-text-faint">
          {notice === "numbers_changed" ? PLAIN.couldNotKeepNumbers : PLAIN.unavailable}
        </p>
      )}
    </div>
  );
}

/**
 * The control for one paragraph of the body, wired to the page's view: this paragraph's state
 * (shown, busy, its notice, the remembered level) in, this paragraph's target out. `PaperBody`
 * draws one under each paragraph it is offered for.
 */
export function ParagraphPlainControl({ view, target, wide }: { view: PlainView; target: PlainTarget; wide?: boolean }): ReactNode {
  const key = paragraphKey(target.sectionId, target.paragraphIndex);
  return (
    <PlainControl
      level={view.level}
      showing={view.shown.has(key)}
      busy={view.busy.has(key)}
      notice={view.notices.get(key) ?? null}
      wide={wide}
      onToggle={() => view.onToggle(target)}
      onLevel={(level) => view.onLevel(target, level)}
    />
  );
}

/**
 * The rewrite, beside its paragraph: Peer's own words, so one label-face line says so and they
 * are set in the reading face — never styled as a quotation. A formula the paragraph held is
 * drawn as the paragraph draws it.
 */
export function PlainRewrite({ text }: { text: string }): ReactNode {
  return (
    <div role="note" aria-label={PLAIN.rewrite} data-plain-rewrite="" className="space-y-1">
      <p className="annotation text-text-faint">{PEERS_READING}</p>
      <p>
        <MathText text={text} />
      </p>
    </div>
  );
}

// ── The request ────────────────────────────────────────────────────────

/** What the request comes to: the rewrite, or why there is none. */
export type PlainRequestResult = { plain: string } | "numbers_changed" | "unavailable";

/** The paper as the server needs it to find the paper's text — its id and title, its DOI and
 *  links, an upload's id — and no more: not the abstract, the authors or the reader's marks. */
function paperForRequest(paper: Paper): Pick<Paper, "id" | "title" | "doi" | "linkPaper" | "linkArxiv" | "fullTextUploadId"> {
  const { id, title, doi, linkPaper, linkArxiv, fullTextUploadId } = paper;
  return { id, title, doi, linkPaper, linkArxiv, fullTextUploadId };
}

/**
 * The one request "Say it plainly" makes, when the reader clicks: the paragraph's words and where
 * it sits, the level, and the reader's own key only when they have one. The rewrite;
 * "numbers_changed" when the server discarded it because it did not keep the paragraph's numbers
 * and units (422); and "unavailable" for everything else — no model, an outage, a refusal, a
 * gone upload, a paragraph the server does not find, an answer that is not what was promised.
 */
export async function requestPlain(args: {
  paper: Paper;
  sectionId: string;
  paragraphIndex: number;
  text: string;
  level: PlainLevel;
  llmOverride?: ProviderOverrideConfig;
}): Promise<PlainRequestResult> {
  const { paper, sectionId, paragraphIndex, text, level, llmOverride } = args;
  try {
    const response = await fetch(`/api/papers/${encodeURIComponent(paper.id)}/plain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paper: paperForRequest(paper),
        sectionId,
        paragraphIndex,
        text,
        level,
        ...(llmOverride ? { llmOverride } : {}),
      }),
    });
    const raw = await response.text();
    let body: { plain?: unknown; error?: unknown } | null = null;
    try {
      body = raw ? (JSON.parse(raw) as { plain?: unknown; error?: unknown }) : null;
    } catch {
      body = null;
    }
    if (response.status === 422) return body?.error === "numbers_changed" ? "numbers_changed" : "unavailable";
    if (response.ok && typeof body?.plain === "string" && body.plain.trim() !== "") return { plain: body.plain.trim() };
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

// ── The click ──────────────────────────────────────────────────────────

/** What a click came to. */
export type PlainOutcome = "shown" | "kept" | "numbers_changed" | "unavailable" | "busy";

/**
 * Show a paragraph said plainly at `level`: from this browser's memory when it is kept there for
 * these very words (no request), otherwise by asking — once at a time for a paragraph — and
 * keeping what comes back. A failed or refused try leaves the original alone (a rewrite showing
 * at another level is taken down, so the page does not claim a level it did not get) and puts one
 * line under the paragraph. The browser's store being full or blocked never costs the reader the
 * rewrite: it is shown from memory all the same.
 */
export async function sayPlainly(args: {
  paper: Paper;
  target: PlainTarget;
  level: PlainLevel;
  llmOverride?: ProviderOverrideConfig;
  /** The request; the page's own, a stub in tests. */
  request?: typeof requestPlain;
}): Promise<PlainOutcome> {
  const { paper, target, level, llmOverride, request = requestPlain } = args;
  const store = usePlainRewritesStore;
  const key = paragraphKey(target.sectionId, target.paragraphIndex);
  const state = store.getState();
  if (state.isBusy(paper.id, key)) return "busy";
  state.setNotice(paper.id, key, null);

  if (keptFor(state.byPaper, paper.id, key, level, target.text)) {
    state.show(paper.id, key, level);
    return "kept";
  }

  state.setBusy(paper.id, key, true);
  try {
    const result = await request({
      paper,
      sectionId: target.sectionId,
      paragraphIndex: target.paragraphIndex,
      text: target.text,
      level,
      ...(llmOverride ? { llmOverride } : {}),
    });
    const now = store.getState();
    if (typeof result === "string") {
      now.hide(paper.id, key);
      now.setNotice(paper.id, key, result);
      return result;
    }
    try {
      now.remember(paper.id, key, level, { plain: result.plain, text: target.text });
    } catch {
      // A full or blocked browser store: persist's write threw after the state was set.
    }
    store.getState().show(paper.id, key, level);
    return "shown";
  } finally {
    store.getState().setBusy(paper.id, key, false);
  }
}
