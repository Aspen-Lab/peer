import { describe, expect, it } from "vitest";
import {
  renderConfirmEmailHtml,
  renderConfirmEmailPlaintext,
  renderConfirmEmailSubject,
} from "./confirm-email-template";

// EMAIL-SETTINGS — a new sibling file to digest-template.ts (that file is
// NOT edited, per guide §2.5's explicit parenthetical), sent via the
// existing, unmodified sendDigestEmail({ items: [], render: {...} }) call
// shape (the same "empty items + render override" trick
// handleConflictingEmailClaim already uses).

const CONFIRM_URL =
  "https://example.test/api/profile/confirm-email?token=abc123.def456";

describe("confirm-email-template", () => {
  it("has a stable, distinct subject", () => {
    expect(renderConfirmEmailSubject()).toMatch(/confirm/i);
  });

  it("plaintext includes the confirmation URL verbatim", () => {
    const text = renderConfirmEmailPlaintext({ confirmUrl: CONFIRM_URL });
    expect(text).toContain(CONFIRM_URL);
  });

  it("html links to the confirmation URL", () => {
    const html = renderConfirmEmailHtml({ confirmUrl: CONFIRM_URL });
    expect(html).toContain(`href="${CONFIRM_URL}"`);
  });

  it("html escapes a URL containing HTML-significant characters", () => {
    const dangerous = "https://example.test/x?a=1&b=<script>";
    const html = renderConfirmEmailHtml({ confirmUrl: dangerous });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&amp;b=&lt;script&gt;");
  });

  it("mentions the 24 hour expiry in plain words", () => {
    const html = renderConfirmEmailHtml({ confirmUrl: CONFIRM_URL });
    const text = renderConfirmEmailPlaintext({ confirmUrl: CONFIRM_URL });
    expect(html).toMatch(/24 hours/i);
    expect(text).toMatch(/24 hours/i);
  });

  it("reassures a reader who did not request this that nothing happens if ignored", () => {
    const text = renderConfirmEmailPlaintext({ confirmUrl: CONFIRM_URL });
    expect(text.toLowerCase()).toContain("didn't request");
  });
});
