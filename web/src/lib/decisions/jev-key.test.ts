import { describe, expect, it } from "vitest";
import { JEV_API_KEY_MAX_LENGTH, parseJevApiKey } from "./jev-key";

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

  it("allows exactly the maximum length and refuses one more", () => {
    expect(JEV_API_KEY_MAX_LENGTH).toBe(512);
    expect(parseJevApiKey("k".repeat(JEV_API_KEY_MAX_LENGTH))).toBe(
      "k".repeat(JEV_API_KEY_MAX_LENGTH),
    );
    expect(parseJevApiKey("k".repeat(JEV_API_KEY_MAX_LENGTH + 1))).toBeUndefined();
  });
});
