import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// HOME-READING-LAYOUT (ABC-JEV-INTEGRATION.md §1ag): the "Your reading" band
// on the home page collapsed to a ~120px shrink-to-fit column because it was
// a bare flex item with no width of its own, sharing a row with the upload +
// search pair — `LibraryGraph` then measured that collapsed width from its
// own wrapper (a ResizeObserver on clientWidth) and rendered its graph at the
// same narrow size. This repo has no harness for rendering the whole
// `DailyBriefingPage` (see the P4-S5b-FIX2 comment on that component: it
// depends on auth settling, batch acknowledgement, the paper digest loader,
// and other effects with no mocks in this file today), so — same pattern as
// `saved/page.test.tsx` — this renders just the row's own component,
// `ReadingStrip`, to static markup and asserts on its class string rather
// than on measured pixels (jsdom/ResizeObserver are not available in this
// project's "node" test environment either; see vitest.shared.ts).

const feedState = vi.hoisted(() => ({
  library: {} as Record<string, unknown>,
  savedPapers: [] as unknown[],
  readItems: {} as Record<string, boolean>,
  loadFeed: vi.fn(),
}));

const profileState = vi.hoisted(() => ({
  profile: { preferenceLedger: {}, softTopics: [] as string[] },
  leanOnTerm: vi.fn(),
  followTerm: vi.fn(),
}));

vi.mock("@/store/feed", () => ({
  useFeedStore: (selector?: (state: typeof feedState) => unknown) =>
    selector ? selector(feedState) : feedState,
}));

vi.mock("@/store/profile", () => ({
  useProfileStore: (selector?: (state: typeof profileState) => unknown) =>
    selector ? selector(profileState) : profileState,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { ReadingStrip } from "./page";

describe("ReadingStrip row width (HOME-READING-LAYOUT)", () => {
  it("gives the band a real width in the row instead of shrink-to-fit", () => {
    // One read paper is enough for buildLibraryGraph to report a non-empty
    // library (`counts.read + counts.saved > 0`), which is what makes
    // ReadingStrip render its Band/LibraryGraph instead of returning null.
    feedState.library = {
      "paper:read-1": {
        id: "paper:read-1",
        title: "A read paper",
        venue: "Test Venue",
        readAt: "2026-09-01",
        filed: [],
        terms: ["battery materials"],
      },
    };
    feedState.savedPapers = [];
    feedState.readItems = { "paper:read-1": true };

    const html = renderToStaticMarkup(
      createElement(ReadingStrip, {
        papers: [],
        readerTopics: [],
        className: "flex-auto min-w-0",
      }),
    );

    // The band that wraps LibraryGraph must carry the row's real-width
    // classes (passed down from page.tsx's row), not be left at whatever
    // Band's own default (no width classes at all) shrinks to. Specifically
    // `flex-auto` (`flex: 1 1 auto`), not the bare `flex-1` utility (`flex: 1
    // 1 0%`) — a zero flex-basis defeats `flex-wrap`'s own line-fit test on
    // a phone (see page.tsx's comment on this row; verified by execution).
    expect(html).toContain('class="flex-auto min-w-0"');
  });

  it("still renders nothing for a reader with no library yet (640c55ec)", () => {
    feedState.library = {};
    feedState.savedPapers = [];
    feedState.readItems = {};

    const html = renderToStaticMarkup(
      createElement(ReadingStrip, {
        papers: [],
        readerTopics: [],
        className: "flex-auto min-w-0",
      }),
    );

    expect(html).toBe("");
  });
});
