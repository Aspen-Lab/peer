import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Paper } from "@/types";
import { ApiError } from "@/lib/api";
import { buildReading } from "@/lib/papers/reading";
import {
  ABSTRACT_LABEL,
  NOT_FOUND,
  RETRY_LABEL,
  UPLOAD_RETRY_EMPTY_MESSAGE,
  UPLOAD_TRANSIENT_MESSAGE,
  UPLOAD_UNAVAILABLE_MESSAGE,
} from "@/components/reader/copy";

// UPLOAD-404 (§1bi): this file has no component-render harness for the
// default-exported page — `Reader` reaches `useRouter`, several Zustand
// stores and `IntersectionObserver` (the same limitation the sibling
// `app/page.tsx`'s own test documents in its header comment). These mocks
// exist only so importing `./page` (to reach the exported pure functions
// and `UploadFallbackReading`, the same pattern that file uses for
// `BriefingEmpty`/`ReadingStrip`) does not itself throw — no test here
// renders `PaperReadingPage`/`Reader`.
const feedState = vi.hoisted(() => ({
  papers: [] as unknown[],
  savedPapers: [] as unknown[],
  paperFeedback: {} as Record<string, unknown>,
  pendingDismissal: null as unknown,
  markRead: vi.fn(),
}));
const profileState = vi.hoisted(() => ({
  profile: {
    researchTopics: [] as string[],
    currentProject: "",
    currentChallenges: "",
    deepReportEnabled: false,
  },
  entitlement: null as unknown,
}));
const notesState = vi.hoisted(() => ({ notes: {} as Record<string, unknown>, add: vi.fn() }));

vi.mock("@/store/feed", () => ({
  useFeedStore: (selector?: (state: typeof feedState) => unknown) =>
    selector ? selector(feedState) : feedState,
}));
vi.mock("@/store/profile", () => ({
  useProfileStore: (selector?: (state: typeof profileState) => unknown) =>
    selector ? selector(profileState) : profileState,
}));
vi.mock("@/store/notes", () => ({
  useNotesStore: (selector?: (state: typeof notesState) => unknown) =>
    selector ? selector(notesState) : notesState,
  useNotesHydrated: () => true,
  notesCiting: () => [],
  readingNoteFor: () => undefined,
  newestFirst: (notes: Record<string, unknown>) => Object.values(notes),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

import {
  UploadFallbackReading,
  UploadRetryEmpty,
  isUploadFetchFailure,
  resolveUploadFallback,
  resolveUploadPageState,
  uploadFetchErrorKind,
} from "./page";

const uploadPaper: Paper = {
  id: "upload:aaaa000000000000",
  title: "A privately uploaded paper about solid electrolytes",
  authors: [],
  relevanceReason: "",
  venue: "",
  source: "other",
  summaryIntro:
    "This paper studies a new solid electrolyte for lithium metal batteries.",
  summaryExperimentKeywords: [],
  summaryResultDiscussion: "",
  isSaved: true,
  linkPaper: "/api/papers/upload/aaaa000000000000/file",
  textStatus: "ok",
};

// UPLOAD-404 (§1bi): true once the live fetch has actually settled with
// nothing, for an upload id — never while still in flight, never for a
// non-upload id, never once the fetch actually succeeded.
describe("isUploadFetchFailure (§1bi)", () => {
  it("is true once the live fetch has settled with nothing, for an upload id", () => {
    expect(isUploadFetchFailure(true, true, null)).toBe(true);
  });

  it("is false for a non-upload id, regardless of fetch state", () => {
    expect(isUploadFetchFailure(false, true, null)).toBe(false);
  });

  it("is false while the fetch is still in flight (not yet done)", () => {
    expect(isUploadFetchFailure(true, false, null)).toBe(false);
  });

  it("is false once the fetch has actually succeeded", () => {
    expect(isUploadFetchFailure(true, true, uploadPaper)).toBe(false);
  });
});

// UPLOAD-404 (§1bi.8b): a 404 is the only PERMANENT outcome; every other
// failure (another HTTP status, or a plain Error/TypeError from a dropped
// connection) is treated as transient, since the client cannot otherwise
// tell a real server problem from a momentary one.
describe("uploadFetchErrorKind (§1bi.8b)", () => {
  it("is 'not-found' for a 404 ApiError", () => {
    expect(uploadFetchErrorKind(new ApiError("HTTP 404", 404))).toBe("not-found");
  });

  it("is 'transient' for a 500 ApiError", () => {
    expect(uploadFetchErrorKind(new ApiError("HTTP 500", 500))).toBe("transient");
  });

  it("is 'transient' for a 503 ApiError", () => {
    expect(uploadFetchErrorKind(new ApiError("HTTP 503", 503))).toBe("transient");
  });

  it("is 'transient' for a plain network Error (no status at all)", () => {
    expect(uploadFetchErrorKind(new TypeError("Failed to fetch"))).toBe("transient");
  });

  it("is 'transient' for anything unrecognizable — never assumed permanent", () => {
    expect(uploadFetchErrorKind("a plain string, not even an Error")).toBe("transient");
    expect(uploadFetchErrorKind(undefined)).toBe("transient");
  });

  // UPLOAD-FETCH-TIMEOUT: an aborted/timed-out fetch rejects with a
  // DOMException named "AbortError" (the Fetch spec's own shape, in both
  // the browser and Node's fetch) — never an ApiError, so this is already
  // "transient" by construction. Pinned explicitly (rather than relying on
  // the catch-all case above) so a future change cannot special-case a
  // timeout into the permanent branch without this test going red.
  it("is 'transient' for an aborted/timed-out fetch, never the permanent 404 outcome", () => {
    expect(
      uploadFetchErrorKind(new DOMException("The operation was aborted.", "AbortError")),
    ).toBe("transient");
  });
});

describe("resolveUploadFallback (§1bi)", () => {
  it("returns the saved copy with linkPaper stripped — every other field preserved", () => {
    const fallback = resolveUploadFallback(uploadPaper);
    expect(fallback).toBeDefined();
    expect(fallback?.linkPaper).toBeUndefined();
    expect(fallback?.title).toBe(uploadPaper.title);
    expect(fallback?.summaryIntro).toBe(uploadPaper.summaryIntro);
    expect(fallback?.isSaved).toBe(true);
    expect(fallback?.id).toBe(uploadPaper.id);
  });

  // Guide B, Task 5 item 2 / the ruling's "if no saved copy exists either,
  // keep an honest not-available message (never a guess)": `undefined` here
  // is what makes `PaperReadingPage`'s existing `baseContent` fall through
  // to its unchanged, already-honest NOT_FOUND branch — no new copy needed
  // for that case.
  it("returns undefined when there is no saved copy either", () => {
    expect(resolveUploadFallback(undefined)).toBeUndefined();
  });
});

// UPLOAD-404 (§1bi.8): the one place every signal about an upload id is
// combined into what the page shows — the full truth table A's review asked
// for, each case here matching a row of the reader-view table in its report
// (docs/jev-abc/UPLOAD-404-A-20260929T203148Z.md).
describe("resolveUploadPageState (§1bi.8)", () => {
  const fileMissingPaper: Paper = { ...uploadPaper, fileAvailable: false };
  const fileAvailablePaper: Paper = { ...uploadPaper, fileAvailable: true };

  it("is normal (not unavailable) once the fetch succeeds with the file available", () => {
    const state = resolveUploadPageState({
      isUploadId: true,
      fetchDoneForId: true,
      fetchedPaperForId: fileAvailablePaper,
      errorKind: "none",
      storePaper: undefined,
    });
    expect(state).toEqual({ unavailable: false, fallbackPaper: undefined, transient: false });
  });

  // §1bi.8a — table row 6: record 200, file missing. Content is the FRESH
  // record (not the saved copy, even when one exists — the live record
  // wins), never transient (a 200 is a definite fact).
  it("§1bi.8a: is unavailable, using the fresh record's own content, when the record is fine but the file is missing", () => {
    const savedCopy: Paper = { ...uploadPaper, title: "A stale saved title" };
    const state = resolveUploadPageState({
      isUploadId: true,
      fetchDoneForId: true,
      fetchedPaperForId: fileMissingPaper,
      errorKind: "none",
      storePaper: savedCopy,
    });
    expect(state.unavailable).toBe(true);
    expect(state.transient).toBe(false);
    expect(state.fallbackPaper?.title).toBe(fileMissingPaper.title);
    expect(state.fallbackPaper?.linkPaper).toBeUndefined();
  });

  // Table row 3 — a permanent (404) failure with a saved copy: unavailable,
  // not transient, content is the saved copy.
  it("is unavailable using the saved copy, not transient, for a 404 with a saved copy", () => {
    const state = resolveUploadPageState({
      isUploadId: true,
      fetchDoneForId: true,
      fetchedPaperForId: null,
      errorKind: "not-found",
      storePaper: uploadPaper,
    });
    expect(state.unavailable).toBe(true);
    expect(state.transient).toBe(false);
    expect(state.fallbackPaper?.id).toBe(uploadPaper.id);
    expect(state.fallbackPaper?.linkPaper).toBeUndefined();
  });

  // Table row 4 — a permanent (404) failure with NO saved copy: unavailable
  // but nothing to show (the page's existing, unchanged NOT_FOUND).
  it("is unavailable with no fallback content for a 404 with no saved copy", () => {
    const state = resolveUploadPageState({
      isUploadId: true,
      fetchDoneForId: true,
      fetchedPaperForId: null,
      errorKind: "not-found",
      storePaper: undefined,
    });
    expect(state.unavailable).toBe(true);
    expect(state.transient).toBe(false);
    expect(state.fallbackPaper).toBeUndefined();
  });

  // Table row 5 — a TRANSIENT failure with a saved copy: unavailable AND
  // transient, content is the saved copy.
  it("is unavailable AND transient using the saved copy, for a 5xx/network failure with a saved copy", () => {
    for (const errorKind of ["transient"] as const) {
      const state = resolveUploadPageState({
        isUploadId: true,
        fetchDoneForId: true,
        fetchedPaperForId: null,
        errorKind,
        storePaper: uploadPaper,
      });
      expect(state.unavailable).toBe(true);
      expect(state.transient).toBe(true);
      expect(state.fallbackPaper?.id).toBe(uploadPaper.id);
    }
  });

  // The new case A's finding named but no earlier table row covered: a
  // transient failure with NO saved copy either — unavailable, transient,
  // but no content (the page's new retry-empty state, never NOT_FOUND).
  it("is unavailable AND transient with no fallback content, for a 5xx/network failure with no saved copy", () => {
    const state = resolveUploadPageState({
      isUploadId: true,
      fetchDoneForId: true,
      fetchedPaperForId: null,
      errorKind: "transient",
      storePaper: undefined,
    });
    expect(state.unavailable).toBe(true);
    expect(state.transient).toBe(true);
    expect(state.fallbackPaper).toBeUndefined();
  });

  it("is never unavailable for a non-upload id, regardless of every other signal", () => {
    const state = resolveUploadPageState({
      isUploadId: false,
      fetchDoneForId: true,
      fetchedPaperForId: null,
      errorKind: "transient",
      storePaper: uploadPaper,
    });
    expect(state.unavailable).toBe(false);
    expect(state.fallbackPaper).toBeUndefined();
  });

  it("is never unavailable while the fetch is still in flight", () => {
    const state = resolveUploadPageState({
      isUploadId: true,
      fetchDoneForId: false,
      fetchedPaperForId: null,
      errorKind: "none",
      storePaper: uploadPaper,
    });
    expect(state.unavailable).toBe(false);
  });
});

describe("UploadFallbackReading (§1bi)", () => {
  const fallbackPaper = resolveUploadFallback(uploadPaper)!;
  const reading = buildReading(fallbackPaper, null);
  const render = () =>
    renderToStaticMarkup(
      createElement(UploadFallbackReading, {
        paper: fallbackPaper,
        reading,
        now: Date.now(),
        onBack: () => {},
      }),
    );

  it("shows the saved title and offers the saved abstract, plus the honest sentence — never the generic not-found text", () => {
    const html = render();
    expect(html).toContain("A privately uploaded paper about solid electrolytes");
    // The abstract itself is collapsed by default on every paper's reading
    // page (abstract-toggle.tsx, 8-03/S25) — a click reveals it, which this
    // repo has no harness to simulate. The toggle button's own presence is
    // what proves `PaperWords` actually received the saved abstract text
    // (an empty abstract renders no toggle at all — see the "degrades
    // gracefully" case below).
    expect(html).toContain(ABSTRACT_LABEL);
    expect(html).toContain(UPLOAD_UNAVAILABLE_MESSAGE);
    expect(html).not.toContain(NOT_FOUND);
  });

  it("hides every PDF-only action — no Publisher door, no open/delete affordance", () => {
    const html = render();
    // linkPaper was already stripped by resolveUploadFallback, so
    // RecordBlock's doors() never includes a "Publisher" link — the one
    // place inside this page that could otherwise reopen the same
    // now-unreachable file-bytes route.
    expect(html).not.toContain("Publisher");
    // No PrivatePdfStatus at all in this branch: its "retained for 30 days"
    // line would be false here (the opposite is true), and its Delete/
    // Forget actions would act on a record we already know is unreachable.
    expect(html).not.toContain("Delete PDF");
    expect(html).not.toContain("retained for 30 days");
    expect(html).not.toContain("Forget what Peer learned from this");
  });

  it("still shows the reader's own notes band", () => {
    expect(render()).toContain("Your notes");
  });

  it("still offers a way back to the briefing", () => {
    expect(render()).toContain("Briefing");
  });

  // A saved copy whose ORIGINAL pdf also had no extractable text
  // (`textStatus: "empty"`) still gets this honest "unavailable" treatment
  // rather than the unrelated PDF_NO_TEXT_MESSAGE — see the call-site
  // ordering comment in page.tsx. This only proves the component itself
  // renders sensibly (no abstract to show) for that shape; the call-site
  // ordering itself is a source-text check below.
  it("degrades gracefully when the saved copy has no abstract text at all", () => {
    const emptyTextPaper: Paper = { ...fallbackPaper, summaryIntro: "", textStatus: "empty" };
    const emptyReading = buildReading(emptyTextPaper, null);
    const html = renderToStaticMarkup(
      createElement(UploadFallbackReading, {
        paper: emptyTextPaper,
        reading: emptyReading,
        now: Date.now(),
        onBack: () => {},
      }),
    );
    expect(html).toContain(UPLOAD_UNAVAILABLE_MESSAGE);
    expect(html).not.toContain(NOT_FOUND);
    // Nothing to expand — PaperWords renders no toggle at all rather than
    // an empty one, the same honest-absence behavior any paper with no
    // abstract gets.
    expect(html).not.toContain(ABSTRACT_LABEL);
  });
});

// UPLOAD-404 (§1bi.8b): the same component, now asked for its transient
// variant — a different, non-permanent sentence plus a Try again control,
// never `UPLOAD_UNAVAILABLE_MESSAGE`'s permanent wording, never NOT_FOUND.
describe("UploadFallbackReading — transient (§1bi.8b)", () => {
  const fallbackPaper = resolveUploadFallback(uploadPaper)!;
  const reading = buildReading(fallbackPaper, null);

  it("shows the transient sentence and a Try again control instead of the permanent one, when transient", () => {
    const onRetry = vi.fn();
    const html = renderToStaticMarkup(
      createElement(UploadFallbackReading, {
        paper: fallbackPaper,
        reading,
        now: Date.now(),
        onBack: () => {},
        transient: true,
        onRetry,
      }),
    );
    expect(html).toContain(UPLOAD_TRANSIENT_MESSAGE);
    expect(html).toContain(RETRY_LABEL);
    expect(html).not.toContain(UPLOAD_UNAVAILABLE_MESSAGE);
    expect(html).not.toContain(NOT_FOUND);
  });

  it("shows the permanent sentence and no Try again control by default (transient omitted)", () => {
    const html = renderToStaticMarkup(
      createElement(UploadFallbackReading, {
        paper: fallbackPaper,
        reading,
        now: Date.now(),
        onBack: () => {},
      }),
    );
    expect(html).toContain(UPLOAD_UNAVAILABLE_MESSAGE);
    expect(html).not.toContain(UPLOAD_TRANSIENT_MESSAGE);
    expect(html).not.toContain(RETRY_LABEL);
  });

  it("shows no Try again control when transient is explicitly false, even with an onRetry handler supplied", () => {
    const html = renderToStaticMarkup(
      createElement(UploadFallbackReading, {
        paper: fallbackPaper,
        reading,
        now: Date.now(),
        onBack: () => {},
        transient: false,
        onRetry: vi.fn(),
      }),
    );
    expect(html).not.toContain(RETRY_LABEL);
  });
});

// UPLOAD-404 (§1bi.8b): the no-content-at-all transient state — never
// NOT_FOUND, which would claim a permanent fact this page cannot back up.
describe("UploadRetryEmpty (§1bi.8b)", () => {
  it("shows the retry-empty sentence, a Try again control and a way back — never Paper not found", () => {
    const html = renderToStaticMarkup(
      createElement(UploadRetryEmpty, { onBack: () => {}, onRetry: () => {} }),
    );
    expect(html).toContain(UPLOAD_RETRY_EMPTY_MESSAGE);
    expect(html).toContain(RETRY_LABEL);
    expect(html).toContain("Briefing");
    expect(html).not.toContain(NOT_FOUND);
  });
});

// UPLOAD-404 (§1bi.2): the home page and this page both gate their
// `<UploadButton />` on the availability check — proved at the predicate
// level in use-uploads-available.test.ts. This is the wiring-stays-wired
// guard for THIS file's own call site, the same technique page.test.tsx
// already uses for its "ReadingStrip call site keeps its width classes"
// check, since this repo has no harness to render the whole effectful page.
describe("page.tsx source — uploadAction call site stays gated on uploadsAvailable (§1bi.2)", () => {
  it("passes uploadsAvailable at the uploadAction call site", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
    const start = source.indexOf("uploadAction={");
    expect(start).toBeGreaterThan(-1);
    const callSite = source.slice(start, source.indexOf("\n", start));
    expect(callSite).toContain("uploadsAvailable");
  });
});

// UPLOAD-404 (§1bi.8b): "Try again" has no separate fetch of its own to
// test — it re-arms the SAME existing, already-covered fetch effect by
// resetting this id's own result back to "not done" (`shouldFetchById` is
// already gated on `!fetchDoneForId`). These source checks prove the reset
// shape and that every place a retry control can render is actually wired
// to it, since this repo has no harness to render the whole effectful page
// and exercise the reset live.
describe("page.tsx source — retry wiring stays connected (§1bi.8b)", () => {
  it("retryUploadFetch resets the fetch result to not-done with no error kind", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
    const start = source.indexOf("const retryUploadFetch");
    expect(start).toBeGreaterThan(-1);
    // A fixed-size window rather than searching for the closing `);` by
    // exact text — the dependency array's own contents are a lint/compiler
    // detail (see react-hooks/preserve-manual-memoization), not something
    // this test should pin.
    const body = source.slice(start, start + 400);
    expect(body).toContain("done: false");
    expect(body).toContain('errorKind: "none"');
  });

  it("the no-content retry state passes retryUploadFetch as its onRetry", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
    const start = source.indexOf("<UploadRetryEmpty");
    expect(start).toBeGreaterThan(-1);
    const callSite = source.slice(start, source.indexOf("/>", start) + 2);
    expect(callSite).toContain("onRetry={retryUploadFetch}");
  });

  it("the reader's own fallback view passes transient and a conditional onRetry through", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
    const start = source.indexOf("<UploadFallbackReading");
    expect(start).toBeGreaterThan(-1);
    const callSite = source.slice(start, source.indexOf("/>", start) + 2);
    expect(callSite).toContain("transient={uploadTransient}");
    expect(callSite).toContain("onRetry={uploadTransient ? onRetryUpload : undefined}");
  });
});

// UPLOAD-FETCH-TIMEOUT: the record fetch effect itself has no render
// harness (same reason as every other check in this file that reads the
// source directly) and no test environment can wait out a real 15s timer,
// so this proves the wiring the same way page.test.tsx already proves the
// retry wiring above — by reading the actual effect's source text, not by
// re-describing it from memory.
describe("page.tsx source — the upload record fetch has a timeout (UPLOAD-FETCH-TIMEOUT)", () => {
  function fetchEffectBody(source: string): string {
    // A marker with no embedded newline, so it matches regardless of this
    // file's own line-ending convention (CRLF here, per `git ls-files --eol`).
    const start = source.indexOf("if (!shouldFetchById) return;");
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf("}, [id, fetchKey, shouldFetchById, isUploadId]);", start);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
  }

  it("defines a named ~15s timeout constant, used by the effect", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/const UPLOAD_FETCH_TIMEOUT_MS = 15000;/);
    expect(fetchEffectBody(source)).toContain("UPLOAD_FETCH_TIMEOUT_MS");
  });

  it("creates an AbortController and aborts it after the timeout, only for the upload id", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
    const body = fetchEffectBody(source);
    // Scoped: the controller only exists when isUploadId is true, so a
    // non-upload (external-id) fetch is never given a signal at all.
    expect(body).toContain("isUploadId ? new AbortController()");
    expect(body).toContain("window.setTimeout(() => controller.abort(), UPLOAD_FETCH_TIMEOUT_MS)");
    expect(body).toContain("controller ? { signal: controller.signal } : undefined");
  });

  it("clears the timer once the fetch settles, so it never fires after a normal finish", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
    const body = fetchEffectBody(source);
    const finallyStart = body.indexOf(".finally(");
    expect(finallyStart).toBeGreaterThan(-1);
    expect(body.slice(finallyStart)).toContain("window.clearTimeout(timer)");
  });

  it("the cleanup aborts the controller and clears the timer, alongside the existing no-state-after-unmount guard", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
    const body = fetchEffectBody(source);
    const cleanupStart = body.lastIndexOf("return () => {");
    expect(cleanupStart).toBeGreaterThan(-1);
    const cleanup = body.slice(cleanupStart);
    // The pre-existing guard (UPLOAD-404's own effect already had this):
    // flips first, so neither `.then` nor `.catch` can set state after
    // unmount/id-change, for either branch (upload or non-upload).
    expect(cleanup).toContain("cancelled = true");
    // New in this item: also clear the timer and actually abort the
    // in-flight request for the upload branch (a no-op when `controller`
    // is undefined, i.e. the non-upload branch — unchanged there).
    expect(cleanup).toContain("window.clearTimeout(timer)");
    expect(cleanup).toContain("controller?.abort()");
  });
});
