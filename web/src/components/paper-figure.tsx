"use client";

import { useEffect, useState } from "react";
import type { FigureStatus } from "@/lib/figures/extract";
import { ApiError, apiFetch } from "@/lib/api";

type Variant = "hero" | "compact";

export interface FigureState {
  key: string;
  imageUrl: string | null;
  caption: string | null;
  source: string | null;
  status: FigureStatus | "idle";
  reason: string | null;
  hideFigure: boolean;
  matchedBy: "keyword" | "semantic" | "vision" | "fallback" | null;
}

export interface ResolveFigureArgs {
  itemId: string;
  url?: string;
  doi?: string;
  query?: string;
  paperTitle?: string;
  alt?: string;
  variant?: Variant;
  figureIndex?: number;
  hideOnMiss?: boolean;
}

// Default image box sizing. Compact report figures now get much more height
// and then switch to the real image ratio after load. On mobile we also
// cap the height so square / portrait charts don't dominate the screen.
const frameClassByVariant: Record<Variant, string> = {
  hero: "min-h-[260px] sm:min-h-[360px] lg:min-h-[440px] xl:min-h-[520px] max-h-[360px] sm:max-h-none",
  compact: "min-h-[220px] sm:min-h-[340px] lg:min-h-[420px] xl:min-h-[500px] max-h-[300px] sm:max-h-none",
};

const defaultAspectByVariant: Record<Variant, number> = {
  hero: 4 / 3,
  compact: 1,
};

function initialFigureState(key = ""): FigureState {
  return {
    key,
    imageUrl: null,
    caption: null,
    source: null,
    status: "idle",
    reason: null,
    hideFigure: false,
    matchedBy: null,
  };
}

// ── One request per figure ──
//
// However many plates ask, a figure is fetched once. The card primes the
// entry the page reuses, and on the page the plate (the image) and the
// caption line resolve the same args; each hook instance used to issue its
// own `/api/figure` request, and `no-store` meant the browser never collapsed
// them. In flight, later askers join the same promise; settled, they read the
// result synchronously. A request is aborted only when its last asker leaves,
// so a card scrolling away does not cancel the page's figure.

interface InFlight {
  promise: Promise<FigureState>;
  controller: AbortController;
  askers: number;
}

const inFlight = new Map<string, InFlight>();
const settled = new Map<string, FigureState>();
/** Bounded by insertion order; a session's briefings are tens of papers, not thousands. */
const SETTLED_MAX = 200;

function remember(key: string, state: FigureState): void {
  settled.set(key, state);
  if (settled.size > SETTLED_MAX) {
    const oldest = settled.keys().next().value;
    if (oldest !== undefined) settled.delete(oldest);
  }
}

/** The route's verdict for these args; throws on a transport failure. */
async function fetchFigure(
  key: string,
  { itemId, url, doi, query, paperTitle, figureIndex = 0 }: ResolveFigureArgs,
  signal: AbortSignal,
): Promise<FigureState> {
  const params = new URLSearchParams({ id: itemId, v: "11" });
  if (url) params.set("url", url);
  if (doi) params.set("doi", doi);
  if (query?.trim()) params.set("query", query.trim());
  if (paperTitle?.trim()) params.set("paperTitle", paperTitle.trim());
  if (figureIndex > 0) params.set("idx", String(figureIndex));

  const data = (await apiFetch(`/api/figure?${params.toString()}`, {
    cache: "no-store",
    signal,
  })) as Omit<FigureState, "key"> & {
    imageUrl: string | null;
    caption?: string | null;
    source?: string | null;
    reason?: string | null;
    hideFigure?: boolean;
    matchedBy?: "keyword" | "semantic" | "vision" | "fallback" | null;
    status: FigureStatus;
  };
  return {
    key,
    imageUrl: data.imageUrl,
    caption: data.caption ?? null,
    source: data.source ?? null,
    status: data.status,
    reason: data.reason ?? null,
    hideFigure: Boolean(data.hideFigure),
    matchedBy: data.matchedBy ?? null,
  };
}

/** Join the request for `key`, starting it if nobody has. */
function acquire(key: string, args: ResolveFigureArgs): InFlight {
  let entry = inFlight.get(key);
  if (!entry) {
    const controller = new AbortController();
    const created: InFlight = {
      promise: Promise.resolve(initialFigureState(key)),
      controller,
      askers: 0,
    };
    // Only the route's answer is remembered: a transport failure is the
    // session's, not the paper's, and the next asker may reach the route.
    created.promise = fetchFigure(key, args, controller.signal)
      .then((state) => {
        remember(key, state);
        return state;
      })
      .finally(() => {
        if (inFlight.get(key) === created) inFlight.delete(key);
      });
    inFlight.set(key, created);
    entry = created;
  }
  entry.askers += 1;
  return entry;
}

/** Leave the request for `key`; the last asker out aborts it. */
function release(key: string): void {
  const entry = inFlight.get(key);
  if (!entry) return;
  entry.askers -= 1;
  if (entry.askers <= 0) {
    entry.controller.abort();
    inFlight.delete(key);
  }
}

function failureState(key: string, err: unknown): FigureState {
  return {
    key,
    imageUrl: null,
    caption: null,
    source: null,
    status: "source_unavailable",
    reason:
      err instanceof ApiError
        ? "Peer could not load the figure service response."
        : "Peer could not reach a usable figure source.",
    hideFigure: false,
    matchedBy: null,
  };
}

export function useResolvedFigure({
  itemId,
  url,
  doi,
  query,
  paperTitle,
  figureIndex = 0,
}: ResolveFigureArgs): FigureState {
  const requestKey = [
    itemId,
    url ?? "",
    doi ?? "",
    query ?? "",
    paperTitle ?? "",
    String(figureIndex),
  ].join("\u001f");

  const [figure, setFigure] = useState<FigureState>(initialFigureState());
  // Derived, not set in an effect: a figure already settled for these args
  // is on screen at first render, with no request and no idle frame.
  const activeFigure =
    figure.key === requestKey
      ? figure
      : (settled.get(requestKey) ?? initialFigureState(requestKey));

  useEffect(() => {
    if (settled.has(requestKey)) return;
    let cancelled = false;
    const entry = acquire(requestKey, { itemId, url, doi, query, paperTitle, figureIndex });
    entry.promise.then(
      (state) => {
        if (!cancelled) setFigure(state);
      },
      (err: unknown) => {
        if (!cancelled) setFigure(failureState(requestKey, err));
      },
    );

    return () => {
      cancelled = true;
      // Leave the request when the figure is superseded/unmounted; the last
      // asker out cancels it, so an abandoned tab/scroll doesn't keep a
      // figure request running.
      release(requestKey);
    };
  }, [itemId, url, doi, query, paperTitle, figureIndex, requestKey]);

  return activeFigure;
}

export function PaperFigureFrame({
  figure,
  alt,
  variant = "hero",
  hideOnMiss = true,
}: {
  figure: FigureState;
  alt?: string;
  variant?: Variant;
  hideOnMiss?: boolean;
}) {
  const [loadedImage, setLoadedImage] = useState<{
    url: string;
    aspect: number;
  } | null>(null);

  const activeAspect =
    loadedImage && loadedImage.url === figure.imageUrl
      ? loadedImage.aspect
      : null;

  // Whenever we have nothing usable to show, emit the `.figure-hidden`
  // marker. The parent uses `has-[.figure-hidden]:hidden` so the entire
  // figure column collapses (removing both the placeholder AND the flex
  // gap). Returning `null` here leaves an empty flex item that still
  // reserves space, so we always render the marker instead.
  if (!figure.imageUrl && figure.hideFigure) {
    return <div className="figure-hidden" aria-hidden />;
  }

  if (
    hideOnMiss &&
    figure.status !== "idle" &&
    !figure.imageUrl &&
    figure.status !== "found"
  ) {
    return <div className="figure-hidden" aria-hidden />;
  }
  return (
    <figure className="mt-5 w-full">
      {/* Image area — caption no longer overlaps. */}
      <div
        className={`relative w-full overflow-hidden rounded-2xl bg-bg-secondary/50 ${frameClassByVariant[variant]}`}
        style={{
          aspectRatio: activeAspect ?? defaultAspectByVariant[variant],
        }}
      >
        {figure.status === "idle" && (
          <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-bg-secondary/40 via-bg-secondary/70 to-bg-secondary/40" />
        )}
        {figure.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={figure.imageUrl}
            alt={alt ?? ""}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onLoad={(event) => {
              const next = event.currentTarget;
              if (next.naturalWidth > 0 && next.naturalHeight > 0) {
                setLoadedImage({
                  url: next.currentSrc || next.src,
                  aspect: next.naturalWidth / next.naturalHeight,
                });
              }
            }}
            className="absolute inset-0 h-full w-full bg-white object-contain p-1.5 sm:p-2 lg:p-2.5 opacity-100 transition-opacity duration-500 ease-out"
          />
        )}
        {!figure.imageUrl && figure.status !== "idle" && !figure.hideFigure && (
          <MissingFigureNotice figure={figure} />
        )}
        <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-black/5" />
      </div>
      {/* Caption block — separate row below the image so it never covers it. */}
      {figure.imageUrl && figure.caption && (
        <figcaption
          className="mt-2 rounded-xl bg-bg-secondary/40 px-3.5 py-2.5 text-body leading-relaxed text-text-muted"
        >
          <span className="font-semibold text-heading">
            {sourceLabel(figure.source)}:
          </span>{" "}
          {figure.caption}
        </figcaption>
      )}
    </figure>
  );
}

export function PaperFigure(props: ResolveFigureArgs) {
  const figure = useResolvedFigure(props);
  return (
    <PaperFigureFrame
      figure={figure}
      alt={props.alt}
      variant={props.variant}
      hideOnMiss={props.hideOnMiss}
    />
  );
}

function MissingFigureNotice({ figure }: { figure: FigureState }) {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface px-5 text-center"
    >
      <p className="text-caption font-semibold uppercase tracking-[0.16em] text-text-faint">
        {noticeTitle(figure.status)}
      </p>
      <p className="max-w-[260px] text-meta leading-relaxed text-text-muted">
        {figure.reason ?? defaultReason(figure.status)}
      </p>
    </div>
  );
}

function noticeTitle(status: FigureState["status"]): string {
  if (status === "caption_mismatch") return "Caption match not confident";
  if (status === "no_figures") return "No extractable figures found";
  if (status === "paywalled") return "Figure source unavailable";
  if (status === "source_unavailable") return "Figure source unavailable";
  return "No verified paper figure found";
}

function defaultReason(status: FigureState["status"]): string {
  if (status === "caption_mismatch") {
    return "Peer reached a real figure source, but it could not confidently match a figure to this report section.";
  }
  if (status === "no_figures") {
    return "Peer reached the source page, but it did not expose extractable figures.";
  }
  if (status === "paywalled") {
    return "Peer reached the source, but figure access appears restricted.";
  }
  return "Peer could not reach a usable figure source.";
}

function sourceLabel(source: string | null): string {
  if (source === "semantic-scholar") return "Semantic Scholar figure";
  if (source === "ar5iv") return "arXiv figure";
  if (source === "publisher") return "Publisher figure";
  if (source === "open-access") return "Open-access figure";
  return "Paper figure";
}
