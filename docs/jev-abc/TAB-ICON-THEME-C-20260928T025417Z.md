# TAB-ICON-THEME — Agent C (implementer) — checkpoint

STATUS: IN_PROGRESS

## Task

ABC-JEV-INTEGRATION.md §1ae — the small square mark on the browser tab must change colour together with Peer's own colour setting (mode + accent), exactly as the masthead's Mark already does. Manager's reading was UNVERIFIED; this checkpoint's Step 0 confirms it by execution before any code change.

Branch `Jev-integration-and-sorting-filtering-enhancement`, HEAD `0107eaa385054525aba04e958d1b4a39c08f45ae`. `git status --porcelain` at start: only the pre-existing `M ABC-JEV-INTEGRATION.md`, two untracked A-checkpoint docs, and untracked `node_modules/` — nothing else pending.

## Step 0 — verify the cause by execution

Read first: `web/src/app/icon.svg` (static file, `<style>` block with hard-coded hex `.sheet`/`.corner`, flips only on the browser's own `prefers-color-scheme` media query), `web/src/components/shell/masthead.tsx` (`Mark()`: sheet = `fill="currentColor"` inheriting the `text-heading` class's `color: var(--color-heading)`; corner = `fill="var(--color-accent)"`), `web/src/app/layout.tsx` (inline boot script sets `data-mode`/`data-accent` on `<html>` from the persisted `peer-profile` store before first paint), `web/src/components/theme-sync.tsx` + `web/src/lib/theme.ts` (`applyColorTheme` sets the same two attributes on every profile change), `web/src/app/globals.css` (`--color-heading` and `--color-accent`/`--seed`/`--seed-dark` keyed off `html[data-mode]`/`html[data-accent]`, plus the `@media (prefers-color-scheme: dark)` block for `data-mode="system"`).

Next docs read: `web/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/app-icons.md` — a static `app/icon.svg` file produces exactly one emitted tag, `<link rel="icon" href="/icon?<generated>" type="image/<generated>" sizes="any">` (SVG always gets `sizes="any"`), generated at build time since the file takes no request-time input. No separate `favicon.ico`/`apple-icon`/manifest icon exists in `web/src/app/` (checked: `icon.svg` is the only icon-shaped file).

**Live execution, dev server on :3000 (untouched, still running):**

1. Read the actual emitted `<head>`: exactly one icon-related link exists —
   `<link rel="icon" href="/icon.svg?icon.0btq77qbt3irj.svg" type="image/svg+xml" sizes="any">`. No apple-touch-icon, no manifest, no duplicate — confirms the selector to target and confirms there is nothing else to deduplicate against.
2. Recorded `data-mode`/`data-accent` and the two computed tokens before, then set `data-mode="dark"` / `data-accent="rose"` on `<html>` (the same attributes `applyColorTheme` sets) and re-read:
   - Before: `data-mode=system`, `data-accent=ember` → `--color-heading:#1d1d1d`, `--color-accent:#ff520d`.
   - After: `data-mode=dark`, `data-accent=rose` → `--color-heading:#f3f3f3`, `--color-accent:#f0559a` (matches globals.css's rose `--seed-dark`). **The masthead Mark's own tokens do respond.**
   - The `<link rel="icon">` href stayed byte-identical across the change (`hrefUnchanged: true`) — no re-fetch is even triggered by the attribute mutation.
3. Fetched the resource at that href directly: it is still the static file read above verbatim — `.sheet{fill:#1d1d1d}`/`.corner{fill:#ff520d}`, flipping only inside its own `@media(prefers-color-scheme:dark)` block to `#f3f3f3`/`#ff6a2b`. With the page forced to `data-accent="rose"`, the correct corner would be `#f0559a`; the tab icon still serves ember's `#ff520d`/`#ff6a2b` regardless — it cannot know about the rose accent at all, and does not even repaint on a mode override that disagrees with the OS.

**Conclusion: manager's reading CONFIRMED, not wrong.** The tab icon is a static asset with its own fixed palette and its own independent `prefers-color-scheme` switch; it has no path to `data-mode`/`data-accent` and so never reflects Peer's own mode/accent setting (system vs explicit light/dark, or any non-ember accent). Proceeding to build per the design constraints.

## Build plan

- Logic lives in a plain, framework-free module (`web/src/lib/tab-icon.ts`), not inside the component — this repo's test environment is Vitest's **Node** environment (`vitest.config.ts` → `environment: "node"`, confirmed by reading `src/lib/theme.test.ts`'s own comment), there is no jsdom and no DOM/CSS engine, and no `@testing-library/*` dependency exists in `package.json`. Every existing "Sync" component (`ThemeSync`, `ProfileSync`, `FeedSync`) is untested at the component level for the same reason; only their underlying `lib/` logic is tested, with `document`/`window`/`MutationObserver` supplied via `vi.stubGlobal` exactly like `withZoomTransition`'s tests do. This module follows the same shape so the RED/GREEN tests are meaningful rather than mocking-the-mock.
- `web/src/components/tab-icon-sync.tsx`: thin `"use client"` wrapper, mounted once in `web/src/app/layout.tsx` beside `<ThemeSync />`, calling the lib's setup function inside `useEffect` and returning its cleanup — no visible output, no server work, no layout shift.
- Reuses the exact same two tokens the masthead Mark reads (`--color-heading`, `--color-accent`) via `getComputedStyle(document.documentElement)` — never a second hard-coded palette — and repaints by mutating the existing `<link rel="icon">`'s `href` in place (data URL), never adding a second link element.

## Build-time finding: painting on mount raced Next's own hydration of the icon `<link>` (execution-verified)

The first working version painted synchronously in `useEffect(() => { paintTabIcon(); ... }, [])`. Live-tested against the running dev server (:3000, never restarted) by editing source and watching Fast-Refresh-applied behaviour, then hard-reloading fresh each time:

1. Mounted as written: `document.querySelectorAll('link[rel="icon"]')` went from 1 to **2** — the element I had mutated (now a `data:` href) stayed in the DOM, and a **second** `<link rel="icon" type="image/svg+xml" sizes="any">` with the **original** `/icon.svg?hash` href appeared beside it, moments later. Reproduced on every fresh load tried (over a dozen). Disabling the new component (commenting out `<TabIconSync />`) made the count stay at 1 on the same route — the duplicate is caused by this change, not pre-existing.
2. Instrumented `paintTabIcon` with a temporary log: it ran exactly once per mount, and at the moment it ran, exactly one link existed and got mutated — so the second link is inserted by something else, afterward, not by this code running twice.
3. Isolated the cause with a clean, disabled-component page (steady at 1 link, waited 5s) and then manually replaying the exact same mutation from the console: **no duplicate ever appeared**, even after 2 more seconds of waiting. So the failure is not "mutating this attribute is inherently unsafe" — it is specifically about doing so **too soon after mount**, before something in Next/React's own hydration of that SSR-rendered `<link>` (most likely its hoisted-head-element reconciliation) has settled. The exact internal mechanism was not traced into React's source beyond this; the behaviour was characterized by execution instead.
4. Tried two candidate fixes on the real component, each tested with fresh navigations and a multi-point delay sweep (50 ms–2.5 s) after mount:
   - `window.setTimeout(fn, 0)` (one macrotask tick) before the first paint: **still produced the duplicate, every time.**
   - Two chained `window.requestAnimationFrame` calls before the first paint: **never produced a duplicate**, across many repeated fresh loads (including a case where the page's `visibilityState` was `"hidden"`, which paused the frames for ~19 s before they ran — still exactly one link, still correctly painted, just later).
5. Verified end-to-end through the real UI, not just synthetic attribute writes: on `/profile`, clicking **Dark** in the Appearance card's Mode control repainted the icon to `#f3f3f3`/`#ff6a2b` (ember/dark); clicking the **Violet** swatch repainted it to `#f3f3f3`/`#a078f0` (violet/dark, matching globals.css's `--seed-dark` for violet exactly). `document.querySelectorAll('link[rel~="icon"]').length` stayed at 1 throughout. Reset the picker back to Auto/Ember afterward (this session's own embedded browser profile only — separate from the user's own browser/localStorage).

Shipped implementation: the very first paint is deferred across two animation frames (`lib/tab-icon.ts`, `startTabIconSync`); the returned cleanup cancels both pending frames via `cancelAnimationFrame` if unmounted first. Later repaints (attribute-change via `MutationObserver`, OS-scheme change while `data-mode="system"`) are NOT delayed — by the time those fire, mount has long settled, so there is no race to guard against there.

**Named trade-off:** if the tab loads while genuinely backgrounded/hidden (browsers pause `requestAnimationFrame` there), the correct colour can be delayed until the tab is actually viewed, at which point the pending frames resume and it corrects within a frame or two. `icon.svg`'s own `prefers-color-scheme` version is still showing something reasonable in the meantime, and nobody is looking at a hidden tab's icon anyway. This is a deliberate choice over the alternative (a fast but unsafe `setTimeout`, empirically proven to duplicate the link), not an oversight.

## Files changed

- `web/src/lib/tab-icon.ts` (new) — all logic: `buildTabIconHref`, `readMarkTokens`, `paintTabIcon`, `startTabIconSync`.
- `web/src/lib/tab-icon.test.ts` (new) — 38 tests (below).
- `web/src/components/tab-icon-sync.tsx` (new) — thin `"use client"` wrapper, untested itself (same reasoning as `ThemeSync`/`ProfileSync`/`FeedSync`: no jsdom, no `@testing-library/*` in this repo — confirmed by reading `vitest.shared.ts` (`environment: "node"`) and `package.json`, and by `theme.test.ts`'s own comment).
- `web/src/app/layout.tsx` — two-line addition: import `TabIconSync`, mount `<TabIconSync />` beside `<ThemeSync />`. Nothing else touched.

No edits anywhere under `web/src/components/account/*`, `web/src/lib/supabase/*`, auth routes, `docs/JEV-RELEASE-READINESS.md`, or `web/.env.example`. `web/.env` / `web/.env.local` never opened. `peer-followup` never touched. Dev server on :3000 left running throughout (only reloaded pages in a separate embedded browser tab against it).

## Tests — RED then GREEN

All 38 tests live in `web/src/lib/tab-icon.test.ts`, following the repo's own established pattern for untestable-in-jsdom client code (`src/lib/theme.test.ts`'s `vi.stubGlobal` approach) since this repo's Vitest runs in the **Node** environment — no DOM at all unless a test stubs one.

- **RED (module didn't exist yet):** `npx vitest run src/lib/tab-icon.test.ts` → `Cannot find package '@/lib/tab-icon'` — 0 tests ran, 1 suite failed.
- **GREEN (module written):** same command → **37 tests passed** (before the deferred-first-paint fix was added to the tests).
- **RED again (regression check for the race fix specifically):** temporarily reverted `startTabIconSync` to paint synchronously (no rAF) and re-ran just the two new tests (`defers the first paint…`, `cancels the pending first-paint frames…`) → **both failed** (`expected '<data-url>' to be ''`), proving they actually pin the fix rather than trivially passing. Reverted the temporary change back immediately.
- **GREEN (final):** `npx vitest run src/lib/tab-icon.test.ts` → **38 tests passed**, 0 failed.

Coverage against §1ae's RED-test list:
- Every accent (ember/rose/marigold/sage/indigo/violet) × mode (light/dark) combination yields the matching sheet/corner colours — 12 cases each in `readMarkTokens` and `paintTabIcon` (24 tests), oracle values are globals.css's own hex constants, cross-checked against the live page in Step 0 and the build-time finding's UI test.
- Icon updates when `data-mode`/`data-accent` change (`MutationObserver` fires) — covered, plus a negative case (unrelated attribute mutations are ignored).
- Follows the OS scheme only in `"system"` mode — covered both ways (repaints in system mode, does NOT repaint in an explicit mode).
- Observer disconnects (and the media-query listener is removed) on unmount — covered.
- Never more than one effective icon link — covered directly (`document.createElement` spied and asserted never called, across a full mount + mutation-repaint + OS-repaint lifecycle) and is the same property the build-time finding above chases down live.
- The two-animation-frame first-paint deferral itself, and its cancellation on early unmount — covered (new tests, not in the original spec list, added because the build-time finding made them necessary).

## Gates (from `web/`, HEAD `0107eaa385054525aba04e958d1b4a39c08f45ae`, branch `Jev-integration-and-sorting-filtering-enhancement`)

**Note on shared working tree:** other agents are concurrently and legitimately editing this same checkout (uncommitted changes seen mid-session: `web/src/components/account/account-section.tsx`, `web/src/components/account/use-auth-user.ts`, `web/src/app/page.tsx`, plus new checkpoints `GOOGLE-SIGNIN-B/C`, `SIGNIN-MERGE-B/C`, `HOME-READING-LAYOUT-C` under `docs/jev-abc/`). A mid-session `npx vitest run` caught one of those in a transient broken state (4 failures in `account-section.test.tsx`, `ReferenceError: GoogleMark is not defined` — `git diff` confirmed that file was uncommitted/mid-edit at that moment; not a file I'm permitted to touch and not related to icons). A later re-run, after that agent's own work had progressed, showed 0 failures anywhere. The numbers below are that final, clean re-run.

1. **`npx vitest run`:** `270 passed | 3 skipped (273 files)`, `4899 passed | 6 skipped (4905 tests)`, 0 failed. (Baseline stated for HEAD 0107eaa3: 266 files / 4844 passed + 6 skipped. The +7 files / +55 tests beyond that baseline are `tab-icon.test.ts` — 1 file / 38 tests, mine — plus the other concurrently-working agents' own new test files; none of the delta is unaccounted for as a failure.)
2. **`npx tsc --noEmit`:** exit code 0, no output.
3. **`npx eslint .`:** `✖ 149 problems (0 errors, 149 warnings)` — identical to the stated 149-warning baseline; this change added no new warnings or errors.
4. **`npm run build`:** succeeded (`✓ Compiled successfully`, TypeScript finished, 30/30 static pages generated, `/icon.svg` listed as a static route). One Turbopack warning, pre-existing and unrelated: an NFT-tracing note about `src/lib/papers/pdf-text.ts` via the PDF-upload route's dynamic `require`-like filesystem calls — nothing under this ticket's files.

## Final STATUS: IMPLEMENTED_PENDING_REVIEW

## HOW THE USER CHECKS IT

1. Open the app (dev server already running on :3000).
2. Go to the **Profile** page → **Appearance** card → **Color theme**.
3. Click a different **Mode** (Light/Dark/Auto) or a different accent swatch (e.g. Violet, Sage).
4. Watch the small square mark on the browser's own tab, top of the window — it repaints to the new colours within a frame or two, the same way the mark next to the "Peer" wordmark in the page's own top bar already does. No page reload needed, no flicker, and it stays a single tab icon throughout (nothing to compare — there is only ever one).
