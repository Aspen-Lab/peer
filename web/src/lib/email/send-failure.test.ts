import { describe, expect, it } from "vitest";
import {
  classifySendFailure,
  describeSendFailureForLog,
  redactEmailAddresses,
} from "./send-failure";

// ABC-JEV-INTEGRATION.md §1al POLISH-1-EMAIL (f)/(g) — shared by
// confirm-email/route.ts and send-test-email/route.ts. "Representative
// shapes" per the ruling: both known Resend sandbox wordings, an unrelated
// validation_error, a network error, and a missing errorCode.
describe("classifySendFailure", () => {
  it("Resend wording 1 — sandbox 'testing emails' restriction -> sender_not_verified", () => {
    const result = classifySendFailure({
      errorCode: "validation_error",
      error:
        "You can only send testing emails to your own email address (owner@example.test). To send emails to other recipients, please verify a domain at resend.com/domains, and change the `from` address to an email using this domain.",
    });
    expect(result).toBe("sender_not_verified");
  });

  it("Resend wording 2 — unverified domain -> sender_not_verified", () => {
    const result = classifySendFailure({
      errorCode: "validation_error",
      error:
        "The example.com domain is not verified. Please, add and verify your domain on https://resend.com/domains",
    });
    expect(result).toBe("sender_not_verified");
  });

  it("an unrelated validation_error -> the generic fallback, never guessed further", () => {
    const result = classifySendFailure({
      errorCode: "validation_error",
      error: "Invalid `to` field. Please add a valid recipient email address.",
    });
    expect(result).toBe("send_failed");
  });

  it("a network/thrown error carries no errorCode -> the generic fallback", () => {
    const result = classifySendFailure({ error: "fetch failed" });
    expect(result).toBe("send_failed");
  });

  it("a missing errorCode entirely -> the generic fallback, even if the message mentions a domain", () => {
    const result = classifySendFailure({
      error: "domain is not verified (some unrelated proxy error, not Resend's structured one)",
    });
    expect(result).toBe("send_failed");
  });

  it("an empty result -> the generic fallback", () => {
    expect(classifySendFailure({})).toBe("send_failed");
  });
});

describe("redactEmailAddresses — never a raw address in a server log", () => {
  it("replaces one address with [email]", () => {
    expect(redactEmailAddresses("only deliverable to owner@example.test today")).toBe(
      "only deliverable to [email] today",
    );
  });

  it("replaces every address when more than one appears", () => {
    expect(redactEmailAddresses("a@b.test wrote to c@d.test")).toBe("[email] wrote to [email]");
  });

  it("leaves text with no address untouched", () => {
    expect(redactEmailAddresses("Invalid `to` field.")).toBe("Invalid `to` field.");
  });
});

describe("describeSendFailureForLog", () => {
  it("combines the provider's error name and a redacted message", () => {
    const line = describeSendFailureForLog({
      errorCode: "validation_error",
      error: "You can only send testing emails to your own email address (owner@example.test).",
    });
    expect(line).toBe(
      "validation_error: You can only send testing emails to your own email address ([email]).",
    );
  });

  it("falls back to 'error' and 'unknown error' when the result carries neither", () => {
    expect(describeSendFailureForLog({})).toBe("error: unknown error");
  });
});
