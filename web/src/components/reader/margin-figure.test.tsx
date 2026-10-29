import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return { ...react, useRef: (current: unknown) => ({ current }), useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot() };
});
import { MarginFigure } from "./margin-figure";
import { closeFigure, getOpenFigure } from "@/lib/reader/figure-viewer";
import { forgetPictures, keptPicture } from "./figure-card";

afterEach(() => { closeFigure(); forgetPictures(); });
describe("P12-09 every visible image uses the body figure-open contract", () => {
  it("one left click opens an honest image reference with the whole caption and loaded pixels", () => {
    const caption = "Invented full caption. ".repeat(40);
    const tree = MarginFigure({ src: "/invented.png", alt: "Synthetic plot", caption });
    const img = { naturalWidth: 600, naturalHeight: 240, complete: true, getBoundingClientRect: () => ({ left: 12, top: 200, width: 300, height: 120 }) } as HTMLImageElement;
    tree.props.children.props.ref(img);
    tree.props.onClick();
    expect(getOpenFigure()).toEqual({ key: "image:/invented.png", src: "/invented.png", label: "Figure", caption, natural: { width: 600, height: 240 }, origin: { left: 12, top: 200, width: 300, height: 120 } });
    expect(keptPicture("/invented.png")).toBe(img);
  });
  it("does not invent a caption or binding when the image has only an address", () => {
    const tree = MarginFigure({ src: "/image-only.png", alt: "" });
    tree.props.onClick();
    expect(getOpenFigure()).toMatchObject({ src: "/image-only.png", caption: "", natural: null, origin: null });
    closeFigure();
    expect(getOpenFigure()).toBeNull();
  });
});
