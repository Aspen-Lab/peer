import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P11-23 rule 3 (round 1's three blind readers, 0.25 each; ruling §1h.121): the reading controls' sun means "system" (S16: the default, which follows the OS) and
// was labelled "Day reading mode" and drawn pressed in every dark screenshot — a control claiming a mode the reader does not see. No control may be drawn
// pressed while it claims a mode the page is not in. With the mode "system" the pressed control says it follows the system, in its accessible name and its
// tooltip, with what the system is now read live from the media query; its icon is not a plain sun while the system is dark (the smallest honest change:
// the owner's sun stays whenever it is true, the day-lit page; while the page is dark the place is a half-lit disc, the system's mark, because a label alone
// would leave a pressed sun on a dark page). With the mode "dark" the moon stays pressed as it was; a press does what it did: the sun sets "system", the moon "dark".
//
// The component is rendered with the profile and reading-preference stores replaced by a plain state and the media query by a stub, so the cases run in Node.

const world = vi.hoisted(() => ({
  colorTheme: "system:ember",
  systemDark: null as boolean | null,
  updates: [] as string[],
  listeners: [] as Array<() => void>,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  // The client's snapshot, as a mounted page reads it (a server render would read the third argument, the unknown).
  return { ...actual, useSyncExternalStore: <T,>(_subscribe: unknown, getSnapshot: () => T) => getSnapshot() };
});
vi.mock("@/store/profile", () => ({
  useProfileStore: (select: (state: unknown) => unknown) =>
    select({ profile: { colorTheme: world.colorTheme }, updateColorTheme: (theme: string) => world.updates.push(theme) }),
}));
vi.mock("@/store/reading-prefs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/store/reading-prefs")>();
  return {
    ...actual,
    useReadingPrefsStore: (select: (state: unknown) => unknown) =>
      select({ scaleIndex: 1, increaseScale: () => {}, decreaseScale: () => {}, fit: false, setFit: () => {} }),
  };
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReadingControls } from "./reading-controls";

function stubWindow(dark: boolean | null) {
  world.systemDark = dark;
  if (dark === null) {
    vi.stubGlobal("window", {});
    return;
  }
  vi.stubGlobal("window", {
    matchMedia: (query: string) => ({
      matches: query === "(prefers-color-scheme: dark)" ? dark : false,
      addEventListener: (_type: string, listener: () => void) => world.listeners.push(listener),
      removeEventListener: () => {},
    }),
  });
}

const tags = (markup: string, tag: string) => markup.match(new RegExp(`<${tag}\\b[^>]*>`, "g")) ?? [];
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
/** The sun's button and what is inside it, the moon's the same: the markup from each button's opening tag to its closing tag. */
function button(markup: string, label: RegExp) {
  const opening = tags(markup, "button").find((tag) => label.test(attr(tag, "aria-label") ?? ""));
  expect(opening, `a button named ${label}`).toBeDefined();
  const at = markup.indexOf(opening ?? "");
  return { tag: opening ?? "", inner: markup.slice(at, markup.indexOf("</button>", at)) };
}
const SUN = /^Follow the system/;
const MOON = /^Night reading mode$/;
const isSun = (inner: string) => inner.includes('r="4"');
const isSystemMark = (inner: string) => inner.includes('data-glyph="system"');

function render(mode: "system" | "dark" | "light", dark: boolean | null, spread = true) {
  world.colorTheme = `${mode}:ember`;
  stubWindow(dark);
  return renderToStaticMarkup(createElement(ReadingControls, { spread }));
}

beforeEach(() => {
  world.updates.length = 0;
  world.listeners.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the sun never claims a mode the reader does not see (P11-23 rule 3)", () => {
  for (const spread of [true, false]) {
    for (const dark of [false, true]) {
      const where = `${spread ? "the pane's header row" : "the one column"}, system ${dark ? "dark" : "light"}`;

      it(`with the mode "system" the pressed sun says it follows the system, now ${dark ? "dark" : "light"}, in its name and its tooltip (${where})`, () => {
        const sun = button(render("system", dark, spread), SUN);
        const name = `Follow the system (now ${dark ? "dark" : "light"})`;

        expect(attr(sun.tag, "aria-pressed")).toBe("true");
        expect(attr(sun.tag, "aria-label")).toBe(name);
        expect(attr(sun.tag, "title")).toBe(name);
        expect(attr(sun.tag, "aria-label")).not.toMatch(/Day/);
      });

      it(`draws the sun only while the system is light: ${dark ? "the half-lit disc, no sun" : "the sun"} (${where})`, () => {
        const sun = button(render("system", dark, spread), SUN);

        expect(isSun(sun.inner)).toBe(!dark);
        expect(isSystemMark(sun.inner)).toBe(dark);
      });

      it(`keeps the moon pressed with the mode "dark", and then the sun is not (${where})`, () => {
        const markup = render("dark", dark, spread);

        expect(attr(button(markup, MOON).tag, "aria-pressed")).toBe("true");
        expect(attr(button(markup, SUN).tag, "aria-pressed")).toBe("false");
        // The moon is the moon whatever the system is.
        expect(button(markup, MOON).inner).not.toContain('data-glyph="system"');
        expect(button(markup, MOON).inner).toContain("M20 14.5A8.5 8.5 0 1 1 9.5 4");
      });

      it(`draws nothing pressed with the mode "light" (the Profile page's own choice), which no control here names (${where})`, () => {
        const markup = render("light", dark, spread);

        expect(attr(button(markup, SUN).tag, "aria-pressed")).toBe("false");
        expect(attr(button(markup, MOON).tag, "aria-pressed")).toBe("false");
      });
    }
  }

  // The rule, over every state of the strip: a control drawn pressed is a mode the page is in — "dark" (the moon) when the page is dark by the reader's
  // choice, the system's (the sun, named for it, never drawn as a sun on a dark page) when it follows the system.
  it("draws no control pressed that names a mode the page is not in, in any of the six states of the mode and the system", () => {
    for (const mode of ["system", "dark", "light"] as const) {
      for (const dark of [false, true]) {
        const markup = render(mode, dark);
        const sun = button(markup, SUN);
        const moon = button(markup, MOON);
        const pageIsDark = mode === "dark" || (mode === "system" && dark);

        if (attr(moon.tag, "aria-pressed") === "true") expect(pageIsDark, `${mode} / system ${dark}: the moon is pressed on a light page`).toBe(true);
        if (attr(sun.tag, "aria-pressed") === "true") {
          expect(mode).toBe("system");
          expect(attr(sun.tag, "aria-label"), `${mode} / system ${dark}`).toMatch(/follow the system/i);
          if (pageIsDark) expect(isSun(sun.inner), `${mode} / system ${dark}: a pressed sun on a dark page`).toBe(false);
        }
      }
    }
  });

  it("says only 'Follow the system' where the media query cannot be asked (a server render, a browser with none): no 'now' it cannot know", () => {
    const sun = button(render("system", null), SUN);

    expect(attr(sun.tag, "aria-label")).toBe("Follow the system");
    expect(attr(sun.tag, "title")).toBe("Follow the system");
    expect(isSun(sun.inner)).toBe(true);
  });

  it("reads the system live: it subscribes to the media query's change, and asks it for the dark scheme", () => {
    render("system", true);
    const source = readFileSync(resolve(process.cwd(), "src/components/reader/reading-controls.tsx"), "utf8");

    expect(source).toContain('"(prefers-color-scheme: dark)"');
    expect(source).toMatch(/addEventListener\("change", onChange\)/);
    expect(source).toMatch(/removeEventListener\("change", onChange\)/);
    expect(source).toMatch(/useSyncExternalStore\(subscribeSystemScheme, systemIsDark, \(\) => null\)/);
  });

  // What a press does is as it was. The strip is called as a function here (its hooks are plain functions in this file), so its buttons' handlers can be called.
  it("changes nothing a press does: the sun sets \"system\", the moon \"dark\", each keeping the accent", () => {
    world.colorTheme = "light:sage";
    stubWindow(true);
    const tree = ReadingControls({ spread: true }) as ReactElement<{ children?: ReactNode }>;
    const found: Array<{ label: string; onClick: () => void }> = [];
    const walk = (node: ReactNode): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object" || !("props" in node)) return;
      const element = node as ReactElement<{ children?: ReactNode; onClick?: () => void; "aria-label"?: string }>;
      const label = element.props["aria-label"];
      if (typeof label === "string" && element.props.onClick) found.push({ label, onClick: element.props.onClick });
      walk(element.props.children);
    };
    walk(tree);

    // By place, not by name: the strip's order is the owner's (A · A · sun · moon · fit) and the names are what rule 3 changes.
    expect(found).toHaveLength(5);
    found[2].onClick();
    found[3].onClick();
    expect(world.updates).toEqual(["system:sage", "dark:sage"]);
  });
});
