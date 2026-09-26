import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultProfile } from "@/types";
import {
  ColorThemePicker,
  DataSourcesLink,
  LearnedPreferences,
  EmailSettingsView,
  digestToggleUpdate,
  type EmailSettingsViewProps,
} from "./page";

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

describe("DataSourcesLink", () => {
  it("offers an accessible Profile/settings link to the visible data sources page", () => {
    const html = renderToStaticMarkup(createElement(DataSourcesLink));
    expect(html).toContain('href="/data-sources"');
    expect(html).toContain("Vocabulary sources and licenses");
  });
});

// EMAIL-SETTINGS — no @testing-library/react and no click simulation exists
// in this repo (see the note at the top of this file), so the toggle's
// business-logic mapping is a pure, directly-tested function, and the
// section's own signed-out gate is proven on the presentational,
// prop-driven EmailSettingsView (same pattern as ColorThemePicker/
// LearnedPreferences above) — never on the hook-wired EmailSettings wrapper,
// which calls useAuthUser/useProfileStore/useRouter/useSearchParams and so
// cannot render outside a real Next.js tree.

describe("digestToggleUpdate — the 'both'/'inapp' + 'daily' mapping (ABC-JEV-INTEGRATION.md §1z P5)", () => {
  it("turning ON sets channel 'both' AND frequency 'daily'", () => {
    expect(digestToggleUpdate(true)).toEqual({ channel: "both", frequency: "daily" });
  });

  it("turning OFF sets channel 'inapp' and leaves frequency untouched", () => {
    expect(digestToggleUpdate(false)).toEqual({ channel: "inapp" });
  });
});

describe("EmailSettingsView — signed-out visitors see no controls (RED #12)", () => {
  const baseProps: EmailSettingsViewProps = {
    signedIn: false,
    digestChannel: "inapp",
    digestHourLocal: 8,
    digestTimezone: "UTC",
    accountEmail: "person@example.test",
    addressDraft: "person@example.test",
    pendingAddress: null,
    confirmedBanner: false,
    confirmMessage: null,
    confirmBusy: false,
    testMessage: null,
    testBusy: false,
    onToggleEmail: () => {},
    onHourChange: () => {},
    onAddressDraftChange: () => {},
    onAddressSubmit: () => {},
    onSendTest: () => {},
  };

  it("renders NOTHING (not just visually hidden) when signed out, unconfigured, or still loading", () => {
    const html = renderToStaticMarkup(createElement(EmailSettingsView, { ...baseProps, signedIn: false }));
    expect(html).toBe("");
  });

  it("renders the section once signed in", () => {
    const html = renderToStaticMarkup(createElement(EmailSettingsView, { ...baseProps, signedIn: true }));
    expect(html).not.toBe("");
    expect(html).toContain("Daily email");
    expect(html).toContain("Send test email");
  });

  it("shows the toggle-off helper copy when the channel is 'inapp'", () => {
    const html = renderToStaticMarkup(
      createElement(EmailSettingsView, { ...baseProps, signedIn: true, digestChannel: "inapp" }),
    );
    expect(html).toContain("in addition to the in-app Past briefings");
  });

  it("shows the sending sentence with hour/timezone/address when the channel is 'both'", () => {
    const html = renderToStaticMarkup(
      createElement(EmailSettingsView, {
        ...baseProps,
        signedIn: true,
        digestChannel: "both",
        digestHourLocal: 8,
        digestTimezone: "America/Chicago",
        addressDraft: "person@example.test",
      }),
    );
    expect(html).toContain("8:00 AM");
    expect(html).toContain("America/Chicago");
    expect(html).toContain("person@example.test");
  });

  it("shows the pending-confirmation banner with the requested address", () => {
    // In real use the draft and the pending address are the same string
    // until the reader edits the field further — set both here, matching
    // how EmailSettings (the hook-wired wrapper) actually drives this prop.
    const html = renderToStaticMarkup(
      createElement(EmailSettingsView, {
        ...baseProps,
        signedIn: true,
        addressDraft: "new@example.test",
        pendingAddress: "new@example.test",
      }),
    );
    expect(html).toContain("new@example.test");
    expect(html).toContain("confirmation link");
  });

  it("shows the confirmed banner after a successful redirect", () => {
    const html = renderToStaticMarkup(
      createElement(EmailSettingsView, { ...baseProps, signedIn: true, confirmedBanner: true }),
    );
    expect(html.toLowerCase()).toContain("confirmed");
  });

  it("shows the test-email result message when present", () => {
    const html = renderToStaticMarkup(
      createElement(EmailSettingsView, {
        ...baseProps,
        signedIn: true,
        testMessage: "Sent just now to person@example.test.",
      }),
    );
    expect(html).toContain("Sent just now to person@example.test.");
  });
});
