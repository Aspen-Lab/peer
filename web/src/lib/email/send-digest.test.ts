// P4-S7-IDEM (Round 3) -- ABC-JEV-INTEGRATION.md §4 "P4-S7-IDEM B complete"
// ruling. Unit tests for the Resend-idempotency-key additions to
// sendDigestEmail: an optional `idempotencyKey` forwarded as the SDK's
// second `send()` argument, and an optional `render` override that replays
// pre-rendered content verbatim instead of calling the (non-deterministic --
// each calls `new Date()`) template functions again. New file; no prior
// send-digest.test.ts existed (confirmed via Glob before writing this).
//
// `resend` and `@/lib/email/digest-template` are both mocked so every
// assertion below is about THIS file's own call shape, never about the real
// SDK network behaviour or the real template's rendered bytes (those are
// each covered elsewhere -- the SDK contract by docs/jev-abc/
// P4-S7-IDEM-B-20260924T113658Z.md's B1-B9, the template content by
// digest-template.ts's own tests, if any, which this item does not touch).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  renderDigestSubject: vi.fn(),
  renderDigestHtml: vi.fn(),
  renderDigestPlaintext: vi.fn(),
}));

vi.mock("resend", () => ({
  // A regular `function`, not an arrow function: `new Resend(key)` in
  // send-digest.ts invokes this via JS constructor semantics, and arrow
  // functions have no `[[Construct]]` -- vitest's mock `new` dispatch fails
  // with "is not a constructor" if this is written as `() => ({...})`.
  Resend: vi.fn().mockImplementation(function MockResend() {
    return { emails: { send: mocks.send } };
  }),
}));

vi.mock("@/lib/email/digest-template", () => ({
  renderDigestSubject: mocks.renderDigestSubject,
  renderDigestHtml: mocks.renderDigestHtml,
  renderDigestPlaintext: mocks.renderDigestPlaintext,
}));

import { sendDigestEmail } from "@/lib/email/send-digest";

const FIXTURE_SUBJECT = "FIXTURE_SUBJECT_MARKER";
const FIXTURE_HTML = "<p>FIXTURE_HTML_BODY_SECRET_MARKER</p>";
const FIXTURE_TEXT = "FIXTURE_TEXT_BODY_SECRET_MARKER";

function baseInput() {
  return {
    to: "person@example.test",
    firstName: "Ada",
    items: [],
    originUrl: "https://example.test",
  };
}

describe("sendDigestEmail -- P4-S7-IDEM idempotency key + render replay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RESEND_API_KEY", "test-key");
    mocks.renderDigestSubject.mockReturnValue(FIXTURE_SUBJECT);
    mocks.renderDigestHtml.mockReturnValue(FIXTURE_HTML);
    mocks.renderDigestPlaintext.mockReturnValue(FIXTURE_TEXT);
    mocks.send.mockResolvedValue({ data: { id: "email-1" }, error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("no idempotencyKey given: calls emails.send with EXACTLY ONE argument -- byte-identical call shape to before this item, not even an `idempotencyKey: undefined` key", async () => {
    await sendDigestEmail(baseInput());

    expect(mocks.send).toHaveBeenCalledTimes(1);
    const call = mocks.send.mock.calls[0];
    expect(call).toHaveLength(1);
    expect(call[0]).toEqual({
      from: "Peer <onboarding@resend.dev>",
      to: ["person@example.test"],
      subject: FIXTURE_SUBJECT,
      html: FIXTURE_HTML,
      text: FIXTURE_TEXT,
    });
    // Every template function is still called exactly as before when no
    // `render` override is supplied.
    expect(mocks.renderDigestSubject).toHaveBeenCalledTimes(1);
    expect(mocks.renderDigestHtml).toHaveBeenCalledTimes(1);
    expect(mocks.renderDigestPlaintext).toHaveBeenCalledTimes(1);
  });

  // EMPTY-EMAIL-REASON (ABC-JEV-INTEGRATION.md §1bj) -- sendDigestEmail
  // itself does no branching on emptyReasonCode; it just needs to forward
  // whatever it was given into the (real, unmocked in digest-template.
  // test.ts) template functions, the same way it already forwards
  // firstName/items/originUrl by passing the whole `input` object through.
  it("emptyReasonCode given: forwarded into renderDigestHtml AND renderDigestPlaintext, not into renderDigestSubject", async () => {
    await sendDigestEmail({ ...baseInput(), emptyReasonCode: "no-required-match" });

    expect(mocks.renderDigestHtml).toHaveBeenCalledWith(
      expect.objectContaining({ emptyReasonCode: "no-required-match" }),
    );
    expect(mocks.renderDigestPlaintext).toHaveBeenCalledWith(
      expect.objectContaining({ emptyReasonCode: "no-required-match" }),
    );
    // renderDigestSubject's contract is `(items: ScoredItem[])` -- a single
    // positional array argument, structurally unable to carry the code.
    expect(mocks.renderDigestSubject).toHaveBeenCalledWith(baseInput().items);
  });

  it("emptyReasonCode omitted: the template functions receive it as undefined, same as before this item", async () => {
    await sendDigestEmail(baseInput());

    const htmlArg = mocks.renderDigestHtml.mock.calls[0][0];
    const textArg = mocks.renderDigestPlaintext.mock.calls[0][0];
    expect(htmlArg.emptyReasonCode).toBeUndefined();
    expect(textArg.emptyReasonCode).toBeUndefined();
  });

  it("render override given: emptyReasonCode is irrelevant -- the template functions are never called at all", async () => {
    await sendDigestEmail({
      ...baseInput(),
      emptyReasonCode: "sources-unreachable",
      idempotencyKey: "retry-key",
      render: { subject: "S", html: "H", text: "T" },
    });

    expect(mocks.renderDigestHtml).not.toHaveBeenCalled();
    expect(mocks.renderDigestPlaintext).not.toHaveBeenCalled();
  });

  it("idempotencyKey given: calls emails.send with a SECOND argument carrying exactly that key", async () => {
    await sendDigestEmail({ ...baseInput(), idempotencyKey: "abc123key" });

    expect(mocks.send).toHaveBeenCalledTimes(1);
    const call = mocks.send.mock.calls[0];
    expect(call).toHaveLength(2);
    expect(call[1]).toEqual({ idempotencyKey: "abc123key" });
  });

  it("render given: sends the exact provided subject/html/text verbatim and NEVER calls the template functions (the non-determinism this item exists to close)", async () => {
    await sendDigestEmail({
      ...baseInput(),
      idempotencyKey: "retry-key",
      render: { subject: "STORED_SUBJECT", html: "STORED_HTML", text: "STORED_TEXT" },
    });

    expect(mocks.renderDigestSubject).not.toHaveBeenCalled();
    expect(mocks.renderDigestHtml).not.toHaveBeenCalled();
    expect(mocks.renderDigestPlaintext).not.toHaveBeenCalled();
    const call = mocks.send.mock.calls[0];
    expect(call[0]).toMatchObject({
      subject: "STORED_SUBJECT",
      html: "STORED_HTML",
      text: "STORED_TEXT",
    });
  });

  it("render replayed at a materially later instant is still byte-identical (the exact regression this item closes -- without `render`, renderDigestHtml/Subject/Plaintext each call `new Date()` and would drift)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T12:00:00.000Z"));
    const stored = { subject: "FROZEN_SUBJECT", html: "FROZEN_HTML", text: "FROZEN_TEXT" };

    await sendDigestEmail({ ...baseInput(), idempotencyKey: "k", render: stored });
    const firstPayload = mocks.send.mock.calls[0][0];

    vi.setSystemTime(new Date("2026-09-25T09:00:00.000Z")); // >21h later, crosses a UTC day boundary
    await sendDigestEmail({ ...baseInput(), idempotencyKey: "k", render: stored });
    const secondPayload = mocks.send.mock.calls[1][0];

    expect(secondPayload).toEqual(firstPayload);
    vi.useRealTimers();
  });

  it("success: returns sent true and the provider messageId, errorCode absent", async () => {
    mocks.send.mockResolvedValue({ data: { id: "msg-xyz" }, error: null });
    const result = await sendDigestEmail(baseInput());
    expect(result).toEqual({ sent: true, messageId: "msg-xyz" });
  });

  it("structured Resend error: surfaces error.name as errorCode (needed by the route to distinguish concurrent_idempotent_requests / invalid_idempotent_request from a generic failure)", async () => {
    mocks.send.mockResolvedValue({
      data: null,
      error: { message: "another request with this key is in flight", name: "concurrent_idempotent_requests", statusCode: 409 },
    });
    const result = await sendDigestEmail({ ...baseInput(), idempotencyKey: "k" });
    expect(result.sent).toBe(false);
    expect(result.errorCode).toBe("concurrent_idempotent_requests");
    expect(result.error).toBe("another request with this key is in flight");
  });

  it("invalid_idempotent_request is surfaced the same way (payload-mismatch conflict)", async () => {
    mocks.send.mockResolvedValue({
      data: null,
      error: { message: "this idempotency key has already been used on a request that had a different payload", name: "invalid_idempotent_request", statusCode: 409 },
    });
    const result = await sendDigestEmail({ ...baseInput(), idempotencyKey: "k" });
    expect(result.errorCode).toBe("invalid_idempotent_request");
  });

  it("thrown/network error: no errorCode (not a structured SDK response)", async () => {
    mocks.send.mockRejectedValue(new Error("fetch failed"));
    const result = await sendDigestEmail(baseInput());
    expect(result).toEqual({ sent: false, error: "fetch failed" });
    expect(result.errorCode).toBeUndefined();
  });

  it("never logs the rendered body (subject/html/text) to the console, on success or failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    await sendDigestEmail(baseInput());
    mocks.send.mockResolvedValue({ data: null, error: { message: "boom", name: "application_error" } });
    await sendDigestEmail({ ...baseInput(), idempotencyKey: "k" });
    mocks.send.mockRejectedValue(new Error("network down"));
    await sendDigestEmail(baseInput());

    const allLoggedText = [...logSpy.mock.calls, ...errorSpy.mock.calls, ...warnSpy.mock.calls, ...infoSpy.mock.calls]
      .flat()
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
      .join("\n");

    expect(allLoggedText).not.toContain(FIXTURE_HTML);
    expect(allLoggedText).not.toContain(FIXTURE_TEXT);
    expect(allLoggedText).not.toContain(FIXTURE_SUBJECT);

    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });
});
