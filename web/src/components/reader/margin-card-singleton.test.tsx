import type { ReactElement } from "react";
import { expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ scroll: true }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(), useRef: () => ({ current: null }) }));
vi.mock("@/lib/reader/margin", () => ({ useMarginRect: () => ({ top: 300, bottom: 400, left: 20, width: 350 }) }));
vi.mock("@/lib/reader/windows", () => ({ CARD_CONTENT_MIN_PX: 80, useWindows: Object.assign(() => [{ id: "one", kind: "sticky", title: "Note" }], { getState: () => ({ windows: [] }) }) }));
vi.mock("./margin-stack-scroll", () => ({ useMarginStack: () => ({ scroll: fixture.scroll, split: false, bandTop: 300,
  rows: [{ id: "one", top: 300, height: 189 }], windows: [{ id: "one", kind: "sticky", title: "Note" }], portal: (children: unknown) => children,
}) }));
import { MarginCard } from "./margin-card";

it("P12-21 renders an overflowing singleton relative to the bounded host, without a divider", () => {
  const out = MarginCard({ id: "one", kind: "sticky", title: "Note", front: true, top: 350, height: 50, z: 60 }) as ReactElement<{ children: [ReactElement<Record<string, unknown>>, boolean] }>;
  const [shell, divider] = out.props.children;
  expect(shell.props).toMatchObject({ top: 0, height: 189, maxHeight: 189, split: false });
  expect(shell.props.className).toContain("!absolute"); expect(divider).toBe(false);
});

it("P12-21 retains supplied selection geometry when the singleton minimum fits", () => {
  fixture.scroll = false;
  const out = MarginCard({ id: "one", kind: "sticky", title: "Note", front: true, top: 183, height: 257, z: 60 }) as ReactElement<{ children: [ReactElement<Record<string, unknown>>, boolean] }>;
  expect(out.props.children[0].props).toMatchObject({ top: 183, height: 257, split: false });
});
