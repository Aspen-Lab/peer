import { afterEach, describe, expect, it, vi } from "vitest";
import { CAPTURED_CONSOLE_METHODS, captureConsole } from "./console-capture";

/**
 * The helper exists because five sentinel tests once watched `console.log`,
 * `warn` and `error` and nothing else, so a reader's key written with
 * `console.info` or `console.debug` passed the whole suite (A's mutation C4).
 * These cases pin that the helper sees all five methods, whatever shape the
 * arguments have, and that it puts the console back.
 */

const originals = Object.fromEntries(CAPTURED_CONSOLE_METHODS.map((method) => [method, console[method]]));
let capture: ReturnType<typeof captureConsole> | undefined;

afterEach(() => {
  capture?.restore();
  capture = undefined;
});

describe("captureConsole", () => {
  it("watches exactly log, info, debug, warn and error", () => {
    expect([...CAPTURED_CONSOLE_METHODS]).toEqual(["log", "info", "debug", "warn", "error"]);
  });

  it.each(CAPTURED_CONSOLE_METHODS)("sees a string written with console.%s", (method) => {
    capture = captureConsole();
    console[method]("sentinel-for-" + method);
    expect(capture.text()).toContain("sentinel-for-" + method);
    expect(capture.calls()).toBe(1);
  });

  it("joins every argument of every call, one call per line", () => {
    capture = captureConsole();
    console.log("first", "second");
    console.info("third");
    expect(capture.text()).toBe("first second\nthird");
  });

  it("sees a value held inside an object, an array, an Error or a nested structure", () => {
    capture = captureConsole();
    console.info({ apiKey: "inside-an-object" });
    console.debug(["inside-an-array"]);
    console.warn(new Error("inside-an-error"));
    console.error({ deep: { deeper: { deepest: "inside-a-nested-object" } } });
    const text = capture.text();
    expect(text).toContain("inside-an-object");
    expect(text).toContain("inside-an-array");
    expect(text).toContain("inside-an-error");
    expect(text).toContain("inside-a-nested-object");
  });

  it("does not throw on a circular value, a symbol or undefined", () => {
    capture = captureConsole();
    const circular: Record<string, unknown> = { name: "circular-sentinel" };
    circular.self = circular;
    expect(() => {
      console.log(circular);
      console.log(Symbol("symbol-sentinel"));
      console.log(undefined, null);
    }).not.toThrow();
    expect(capture.text()).toContain("circular-sentinel");
    expect(capture.text()).toContain("symbol-sentinel");
  });

  it("restore() puts back the very functions it replaced, and later calls are not recorded", () => {
    capture = captureConsole();
    for (const method of CAPTURED_CONSOLE_METHODS) expect(console[method]).not.toBe(originals[method]);
    capture.restore();
    for (const method of CAPTURED_CONSOLE_METHODS) expect(console[method]).toBe(originals[method]);
    const other = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      console.info("written-after-restore");
    } finally {
      other.mockRestore();
    }
    expect(capture.text()).not.toContain("written-after-restore");
    expect(capture.calls()).toBe(0);
  });

  it("restore() can be called twice, and after vi.restoreAllMocks() has already run", () => {
    capture = captureConsole();
    vi.restoreAllMocks(); // what the sentinel suites' afterEach does
    expect(() => capture?.restore()).not.toThrow();
    expect(() => capture?.restore()).not.toThrow();
    for (const method of CAPTURED_CONSOLE_METHODS) expect(console[method]).toBe(originals[method]);
  });

  it("text() still answers after restore(), so a test can read it in a finally block's aftermath", () => {
    capture = captureConsole();
    console.error("recorded-before-restore");
    capture.restore();
    expect(capture.text()).toContain("recorded-before-restore");
  });
});
