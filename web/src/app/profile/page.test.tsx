import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultProfile } from "@/types";
import { ColorThemePicker, LearnedPreferences } from "./page";

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

// 9-24 (A9-12): entries the ledger learned from an uploaded PDF carry a
// "from your upload" caption in "What Peer has learned" — this component
// only reads its own `profile` prop (never the store directly, confirmed by
// reading it), so a static-markup render with a hand-built ledger exercises
// the real label derivation end to end (`summarizePreferenceLedger` ->
// `PreferenceChip`), not a mock of either.
describe("LearnedPreferences — 'from your upload' caption (9-24)", () => {
  const T0 = "2026-09-19T00:00:00.000Z";

  it("captions only the entry with upload evidence, not an ordinary like", () => {
    const profile = {
      ...defaultProfile,
      preferenceLedger: {
        "text:solid electrolyte": {
          key: "text:solid electrolyte", label: "solid electrolyte", source: "uploaded_article" as const,
          positive: 0, negative: 0, lastSeenAt: T0,
          uploads: { [("a").repeat(64)]: { at: T0, weight: 1.6 } },
        },
        "text:battery cycling": {
          key: "text:battery cycling", label: "battery cycling", source: "paper_keyword" as const,
          positive: 2, negative: 0, lastSeenAt: T0,
        },
      },
    };
    const html = renderToStaticMarkup(
      createElement(LearnedPreferences, { profile, onReset: () => {} }),
    );
    expect(html).toContain("solid electrolyte");
    expect(html).toContain("battery cycling");
    expect(html).toContain("from your upload");
    // Exactly one caption — the ordinary like never gets one.
    expect(html.match(/from your upload/g)).toHaveLength(1);
  });

  it("shows no caption anywhere when nothing in the ledger came from an upload", () => {
    const profile = {
      ...defaultProfile,
      preferenceLedger: {
        "text:battery cycling": {
          key: "text:battery cycling", label: "battery cycling", source: "paper_keyword" as const,
          positive: 2, negative: 0, lastSeenAt: T0,
        },
      },
    };
    const html = renderToStaticMarkup(
      createElement(LearnedPreferences, { profile, onReset: () => {} }),
    );
    expect(html).not.toContain("from your upload");
  });
});
