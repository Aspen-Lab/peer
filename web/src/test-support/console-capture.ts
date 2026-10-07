import { inspect } from "node:util";
import { vi } from "vitest";

/**
 * Every console method a line of code can write through. A reader's key must
 * reach none of them, so a test that searches "the log" for a sentinel has to
 * watch all five: the branch review (finding B-1) showed that a spy on `log`,
 * `warn` and `error` alone lets `console.info(key)` or `console.debug(key)`
 * pass the whole suite (mutation C4). One list, here, so a sixth method is one
 * edit.
 */
export const CAPTURED_CONSOLE_METHODS = ["log", "info", "debug", "warn", "error"] as const;

export interface ConsoleCapture {
  /**
   * Everything written so far: each call's arguments joined with a space, one
   * call per line. Objects, arrays and errors are rendered in depth, not as
   * "[object Object]", so a key held in a field is still found.
   */
  text(): string;
  /** How many calls were recorded across the five methods. */
  calls(): number;
  /** Put the real console methods back. Safe to call twice, and after `vi.restoreAllMocks()`. `text()` still answers. */
  restore(): void;
}

function render(argument: unknown): string {
  if (typeof argument === "string") return argument;
  try {
    return inspect(argument, { depth: 10, breakLength: Infinity, maxArrayLength: null, maxStringLength: null });
  } catch {
    return String(argument);
  }
}

/**
 * Silence and record `console.log`, `info`, `debug`, `warn` and `error`.
 *
 * ```ts
 * const consoleText = captureConsole();
 * try {
 *   await runTheFlow();
 *   expect(consoleText.text()).not.toContain(KEY);
 * } finally {
 *   consoleText.restore();
 * }
 * ```
 *
 * Nothing is forwarded to the real console, so the test run stays quiet. Use a
 * sentinel string for the key, never a real credential.
 */
export function captureConsole(): ConsoleCapture {
  const lines: string[] = [];
  const spies = CAPTURED_CONSOLE_METHODS.map((method) =>
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(args.map(render).join(" "));
    }),
  );
  return {
    text: () => lines.join("\n"),
    calls: () => lines.length,
    restore: () => {
      for (const spy of spies) spy.mockRestore();
    },
  };
}
