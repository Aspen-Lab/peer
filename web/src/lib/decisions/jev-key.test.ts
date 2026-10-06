import { describe, expect, it } from "vitest";
import { JEV_KEY_MAX_LENGTH, parseJevApiKey } from "./jev-key";

// An invented string. It is not, and never was, a key.
const SENTINEL = "jev-test-sentinel-not-a-key-0000";

describe("parseJevApiKey", () => {
  it("accepts a plain string and returns it unchanged", () => {
    expect(parseJevApiKey(SENTINEL)).toBe(SENTINEL);
  });

  it("trims the ends", () => {
    expect(parseJevApiKey(`  ${SENTINEL}\n`)).toBe(SENTINEL);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a number", 42],
    ["an object", { key: SENTINEL }],
    ["an array", [SENTINEL]],
    ["an empty string", ""],
    ["only whitespace", "   \t "],
  ])("answers undefined for %s", (_label, value) => {
    expect(parseJevApiKey(value)).toBeUndefined();
  });

  it.each([
    ["a space inside", "jev key"],
    ["a tab inside", "jev\tkey"],
    ["a newline inside", "jev\nkey"],
    ["a NUL character", "jev\u0000key"],
    ["a DEL character", "jev\u007fkey"],
    ["a C1 control character", "jev\u0085key"],
  ])("answers undefined for a key with %s", (_label, value) => {
    expect(parseJevApiKey(value)).toBeUndefined();
  });

  // N8(e) of the branch review: `fetch` refuses a header value outside Latin-1
  // before any request is made, which used to turn a pasted smart quote or a
  // zero-width space into a day's "Jev did not answer". The shape rule is printable
  // ASCII (0x21 to 0x7E) so the browser says "That does not look like a key" at once.
  it("accepts every printable ASCII character, from ! (0x21) to ~ (0x7E)", () => {
    const allPrintable = Array.from({ length: 0x7e - 0x21 + 1 }, (_, i) => String.fromCharCode(0x21 + i)).join("");
    expect(allPrintable).toHaveLength(94);
    expect(parseJevApiKey(allPrintable)).toBe(allPrintable);
    expect(parseJevApiKey("!")).toBe("!");
    expect(parseJevApiKey("~")).toBe("~");
  });

  it("accepts a key made of letters, digits and the usual separators", () => {
    expect(parseJevApiKey("jev_live-AbC123.xyz~+/=:")).toBe("jev_live-AbC123.xyz~+/=:");
  });

  it.each([
    ["a smart quote at the start (a paste from a document)", "\u201Cjev-key-0000"],
    ["a smart quote inside", "jev-\u2019key-0000"],
    ["a zero-width space inside (not whitespace to a regex, not Latin-1 to fetch)", "jev-key\u200B-0000"],
    ["a zero-width space at the end (trim does not remove it)", "jev-key-0000\u200B"],
    ["a byte-order mark at the start, inside the string", "jev\uFEFF-key"],
    ["a non-breaking space inside", "jev\u00A0key"],
    ["a Latin-1 letter (fetch would take it; the rule does not)", "jev-k\u00E9y-0000"],
    ["Greek letters", "\u03BA\u03BB\u03B5\u03B9\u03B4\u03AF"],
    ["CJK characters", "\u5BC6\u94A5-jev-0000"],
    ["an emoji", "jev-key-\u{1F511}"],
    ["a full-width digit", "jev-key-\uFF11\uFF12"],
    ["an en dash for a hyphen (autocorrect)", "jev\u2013key-0000"],
  ])("answers undefined for a key with %s", (_label, value) => {
    expect(parseJevApiKey(value)).toBeUndefined();
  });

  it("still trims a non-breaking space or a byte-order mark at the ends, then accepts what is left", () => {
    expect(parseJevApiKey(`\u00A0${SENTINEL}\u00A0`)).toBe(SENTINEL);
    expect(parseJevApiKey(`\uFEFF${SENTINEL}`)).toBe(SENTINEL);
  });

  it("allows exactly the maximum length and refuses one more", () => {
    expect(JEV_KEY_MAX_LENGTH).toBe(512);
    expect(parseJevApiKey("k".repeat(JEV_KEY_MAX_LENGTH))).toBe(
      "k".repeat(JEV_KEY_MAX_LENGTH),
    );
    expect(parseJevApiKey("k".repeat(JEV_KEY_MAX_LENGTH + 1))).toBeUndefined();
  });
});
