import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ColorThemePicker } from "./page";

// 6-11/6-10 (Ruling 17): this repo has no @testing-library/react and no test
// anywhere simulates a click (matching figure-lightbox.test.ts's own note),
// so this guards the one thing a renderToStaticMarkup smoke test can: that
// `ColorThemePicker` derives `aria-pressed` on its three Mode buttons purely
// from the `value` prop it is handed (`mode === option.value`, after
// `value.split(":")`). A6-02's actual bug was never in this derivation — it
// was in which `value` reached the picker (a stale, whole-store profile
// read on a cold /profile load, fixed in ProfilePage itself) — so this test
// does not, and cannot, prove that fix; it protects the picker's own,
// separate logic from a future regression.

function modePressed(html: string, label: "Auto" | "Light" | "Dark") {
  const match = html.match(
    new RegExp(`aria-pressed="(true|false)"[^>]*>${label}<`),
  );
  if (!match) throw new Error(`button labelled "${label}" not found in: ${html}`);
  return match[1] === "true";
}

describe("ColorThemePicker — aria-pressed derives from value", () => {
  it("presses only Auto for a system:* value", () => {
    const html = renderToStaticMarkup(
      createElement(ColorThemePicker, { value: "system:ember", onChange: () => {} }),
    );
    expect(modePressed(html, "Auto")).toBe(true);
    expect(modePressed(html, "Light")).toBe(false);
    expect(modePressed(html, "Dark")).toBe(false);
  });

  it("presses only Light for a light:* value", () => {
    const html = renderToStaticMarkup(
      createElement(ColorThemePicker, { value: "light:rose", onChange: () => {} }),
    );
    expect(modePressed(html, "Auto")).toBe(false);
    expect(modePressed(html, "Light")).toBe(true);
    expect(modePressed(html, "Dark")).toBe(false);
  });

  it("presses only Dark for a dark:* value", () => {
    const html = renderToStaticMarkup(
      createElement(ColorThemePicker, { value: "dark:ember", onChange: () => {} }),
    );
    expect(modePressed(html, "Auto")).toBe(false);
    expect(modePressed(html, "Light")).toBe(false);
    expect(modePressed(html, "Dark")).toBe(true);
  });
});
