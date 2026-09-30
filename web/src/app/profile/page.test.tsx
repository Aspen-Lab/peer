import { readFileSync } from "node:fs";
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
  confirmFlagMessage,
  confirmAddressMessage,
  testSendMessage,
  resolveActiveEmailDestination,
  emailDestinationSentence,
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
    // EMAIL-DEST-UX (§1bm) — the realistic starting state: no custom digest
    // address confirmed yet, so every destination falls back to the account
    // email. Tests that need a confirmed custom address override this.
    confirmedEmail: "",
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

  // EMAIL-DEST-UX (§1bm) — guide bug #2 (page.tsx:1498 read live addressDraft
  // instead of the value that was actually just confirmed). Constructed so
  // addressDraft has changed since the confirm-redirect landed (the reader
  // kept typing) — the banner must still name the CONFIRMED address, not
  // whatever is currently sitting in the box.
  it("the confirmed banner names the value that was confirmed, not a draft edited afterward", () => {
    const html = renderToStaticMarkup(
      createElement(EmailSettingsView, {
        ...baseProps,
        signedIn: true,
        confirmedEmail: "justconfirmed@example.test",
        addressDraft: "typed-after-redirect@example.test",
        confirmedBanner: true,
      }),
    );
    // The draft legitimately appears elsewhere on the page too (the "Send
    // to" input's own value, and the mismatch clause of the destination
    // sentence near "Send test email" — both correctly reflect what the
    // reader is currently typing). Only the banner paragraph itself
    // (class "text-caption text-accent", distinct from every other caption
    // in this view) must never pick up the live draft — isolate it first.
    const bannerMatch = html.match(/<p class="text-caption text-accent">([^<]*)<\/p>/);
    if (!bannerMatch) throw new Error(`confirmed banner paragraph not found in: ${html}`);
    const bannerText = bannerMatch[1];
    expect(bannerText).toContain("justconfirmed@example.test");
    expect(bannerText).not.toContain("typed-after-redirect@example.test");
  });

  // EMAIL-DEST-UX (§1bm) — guide bug #1 (page.tsx:1431/1440 read the
  // unconfirmed text box). A confirmed custom address plus a still-different
  // draft must state the ACTIVE (confirmed) address, and only the active
  // one, in the "Sending daily" summary.
  it("the daily summary states the confirmed address, never the unconfirmed draft, when the channel is 'both'", () => {
    const html = renderToStaticMarkup(
      createElement(EmailSettingsView, {
        ...baseProps,
        signedIn: true,
        digestChannel: "both",
        confirmedEmail: "confirmed@example.test",
        addressDraft: "still-typing@example.test",
      }),
    );
    expect(html).toContain("confirmed@example.test");
    expect(html).toContain("still-typing@example.test");
    // React escapes `'` to `&#x27;` in rendered text (see page.test.tsx's
    // own note) — this substring is specific to the mismatch clause and
    // deliberately stops short of either apostrophe, so it matches the
    // real markup either way.
    expect(html).toContain("be used until it");
  });

  // EMAIL-DEST-UX (§1bm point 2) — the previously-missing destination line
  // next to "Send test email" (guide option a+b, unified). Must be present
  // and true even when the daily toggle is OFF — the test-send button works
  // regardless of the toggle.
  it("names the active destination next to Send test email even when the daily toggle is off", () => {
    const html = renderToStaticMarkup(
      createElement(EmailSettingsView, {
        ...baseProps,
        signedIn: true,
        digestChannel: "inapp",
        confirmedEmail: "",
        accountEmail: "account@example.test",
        addressDraft: "account@example.test",
      }),
    );
    expect(html).toContain("Email goes to account@example.test");
  });

  // EMAIL-DEST-UX (§1bm point 1, copy bug 3) — a confirmed, ALREADY ACTIVE
  // address must stop showing "Confirm to start sending here." on every
  // subsequent page load (guide Task 1 finding #3, state 4 in its table).
  it("gives a confirmed, already-active custom address its own caption (not 'Confirm to start sending here.')", () => {
    const html = renderToStaticMarkup(
      createElement(EmailSettingsView, {
        ...baseProps,
        signedIn: true,
        accountEmail: "account@example.test",
        confirmedEmail: "work@example.test",
        addressDraft: "work@example.test",
        pendingAddress: null,
      }),
    );
    expect(html).not.toContain("Confirm to start sending here.");
    expect(html.toLowerCase()).toContain("confirmed");
  });

  // Guide table state 5 — "changed after confirming": a second, different
  // candidate is pending while the FIRST confirmed address is still the one
  // actually receiving mail. The destination line must keep naming the old
  // (still active) address, not the new pending one.
  it("state 5 (changed after confirming): the destination line still names the first confirmed address while a second is pending", () => {
    const html = renderToStaticMarkup(
      createElement(EmailSettingsView, {
        ...baseProps,
        signedIn: true,
        accountEmail: "account@example.test",
        confirmedEmail: "first-confirmed@example.test",
        addressDraft: "second-candidate@example.test",
        pendingAddress: "second-candidate@example.test",
      }),
    );
    expect(html).toContain("Email goes to first-confirmed@example.test");
    // Apostrophe-free substring — see the note above.
    expect(html).toContain("second-candidate@example.test won");
    expect(html).toContain("be used until it");
  });

  // Guide table state 1 — "empty": neither a confirmed address nor an
  // account email exists yet (a transient state). Must render a graceful
  // sentence, never a bare "Email goes to ." or a crash.
  it("state 1 (empty): with no confirmed address and no account email, the sentence names none instead of a blank", () => {
    const html = renderToStaticMarkup(
      createElement(EmailSettingsView, {
        ...baseProps,
        signedIn: true,
        accountEmail: "",
        confirmedEmail: "",
        addressDraft: "",
      }),
    );
    expect(html).toContain("Add an email above to start sending.");
    expect(html).not.toContain("Email goes to");
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

// EMAIL-DEST-UX (ABC-JEV-INTEGRATION.md §1bm) — the destination-resolution
// and one-sentence helpers, pure and unit-tested the same way as
// digestToggleUpdate/confirmAddressMessage/testSendMessage above, covering
// every address state from the guide's table (docs/jev-abc/EMAIL-DEST-UX-B-
// 20260930T041204Z.md, Task 1's state table).
describe("resolveActiveEmailDestination — the confirmed digest address, else the account email, NEVER the draft (§1bm point 1)", () => {
  it("prefers the confirmed digest address when one exists", () => {
    expect(resolveActiveEmailDestination("confirmed@example.test", "account@example.test")).toBe(
      "confirmed@example.test",
    );
  });

  it("falls back to the account email when nothing is confirmed", () => {
    expect(resolveActiveEmailDestination("", "account@example.test")).toBe("account@example.test");
  });

  it("trims whitespace on both inputs", () => {
    expect(resolveActiveEmailDestination("  ", "  account@example.test  ")).toBe(
      "account@example.test",
    );
  });

  it("state 1 (empty): neither a confirmed address nor an account email yields an empty string, never a crash", () => {
    expect(resolveActiveEmailDestination("", "")).toBe("");
  });
});

describe("emailDestinationSentence — ONE sentence reused next to Send test email and in the daily summary (§1bm point 2)", () => {
  it("state 4 (confirmed, matches the draft): states the destination with no mismatch clause", () => {
    expect(emailDestinationSentence("confirmed@example.test", "confirmed@example.test")).toBe(
      "Email goes to confirmed@example.test right now.",
    );
  });

  it("an empty draft (not yet filled in) is not treated as a mismatch", () => {
    expect(emailDestinationSentence("confirmed@example.test", "")).toBe(
      "Email goes to confirmed@example.test right now.",
    );
  });

  it("a draft that differs only by case/whitespace is not treated as a mismatch", () => {
    expect(emailDestinationSentence("confirmed@example.test", "  Confirmed@Example.Test  ")).toBe(
      "Email goes to confirmed@example.test right now.",
    );
  });

  // State 2 ("typed, unconfirmed") and state 3 ("confirmation pending") are
  // identical from the sentence's point of view — both are "an address the
  // server has not confirmed yet" — and both must be true either way.
  it("state 2/3 (typed-unconfirmed or pending): names the active address AND says the draft is not used yet", () => {
    expect(emailDestinationSentence("account@example.test", "work@example.test")).toBe(
      "Email goes to account@example.test right now. work@example.test won't be used until it's confirmed.",
    );
  });

  it("state 5 (changed after confirming): the FIRST confirmed address stays active while a second candidate is pending", () => {
    expect(
      emailDestinationSentence("first-confirmed@example.test", "second-candidate@example.test"),
    ).toBe(
      "Email goes to first-confirmed@example.test right now. second-candidate@example.test won't be used until it's confirmed.",
    );
  });

  it("state 1 (empty): no active destination at all names none, rather than a blank address", () => {
    expect(emailDestinationSentence("", "")).toBe("Add an email above to start sending.");
  });

  it("MUTATION GUARD: reading the draft as the destination (reverting §1bm) would make this false for a mismatched draft", () => {
    // Pins the exact bug the guide reproduced: page.tsx used to render
    // `addressDraft.trim() || accountEmail` as "the" destination. If a
    // future edit reads `addressDraft` here again, this active/draft pair
    // (mismatched) would silently swap which one appears first — this test
    // exists specifically to go red in that case.
    const sentence = emailDestinationSentence("account@example.test", "typed-not-confirmed@example.test");
    expect(sentence.startsWith("Email goes to account@example.test")).toBe(true);
    expect(sentence).not.toContain("Email goes to typed-not-confirmed@example.test");
  });
});

// ABC-JEV-INTEGRATION.md §1bn EMAIL-TOKEN-REPLAY — the GET redirect flag ->
// sentence mapping, extracted to a pure function for the same reason as
// confirmAddressMessage/testSendMessage just below (the wrapper component
// that reads this flag needs a real Next.js router/search-params tree, so
// this repo tests the mapping itself instead — see this file's top note).
describe("confirmFlagMessage — GET /api/profile/confirm-email's redirect flag (§1bn)", () => {
  it("signin_required", () => {
    expect(confirmFlagMessage("signin_required")).toBe("Sign in, then open the link again.");
  });

  it("wrong_account", () => {
    expect(confirmFlagMessage("wrong_account")).toBe("That confirmation link isn't for this account.");
  });

  it("unavailable", () => {
    expect(confirmFlagMessage("unavailable")).toBe(
      "Confirming a different email isn't available right now.",
    );
  });

  it("invalid_link", () => {
    expect(confirmFlagMessage("invalid_link")).toBe("That confirmation link didn't work. Request a new one.");
  });

  // EMAIL-TOKEN-REPLAY (§1bn) — the new outcome this item adds: an old link
  // that was otherwise valid but the address it names is no longer the
  // question, because something else already changed it. The sentence must
  // say that plainly and point at the fix (request a new link) — the same
  // two-part shape as invalid_link's own sentence.
  it("stale_link — the new EMAIL-TOKEN-REPLAY outcome", () => {
    expect(confirmFlagMessage("stale_link")).toBe(
      "Your email settings changed since that link was sent. Request a new confirmation link.",
    );
  });

  it("an unrecognized flag falls back to the same generic sentence as invalid_link", () => {
    expect(confirmFlagMessage("something_new")).toBe(confirmFlagMessage("invalid_link"));
  });

  it("a null flag (no query param at all) also falls back to invalid_link's sentence", () => {
    expect(confirmFlagMessage(null)).toBe(confirmFlagMessage("invalid_link"));
  });
});

// ABC-JEV-INTEGRATION.md §1al POLISH-1-EMAIL (a)/(f)/(g) — the two
// response -> sentence mappings, extracted to pure functions so every
// status/reason is unit-tested without rendering or a real fetch (same
// "no click simulation" constraint noted at the top of this file).
describe("confirmAddressMessage — POST /api/profile/confirm-email's response (§1al (a)/(f))", () => {
  it("429 rate_limited", () => {
    expect(confirmAddressMessage(429, {})).toEqual({
      message: "Too many requests today. Try again tomorrow.",
      confirmed: false,
      pending: false,
    });
  });

  it("503 — no DIGEST_EMAIL_CONFIRM_SECRET configured (was 500 — (a))", () => {
    expect(confirmAddressMessage(503, { error: "email_confirmation_unavailable" })).toEqual({
      message: "Confirming a different email isn't available right now.",
      confirmed: false,
      pending: false,
    });
  });

  it("502 sender_not_verified — the confirmation send failed at Peer's sender ((f))", () => {
    expect(confirmAddressMessage(502, { error: "sender_not_verified" })).toEqual({
      message: "Peer's email sender isn't set up to reach that address yet.",
      confirmed: false,
      pending: false,
    });
  });

  it("502 confirmation_send_failed — any other send failure ((f))", () => {
    expect(confirmAddressMessage(502, { error: "confirmation_send_failed" })).toEqual({
      message: "Couldn't send the confirmation email. Try again later.",
      confirmed: false,
      pending: false,
    });
  });

  it("502 with an unrecognized error string still falls back to the generic send-failed sentence", () => {
    expect(confirmAddressMessage(502, { error: "something_new" })).toEqual({
      message: "Couldn't send the confirmation email. Try again later.",
      confirmed: false,
      pending: false,
    });
  });

  it("500 — a genuine database read/write error", () => {
    expect(confirmAddressMessage(500, { error: "boom" })).toEqual({
      message: "Couldn't send the confirmation link. Try again.",
      confirmed: false,
      pending: false,
    });
  });

  it("400 — invalid email format", () => {
    expect(confirmAddressMessage(400, {})).toEqual({
      message: "That doesn't look like a valid email address.",
      confirmed: false,
      pending: false,
    });
  });

  it("200 confirmed:true — the already-confirmed short-circuit, no message needed", () => {
    expect(confirmAddressMessage(200, { confirmed: true })).toEqual({
      message: null,
      confirmed: true,
      pending: false,
    });
  });

  it("200 confirmed:false — a new address, confirmation email sent, now pending", () => {
    expect(confirmAddressMessage(200, { confirmed: false })).toEqual({
      message: null,
      confirmed: false,
      pending: true,
    });
  });

  it("an unmapped status falls back to the same generic message as a genuine 500", () => {
    expect(confirmAddressMessage(599, {})).toEqual({
      message: "Couldn't send the confirmation link. Try again.",
      confirmed: false,
      pending: false,
    });
  });
});

describe("testSendMessage — POST /api/profile/send-test-email's response (§1al (g))", () => {
  it("unavailable — Resend isn't configured", () => {
    expect(testSendMessage(200, { sent: false, reason: "unavailable" })).toEqual({
      message: "Email sending isn't configured yet.",
      success: false,
    });
  });

  it("no_address", () => {
    expect(testSendMessage(400, { sent: false, reason: "no_address" })).toEqual({
      message: "Add an email above first.",
      success: false,
    });
  });

  it("intent_required — this is the doubled-period bug's old case ('…first..')", () => {
    expect(testSendMessage(400, { sent: false, reason: "intent_required" })).toEqual({
      message: "Add a research focus first.",
      success: false,
    });
  });

  it("rate_limited", () => {
    expect(testSendMessage(429, { sent: false, reason: "rate_limited" })).toEqual({
      message: "You've used today's 3 test sends. Try again tomorrow.",
      success: false,
    });
  });

  it("sender_not_verified — never Resend's raw sandbox text", () => {
    expect(testSendMessage(502, { sent: false, reason: "sender_not_verified" })).toEqual({
      message: "Peer's email sender isn't set up to reach this address yet.",
      success: false,
    });
  });

  it("send_failed — the generic fallback reason, never a raw provider string", () => {
    expect(testSendMessage(502, { sent: false, reason: "send_failed" })).toEqual({
      message: "Couldn't send the test email. Try again later.",
      success: false,
    });
  });

  // EMAIL-DEST-UX + EMPTY-TEST-EMAIL (§1bm point 3) — one case per
  // FeedEmptyReasonCode, mirroring how EMPTY-EMAIL-REASON's own tests are
  // structured (lib/briefing/copy.test.ts): every code renders its adapted,
  // link-free sentence, plus the try-used sentence, plus a generic fallback
  // for a missing/unrecognized code — never a guess.
  it.each([
    ["sources-unreachable", "Couldn't reach today's paper sources."],
    ["no-results", "Nothing new for these topics today."],
    ["no-required-match", "None of today's papers passed your Required topics and filters."],
    [
      "already-delivered",
      "Every paper that matched today was already picked for you in the past 30 days.",
    ],
  ])("empty_result with reason code %s", (code, sentence) => {
    const result = testSendMessage(200, { sent: false, reason: "empty_result", emptyReasonCode: code });
    expect(result.success).toBe(false);
    expect(result.message).toBe(
      `No test email was sent: ${sentence} This used one of today's 3 test sends.`,
    );
  });

  it("empty_result with no emptyReasonCode at all falls back to the generic sentence, never a guess", () => {
    expect(testSendMessage(200, { sent: false, reason: "empty_result" })).toEqual({
      message:
        "No test email was sent: No new papers matched this time. This used one of today's 3 test sends.",
      success: false,
    });
  });

  it("empty_result with a code this build doesn't recognize falls back to the generic sentence", () => {
    expect(
      testSendMessage(200, { sent: false, reason: "empty_result", emptyReasonCode: "a-future-code" }),
    ).toEqual({
      message:
        "No test email was sent: No new papers matched this time. This used one of today's 3 test sends.",
      success: false,
    });
  });

  // No link anywhere — POLICY 5 (guide §4): the reader who clicked "Send
  // test email" is already on the Profile page.
  it("empty_result sentences never contain a link back to Profile", () => {
    for (const code of [
      undefined,
      "sources-unreachable",
      "no-results",
      "no-required-match",
      "already-delivered",
    ]) {
      const { message } = testSendMessage(200, { sent: false, reason: "empty_result", emptyReasonCode: code });
      expect(message).not.toContain("/profile");
      expect(message).not.toContain("<a ");
    }
  });

  it("success names the destination address", () => {
    expect(testSendMessage(200, { sent: true, to: "person@example.test" })).toEqual({
      message: "Sent just now to person@example.test.",
      success: true,
    });
  });

  it("success with no address on the body still produces a plain sentence", () => {
    expect(testSendMessage(200, { sent: true })).toEqual({
      message: "Sent just now to your address.",
      success: true,
    });
  });

  it("an unrecognized shape falls back to the generic message, never undefined", () => {
    expect(testSendMessage(500, {})).toEqual({
      message: "Couldn't send the test email. Try again later.",
      success: false,
    });
  });
});

// PROFILE-UNSYNCED-FIELDS (§1bp.3) — preferredJournals and deepReportEnabled
// are device-only for now (no account column), said honestly on the page
// itself. Source-text check (acceptable for page copy, as elsewhere in this
// repo — e.g. app/papers/[id]/page.test.tsx's own call-site checks) since
// this repo has no harness to render the whole effectful page.
describe("page.tsx source — the device-only hint lines (§1bp.3)", () => {
  const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
  const SENTENCE = "Saved on this device only.";

  it("appears exactly twice in the page, verbatim", () => {
    const matches = source.match(/Saved on this device only\./g) ?? [];
    expect(matches).toHaveLength(2);
  });

  it("the line next to Preferred journals is reachable from that field's own call site", () => {
    const fieldStart = source.indexOf("Preferred journals");
    expect(fieldStart).toBeGreaterThan(-1);
    const nextSentenceAt = source.indexOf(SENTENCE, fieldStart);
    expect(nextSentenceAt).toBeGreaterThan(-1);
    // Reachable within the SAME field block — before the next EditRow starts.
    const nextEditRowAt = source.indexOf("<EditRow", fieldStart + "Preferred journals".length);
    expect(nextSentenceAt).toBeLessThan(nextEditRowAt);
  });

  it("the line next to the Deep report toggle is reachable from that toggle's own call site", () => {
    const toggleStart = source.indexOf('aria-label="Deep report"');
    expect(toggleStart).toBeGreaterThan(-1);
    const nextSentenceAt = source.indexOf(SENTENCE, toggleStart);
    expect(nextSentenceAt).toBeGreaterThan(-1);
    const nextEditRowAt = source.indexOf("<EditRow", toggleStart);
    // The sentence sits before this EditRow closes — no later EditRow's
    // opening tag appears in between (or there is no later one at all).
    if (nextEditRowAt !== -1) {
      expect(nextSentenceAt).toBeLessThan(nextEditRowAt);
    }
  });
});
