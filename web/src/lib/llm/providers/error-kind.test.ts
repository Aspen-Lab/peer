import { describe, expect, it } from "vitest";
import { errorKind } from "./error-kind";

// P5-06 item 1 (§1h.19 (a)). `errorKind` is the one thing a log line may say
// about an error that came back from a model provider: the kind and, when the
// error carries one, an HTTP status the owner needs to diagnose it. Never the
// message — a provider's error body can quote the request it answered, and the
// request holds the reader's words. Every marker below is invented.
const MARKER = "Quillfeather-Tarn-marker";

describe("errorKind — kind, and a status when there is one", () => {
  it("an Error is its name, and its message is not in the answer", () => {
    expect(errorKind(new Error(`body: ${MARKER}`))).toBe("Error");
  });

  it("a subclass is its own name", () => {
    class ApiError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "ApiError";
      }
    }
    expect(errorKind(new ApiError(MARKER))).toBe("ApiError");
  });

  it("an Error with a numeric status says the status", () => {
    const err = Object.assign(new Error(`body: ${MARKER}`), { name: "ApiError", status: 400 });
    expect(errorKind(err)).toBe("ApiError status 400");
    expect(errorKind(err)).not.toContain(MARKER);
  });

  it("a numeric code says the code when there is no status", () => {
    expect(errorKind(Object.assign(new Error(MARKER), { code: 429 }))).toBe("Error code 429");
  });

  it("the status wins when both are there", () => {
    expect(errorKind(Object.assign(new Error(MARKER), { status: 503, code: 429 }))).toBe("Error status 503");
  });

  it("a status that is not a number is not logged (a string can carry anything)", () => {
    expect(errorKind(Object.assign(new Error("x"), { status: `400 ${MARKER}` }))).toBe("Error");
    expect(errorKind(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBe("Error");
    expect(errorKind(Object.assign(new Error("x"), { status: { text: MARKER } }))).toBe("Error");
  });

  it("a number that cannot be an HTTP status is not logged", () => {
    for (const odd of [0, -1, 99, 600, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 5551234567]) {
      expect(errorKind(Object.assign(new Error("x"), { status: odd }))).toBe("Error");
      expect(errorKind(Object.assign(new Error("x"), { code: odd }))).toBe("Error");
    }
  });

  it("a non-integer inside 100–599 is not logged either (the range alone does not make a number a status)", () => {
    // 1.5 above is outside the range, so it never reaches the integer check; these
    // are the values that do, and only that check keeps them out.
    for (const fractional of [404.5, 100.1, 599.9, 503.0000001]) {
      expect(errorKind(Object.assign(new Error("x"), { status: fractional }))).toBe("Error");
      expect(errorKind(Object.assign(new Error("x"), { code: fractional }))).toBe("Error");
    }
    // A fractional status does not hide a whole code beside it, and a whole status
    // still wins over a fractional code.
    expect(errorKind(Object.assign(new Error("x"), { status: 404.5, code: 429 }))).toBe("Error code 429");
    expect(errorKind(Object.assign(new Error("x"), { status: 404, code: 429.5 }))).toBe("Error status 404");
    // The same for a thrown plain object, which takes the same path.
    expect(errorKind({ message: MARKER, status: 404.5 })).toBe("object");
  });

  it("the edges of the HTTP range are logged", () => {
    expect(errorKind(Object.assign(new Error("x"), { status: 100 }))).toBe("Error status 100");
    expect(errorKind(Object.assign(new Error("x"), { status: 599 }))).toBe("Error status 599");
  });

  it("a thrown string is its type, never its text", () => {
    expect(errorKind(`provider said: ${MARKER}`)).toBe("string");
  });

  it("other thrown values are their type", () => {
    expect(errorKind(undefined)).toBe("undefined");
    expect(errorKind(42)).toBe("number");
    expect(errorKind(null)).toBe("object");
  });

  it("a thrown plain object is its type, plus a status it carries", () => {
    expect(errorKind({ message: MARKER })).toBe("object");
    expect(errorKind({ message: MARKER, status: 502 })).toBe("object status 502");
  });

  it("an Error whose name is not text is plain Error (the name is read, never trusted)", () => {
    const err = new Error(MARKER);
    Object.defineProperty(err, "name", { value: { text: MARKER } });
    expect(errorKind(err)).toBe("Error");
  });
});
