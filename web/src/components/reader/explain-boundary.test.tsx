import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXPLAIN_WINDOW_ID, useWindows } from "@/lib/reader/windows";
import { EXPLAIN_UNAVAILABLE_LINE, ExplainBoundary } from "./explain-boundary";

// P11-14 rule 5 (B P11-02 §3.2 C P11-02b, D3; B P10-01's step 5): a throw in the explain box must leave the paper page and Tier 0 alone.
// The route's boundary (`app/papers/[id]/error.tsx`) catches it today and replaces the WHOLE reader page with "This paper's page hit a
// snag."; this one is local to the box — it renders a quiet line in its place and nothing else changes. React's server renderer does not
// run error boundaries, so the class is tested through the methods React calls: `getDerivedStateFromError`, `componentDidCatch`, `render`.
// Every text here is invented.

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return textOf((node as ReactElement<{ children?: ReactNode }>).props?.children);
}

describe("ExplainBoundary", () => {
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    error = vi.spyOn(console, "error").mockImplementation(() => {});
    useWindows.setState({ windows: [], clock: 0, origin: null });
  });
  afterEach(() => {
    error.mockRestore();
    useWindows.setState({ windows: [], clock: 0, origin: null });
  });

  it("renders its children, untouched, while nothing has thrown", () => {
    const html = renderToStaticMarkup(createElement(ExplainBoundary, null, createElement("p", null, "THE BOX")));
    expect(html).toBe("<p>THE BOX</p>");
  });

  it("a throw below it turns the boundary to its failed state", () => {
    expect(ExplainBoundary.getDerivedStateFromError(new Error("boom"))).toEqual({ failed: true });
  });

  it("in the failed state it renders one quiet line, in place of the box, that says the paper is unaffected", () => {
    const boundary = new ExplainBoundary({ children: createElement("p", null, "THE BOX") });
    boundary.state = { failed: true };
    const out = boundary.render();
    const line = textOf(out);
    expect(line).toBe(EXPLAIN_UNAVAILABLE_LINE);
    expect(EXPLAIN_UNAVAILABLE_LINE).toBe("Explain is unavailable. The paper is unaffected.");
    expect(line).not.toContain("THE BOX");
    const html = renderToStaticMarkup(out as ReactElement);
    expect(html).toContain('role="status"');
  });

  it("the line is quiet: no button, no link, no alert, nothing that takes the focus", () => {
    const boundary = new ExplainBoundary({ children: null });
    boundary.state = { failed: true };
    const html = renderToStaticMarkup(boundary.render() as ReactElement);
    expect(html).not.toMatch(/<button|<a |role="alert"|tabindex/i);
  });

  it("logs what threw, once, and takes the explain card out of the stack so no header is left standing for a box that is gone", () => {
    useWindows.getState().open({ id: EXPLAIN_WINDOW_ID, kind: "explain", title: "Explain this" });
    useWindows.getState().open({ id: "s1", kind: "sticky", title: "Note 1" });
    const boundary = new ExplainBoundary({ children: null });
    boundary.componentDidCatch(new Error("boom"), { componentStack: "at ExplainBox" });
    expect(error).toHaveBeenCalledTimes(1);
    expect(useWindows.getState().windows.map((w) => w.id)).toEqual(["s1"]);
  });

  it("never touches the network or a model: it imports neither fetch nor a request module", () => {
    const source = read("src/components/reader/explain-boundary.tsx");
    expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon|postExplain|import .*llm/);
  });
});

describe("the page puts the boundary round the box (P11-14 rule 5)", () => {
  const page = read("src/app/papers/[id]/page.tsx");

  it("wraps the one <ExplainBox> in <ExplainBoundary>, keyed by the paper, so the next paper starts with a working box", () => {
    expect(page).toContain('import { ExplainBoundary } from "@/components/reader/explain-boundary";');
    const open = page.search(/<ExplainBoundary[\s>]/);
    const box = page.indexOf("<ExplainBox");
    const close = page.indexOf("</ExplainBoundary>");
    expect(open).toBeGreaterThan(0);
    expect(box).toBeGreaterThan(open);
    expect(close).toBeGreaterThan(box);
    expect(page.slice(open, box)).toContain("key={paper.id}");
    expect(page.match(/<ExplainBox\b/g)).toHaveLength(1);
  });

  it("leaves the selection actions, the sticky notes and the notes tab outside the boundary: a throw in the box takes none of them", () => {
    const close = page.indexOf("</ExplainBoundary>");
    for (const outside of ["<SelectionToolbar", "<StickyNotes", '<NotesButton variant="edge"']) expect(page.indexOf(outside), outside).toBeGreaterThan(close);
  });
});
