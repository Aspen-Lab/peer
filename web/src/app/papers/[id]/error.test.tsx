import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// P10-30 rule 3 (BACKLOG-74, from B P10-01 / C P10-08): a throw inside the reader page was caught only by the root
// `app/error.tsx`, whose whole-view "This view hit a snag" talks about the briefing. `app/papers/[id]/error.tsx` is the
// reader's own boundary: a calm in-place message in Peer's voice, a Try again button that calls `reset()`, and a way back
// to the library. The root boundary is unchanged. No DOM in this runtime: the markup is rendered to a string, and the
// button's handler is found in the element tree and called.

const effects = vi.hoisted(() => ({ run: [] as Array<() => void> }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useEffect: (fn: () => void) => { effects.run.push(fn); } };
});

import ReaderError from "./error";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/** Every element in a tree, descending through props.children and through function components called with their props. */
function walk(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) { node.forEach((n) => walk(n, out)); return out; }
  if (!isValidElement(node)) return out;
  out.push(node as ReactElement);
  const el = node as ReactElement<{ children?: ReactNode; actions?: ReactNode }>;
  if (typeof el.type === "function") {
    walk((el.type as (p: unknown) => ReactNode)(el.props), out);
  } else {
    walk(el.props.children, out);
  }
  if (el.props.actions) walk(el.props.actions, out);
  return out;
}

afterEach(() => { effects.run.length = 0; vi.restoreAllMocks(); });

describe("the reader's own error view (BACKLOG-74)", () => {
  const error = Object.assign(new Error("boom"), { digest: "abc123" });

  it("says, in Peer's voice and in place, what happened and that the reader's things are safe — not the root's whole-view words", () => {
    const html = renderToStaticMarkup(<ReaderError error={error} reset={() => {}} />);
    expect(html).toContain("This paper&#x27;s page hit a snag.");
    expect(html).toMatch(/notes and saved papers are safe/i);
    expect(html).not.toContain("This view hit a snag");
    expect(html).not.toContain("briefing");
  });

  it("has a Try again button that calls reset(), and a link back to the library (Saved)", () => {
    const reset = vi.fn();
    const tree = walk(<ReaderError error={error} reset={reset} />);
    const button = tree.find((el) => el.type === "button");
    expect(button).toBeTruthy();
    (button!.props as { onClick: () => void }).onClick();
    expect(reset).toHaveBeenCalledTimes(1);
    const html = renderToStaticMarkup(<ReaderError error={error} reset={reset} />);
    expect(html).toContain("Try again");
    expect(html).toMatch(/<a [^>]*href="\/saved"[^>]*>[^<]*(library|Saved|saved)/);
  });

  it("logs the error once on mount and shows its digest as a quiet reference", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToStaticMarkup(<ReaderError error={error} reset={() => {}} />);
    expect(html).toContain("ref abc123");
    effects.run.forEach((fn) => fn());
    expect(log).toHaveBeenCalledWith(error);
  });

  it("shows no reference when the error has no digest", () => {
    const html = renderToStaticMarkup(<ReaderError error={new Error("x")} reset={() => {}} />);
    expect(html).not.toContain("ref ");
  });

  it("the root boundary is unchanged and is a different file", () => {
    const root = read("src/app/error.tsx");
    expect(root).toContain("This view hit a snag.");
    expect(root).toContain("Back to the briefing");
    expect(read("src/app/papers/[id]/error.tsx")).not.toBe(root);
  });
});
