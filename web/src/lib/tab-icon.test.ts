import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTabIconHref, paintTabIcon, readMarkTokens, startTabIconSync } from "@/lib/tab-icon";

// TAB-ICON-THEME (ABC-JEV-INTEGRATION.md §1ae). This repo's tests run in
// Vitest's Node environment (vitest.config.ts, confirmed by
// src/lib/theme.test.ts's own comment) — no jsdom, no DOM at all unless a
// test stubs one. Same pattern as theme.test.ts's coverage of
// withZoomTransition: stub just enough of `document`/`window` with
// `vi.stubGlobal` to exercise the branches.

// globals.css's own authoritative hex values (html[data-accent="…"]'s seed /
// seed-dark, and --color-heading per mode) — mirrored here as the oracle a
// correct repaint must match for every accent x mode pair. Cross-checked by
// live execution against the running dev server at Step 0 (checkpoint
// docs/jev-abc/TAB-ICON-THEME-C-20260928T025417Z.md): forcing
// data-mode="dark" + data-accent="rose" on the real page resolved
// --color-accent to #f0559a — exactly the rose/dark row below.
const ACCENT_SEEDS = {
  ember: { light: "#ff520d", dark: "#ff6a2b" },
  rose: { light: "#e0347c", dark: "#f0559a" },
  marigold: { light: "#d98e04", dark: "#eaa61e" },
  sage: { light: "#2e7d5b", dark: "#4aa87d" },
  indigo: { light: "#3f5bd9", dark: "#7a90f2" },
  violet: { light: "#7a3fd9", dark: "#a078f0" },
} as const;
type Accent = keyof typeof ACCENT_SEEDS;
type Mode = "light" | "dark";
const HEADING: Record<Mode, string> = { light: "#1d1d1d", dark: "#f3f3f3" };

const ICON_HREF_PREFIX = "data:image/svg+xml,";

function decodeHref(href: string): string {
  expect(href.startsWith(ICON_HREF_PREFIX)).toBe(true);
  return decodeURIComponent(href.slice(ICON_HREF_PREFIX.length));
}

/** Stubs `getComputedStyle` to resolve exactly like globals.css would for
 *  this accent x mode pair — the same two custom properties the masthead's
 *  Mark reads (--color-heading, --color-accent). */
function stubComputedStyle(mode: Mode, accent: Accent) {
  const values: Record<string, string> = {
    "--color-heading": HEADING[mode],
    "--color-accent": ACCENT_SEEDS[accent][mode],
  };
  vi.stubGlobal("getComputedStyle", () => ({
    getPropertyValue: (name: string) => values[name] ?? "",
  }));
}

/** Fake MutationObserver: captures the callback via closure (no static
 *  fields, no non-null assertions needed at call sites) and exposes a
 *  `fire` helper plus `observe`/`disconnect` spies. */
function stubMutationObserver() {
  let callback: MutationCallback = () => {};
  const observe = vi.fn();
  const disconnect = vi.fn();
  class FakeMutationObserver {
    constructor(cb: MutationCallback) {
      callback = cb;
    }
    observe = observe;
    disconnect = disconnect;
  }
  vi.stubGlobal("MutationObserver", FakeMutationObserver);
  return {
    observe,
    disconnect,
    fire: (attributeName: string) =>
      callback([{ attributeName } as MutationRecord], {} as MutationObserver),
  };
}

/**
 * Fake `window`: `matchMedia("(prefers-color-scheme: dark)")` (round 2) plus
 * a top-level `addEventListener`/`removeEventListener` pair for the `focus`
 * event (round 3, §1am hardening for F1). `startTabIconSync` paints
 * synchronously on mount (round 2 removed the two-animation-frame deferral
 * round 1 needed — see that function's own comment: the race was specific
 * to Next's file-based metadata `<link>`, which no longer exists, and
 * removing the deferral was retested by execution against the real dev
 * server), so no rAF stubbing is needed here.
 *
 * `removeEventListener` (both the mql-level one below and the window-level
 * one) actually clears the captured closure, not just a spy call: firing
 * after removal must be a true no-op, the same standard the existing
 * observer/media tests already hold `disconnect()` to.
 */
function stubWindow(initialMatches: boolean) {
  let schemeListener: (() => void) | null = null;
  const addEventListener = vi.fn((_event: string, cb: () => void) => {
    schemeListener = cb;
  });
  const removeEventListener = vi.fn((_event: string, cb: () => void) => {
    if (schemeListener === cb) schemeListener = null;
  });
  const mql = { matches: initialMatches, addEventListener, removeEventListener };

  let focusListener: (() => void) | null = null;
  const windowAddEventListener = vi.fn((event: string, cb: () => void) => {
    if (event === "focus") focusListener = cb;
  });
  const windowRemoveEventListener = vi.fn((event: string, cb: () => void) => {
    if (event === "focus" && focusListener === cb) focusListener = null;
  });

  vi.stubGlobal("window", {
    matchMedia: () => mql,
    addEventListener: windowAddEventListener,
    removeEventListener: windowRemoveEventListener,
  });

  return {
    mql,
    addEventListener,
    removeEventListener,
    fireSchemeChange: () => schemeListener?.(),
    windowAddEventListener,
    windowRemoveEventListener,
    fireFocus: () => focusListener?.(),
  };
}

/** `querySelector` only returns the fixture link for the exact id the
 *  hand-authored <link> in layout.tsx carries — unlike round 1's stub
 *  (which returned the fixture for ANY selector string, so it could never
 *  have caught a selector regression), this one actually pins the constant
 *  `paintTabIcon` uses internally. Returns the spy so a test can assert
 *  what string it was called with, not just that a link was found.
 *
 *  Round 3 (§1am, F1 hardening) adds a `visibilitychange` listener slot,
 *  with a settable `visibilityState` (defaults `"visible"`) so a test can
 *  simulate the tab being hidden then becoming visible again. Like
 *  `stubWindow`'s listeners, `removeEventListener` actually clears the
 *  captured closure rather than only recording the call. */
function stubDocument(opts: {
  link: { href: string } | null;
  dataMode: string;
  dataAccent: string;
  createElement?: ReturnType<typeof vi.fn>;
  visibilityState?: "visible" | "hidden";
}) {
  const root = {
    getAttribute: (name: string) =>
      name === "data-mode" ? opts.dataMode : name === "data-accent" ? opts.dataAccent : null,
  };
  const querySelector = vi.fn((selector: string) => (selector === "#peer-tab-icon" ? opts.link : null));
  let visibilityListener: (() => void) | null = null;
  const addEventListener = vi.fn((event: string, cb: () => void) => {
    if (event === "visibilitychange") visibilityListener = cb;
  });
  const removeEventListener = vi.fn((event: string, cb: () => void) => {
    if (event === "visibilitychange" && visibilityListener === cb) visibilityListener = null;
  });
  const doc = {
    documentElement: root,
    querySelector,
    createElement: opts.createElement ?? vi.fn(),
    addEventListener,
    removeEventListener,
    visibilityState: opts.visibilityState ?? "visible",
  };
  vi.stubGlobal("document", doc);
  return {
    root,
    querySelector,
    addEventListener,
    removeEventListener,
    setVisibility: (state: "visible" | "hidden") => {
      doc.visibilityState = state;
    },
    fireVisibilityChange: () => visibilityListener?.(),
  };
}

describe("buildTabIconHref", () => {
  it("encodes the same 64x64 geometry as icon.svg / masthead.tsx's Mark, with the given fills", () => {
    const svg = decodeHref(buildTabIconHref("#1d1d1d", "#ff520d"));
    expect(svg).toContain('viewBox="0 0 64 64"');
    expect(svg).toContain('<rect x="4" y="4" width="56" height="56" fill="#1d1d1d"/>');
    expect(svg).toContain('<path d="M30 4h30v10H30z" fill="#ff520d"/>');
    expect(svg).toContain('<path d="M50 4h10v30H50z" fill="#ff520d"/>');
  });
});

describe("readMarkTokens", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns null when document is unavailable", () => {
    expect(readMarkTokens()).toBeNull();
  });

  it("returns null when a token is unresolved, rather than painting a blank/black icon", () => {
    vi.stubGlobal("document", { documentElement: {} });
    vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "" }));
    expect(readMarkTokens()).toBeNull();
  });

  for (const mode of ["light", "dark"] as const) {
    for (const accent of Object.keys(ACCENT_SEEDS) as Accent[]) {
      it(`reads ${accent}/${mode} exactly as globals.css resolves it`, () => {
        vi.stubGlobal("document", { documentElement: {} });
        stubComputedStyle(mode, accent);
        expect(readMarkTokens()).toEqual({
          sheet: HEADING[mode],
          corner: ACCENT_SEEDS[accent][mode],
        });
      });
    }
  }
});

describe("paintTabIcon", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is a no-op when the icon <link> is not found (defensive; Step 0 shows exactly one always renders live)", () => {
    stubDocument({ link: null, dataMode: "light", dataAccent: "ember" });
    stubComputedStyle("light", "ember");
    expect(() => paintTabIcon()).not.toThrow();
  });

  it("never creates a second link — it only mutates the href of the one hand-authored #peer-tab-icon link", () => {
    const link = { href: "/icon.svg" };
    const createElement = vi.fn();
    stubDocument({ link, dataMode: "dark", dataAccent: "rose", createElement });
    stubComputedStyle("dark", "rose");
    paintTabIcon();
    expect(createElement).not.toHaveBeenCalled();
    expect(link.href).not.toBe("/icon.svg");
    expect(decodeHref(link.href)).toContain(`fill="${ACCENT_SEEDS.rose.dark}"`);
  });

  it("targets the link by #peer-tab-icon specifically — layout.tsx's hand-authored id, not a guess at Next-generated attributes", () => {
    const link = { href: "" };
    const { querySelector } = stubDocument({ link, dataMode: "light", dataAccent: "ember" });
    stubComputedStyle("light", "ember");
    paintTabIcon();
    expect(querySelector).toHaveBeenCalledWith("#peer-tab-icon");
    // Same call actually found and painted the real link, not a coincidental pass:
    expect(decodeHref(link.href)).toContain(`fill="${ACCENT_SEEDS.ember.light}"`);
  });

  for (const mode of ["light", "dark"] as const) {
    for (const accent of Object.keys(ACCENT_SEEDS) as Accent[]) {
      it(`paints ${accent}/${mode}'s sheet+corner onto the existing <link>`, () => {
        const link = { href: "" };
        stubDocument({ link, dataMode: mode, dataAccent: accent });
        stubComputedStyle(mode, accent);
        paintTabIcon();
        const svg = decodeHref(link.href);
        expect(svg).toContain(`fill="${HEADING[mode]}"`);
        expect(svg).toContain(`fill="${ACCENT_SEEDS[accent][mode]}"`);
      });
    }
  }
});

describe("startTabIconSync", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("paints synchronously on mount, not deferred", () => {
    // Round 1 deferred the first paint across two animation frames because
    // painting synchronously raced Next's hydration of the file-based
    // metadata icon <link>. Round 2 moved the link into layout.tsx's own
    // plain, persistent JSX (no such race target any more) and retested by
    // execution against the real dev server with a synchronous paint: 7
    // fresh loads + 3 in-app navigations + a history-back all stayed at
    // exactly one link, correctly painted, no hydration warning (round-2 C
    // checkpoint). This test pins the synchronous behaviour itself.
    const link = { href: "" };
    stubDocument({ link, dataMode: "light", dataAccent: "ember" });
    stubMutationObserver();
    stubWindow(false);
    stubComputedStyle("light", "ember");

    startTabIconSync();

    expect(decodeHref(link.href)).toContain(`fill="${HEADING.light}"`);
    expect(decodeHref(link.href)).toContain(`fill="${ACCENT_SEEDS.ember.light}"`);
  });

  it("repaints when data-mode/data-accent change on <html> (MutationObserver fires)", () => {
    const link = { href: "" };
    stubDocument({ link, dataMode: "light", dataAccent: "ember" });
    const observer = stubMutationObserver();
    stubWindow(false);
    stubComputedStyle("light", "ember");
    startTabIconSync();
    const before = link.href;

    stubComputedStyle("dark", "violet");
    observer.fire("data-accent");

    expect(link.href).not.toBe(before);
    expect(decodeHref(link.href)).toContain(`fill="${ACCENT_SEEDS.violet.dark}"`);
  });

  it("ignores mutations that touch neither data-mode nor data-accent", () => {
    const link = { href: "" };
    stubDocument({ link, dataMode: "light", dataAccent: "ember" });
    const observer = stubMutationObserver();
    stubWindow(false);
    stubComputedStyle("light", "ember");
    startTabIconSync();
    const before = link.href;

    stubComputedStyle("dark", "violet"); // would change the paint IF it ran
    observer.fire("class");

    expect(link.href).toBe(before);
  });

  it("system mode: repaints when the OS colour scheme changes", () => {
    const link = { href: "" };
    stubDocument({ link, dataMode: "system", dataAccent: "sage" });
    stubMutationObserver();
    const win = stubWindow(false);
    stubComputedStyle("light", "sage");
    startTabIconSync();
    const before = link.href;

    stubComputedStyle("dark", "sage");
    win.fireSchemeChange();

    expect(link.href).not.toBe(before);
    expect(decodeHref(link.href)).toContain(`fill="${ACCENT_SEEDS.sage.dark}"`);
  });

  it("explicit mode: does NOT repaint when the OS colour scheme changes", () => {
    const link = { href: "" };
    stubDocument({ link, dataMode: "light", dataAccent: "sage" });
    stubMutationObserver();
    const win = stubWindow(false);
    stubComputedStyle("light", "sage");
    startTabIconSync();
    const before = link.href;

    stubComputedStyle("dark", "sage"); // would change the paint IF it ran
    win.fireSchemeChange();

    expect(link.href).toBe(before);
  });

  it("disconnects the observer and removes the media-query listener on unmount", () => {
    const link = { href: "" };
    stubDocument({ link, dataMode: "system", dataAccent: "ember" });
    const observer = stubMutationObserver();
    const win = stubWindow(false);
    stubComputedStyle("light", "ember");
    const stop = startTabIconSync();

    stop();

    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(win.removeEventListener).toHaveBeenCalledOnce();
  });

  it("never creates or appends a second link across mount, a mutation repaint, an OS-scheme repaint, a visibility repaint, and a focus repaint (§1am F1 hardening covered too)", () => {
    const link = { href: "" };
    const createElement = vi.fn();
    const doc = stubDocument({ link, dataMode: "system", dataAccent: "ember", createElement });
    const observer = stubMutationObserver();
    const win = stubWindow(false);
    stubComputedStyle("light", "ember");
    const stop = startTabIconSync();

    stubComputedStyle("dark", "ember");
    observer.fire("data-mode");
    win.fireSchemeChange();
    doc.setVisibility("visible");
    doc.fireVisibilityChange();
    win.fireFocus();
    stop();

    expect(createElement).not.toHaveBeenCalled();
  });

  it("is a safe no-op (no throw) when MutationObserver is unavailable", () => {
    const link = { href: "" };
    stubDocument({ link, dataMode: "light", dataAccent: "ember" });
    stubWindow(false);
    stubComputedStyle("light", "ember");
    expect(() => startTabIconSync()).not.toThrow();
  });

  // §1am (round 3) — F1 hardening: while mode = system, ALSO repaint when
  // the page becomes visible again and on window focus. A2's review
  // (docs/jev-abc/TAB-ICON-THEME-A2-20260928T042554Z.md) could not get a
  // live OS-scheme flip to reach the `change` listener under the in-app
  // browser tool's colour-scheme emulation; these two paths are the ones
  // that ARE verifiable with that tool (flip the scheme in a background
  // pane tab, then return) and the ones most likely to matter for a real
  // user, since an OS-wide scheme switch usually happens while the tab is
  // not focused.
  describe("§1am F1 hardening — visibilitychange and focus, system mode only", () => {
    it("repaints with the NEW scheme's colours when the page becomes visible again", () => {
      const link = { href: "" };
      const doc = stubDocument({ link, dataMode: "system", dataAccent: "sage", visibilityState: "hidden" });
      stubMutationObserver();
      stubWindow(false);
      stubComputedStyle("light", "sage");
      startTabIconSync();
      const before = link.href;

      stubComputedStyle("dark", "sage");
      // Firing while still hidden must NOT repaint — proves the
      // `visibilityState === "visible"` guard is actually load-bearing,
      // not merely present (a test that only checked the visible case
      // could still pass with that guard deleted).
      doc.fireVisibilityChange();
      expect(link.href).toBe(before);

      doc.setVisibility("visible");
      doc.fireVisibilityChange();
      expect(link.href).not.toBe(before);
      expect(decodeHref(link.href)).toContain(`fill="${ACCENT_SEEDS.sage.dark}"`);
    });

    it("repaints on window focus", () => {
      const link = { href: "" };
      stubDocument({ link, dataMode: "system", dataAccent: "indigo" });
      stubMutationObserver();
      const win = stubWindow(false);
      stubComputedStyle("light", "indigo");
      startTabIconSync();
      const before = link.href;

      stubComputedStyle("dark", "indigo");
      win.fireFocus();

      expect(link.href).not.toBe(before);
      expect(decodeHref(link.href)).toContain(`fill="${ACCENT_SEEDS.indigo.dark}"`);
    });

    for (const mode of ["light", "dark"] as const) {
      it(`explicit ${mode} mode: neither visibilitychange nor focus repaints`, () => {
        const link = { href: "" };
        const doc = stubDocument({ link, dataMode: mode, dataAccent: "marigold", visibilityState: "hidden" });
        stubMutationObserver();
        const win = stubWindow(false);
        stubComputedStyle(mode, "marigold");
        startTabIconSync();
        const before = link.href;

        const otherMode = mode === "light" ? "dark" : "light";
        stubComputedStyle(otherMode, "marigold"); // would change the paint IF either fired
        doc.setVisibility("visible");
        doc.fireVisibilityChange();
        win.fireFocus();

        expect(link.href).toBe(before);
      });
    }

    it("removes both listeners on unmount — neither fires afterward", () => {
      const link = { href: "" };
      const doc = stubDocument({ link, dataMode: "system", dataAccent: "violet" });
      stubMutationObserver();
      const win = stubWindow(false);
      stubComputedStyle("light", "violet");
      const stop = startTabIconSync();
      const before = link.href;

      stop();

      expect(doc.removeEventListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
      expect(win.windowRemoveEventListener).toHaveBeenCalledWith("focus", expect.any(Function));

      stubComputedStyle("dark", "violet"); // would change the paint IF either still fired
      doc.setVisibility("visible");
      doc.fireVisibilityChange();
      win.fireFocus();

      expect(link.href).toBe(before);
    });
  });
});
