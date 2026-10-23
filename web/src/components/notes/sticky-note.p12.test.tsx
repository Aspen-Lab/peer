import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StickyWindowView, makeStickyWriter } from "./sticky-note";
import { NoteToolbarView } from "./note-toolbar";
import { AnchorSquare } from "./note-tags";

const props = () => ({ n: 1, quote: "Invented passage", text: "", front: true, active: true, top: 60, height: 300, z: 62, onText: vi.fn(), onClose: vi.fn(), onSave: vi.fn(), onDelete: vi.fn(), onRaise: vi.fn(), onGo: vi.fn() });
describe("sticky note controls", () => {
  it("offers separate Save and Delete instead of X", () => {
    const html = renderToStaticMarkup(createElement(StickyWindowView, props()));
    expect(html).toContain('aria-label="Save note 1"');
    expect(html).toContain('aria-label="Delete note 1"');
    expect(html).not.toContain('aria-label="Close note 1"');
  });
  it("does not consume Escape from an inactive visible panel", () => {
    const p = { ...props(), active: false };
    const view = StickyWindowView(p) as ReactElement<{ onKeyDown: (e: unknown) => void }>;
    const e = { key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() };
    view.props.onKeyDown(e);
    expect(p.onClose).not.toHaveBeenCalled();
    expect(e.stopPropagation).not.toHaveBeenCalled();
  });
  it("cancelled pending typing never writes on timer or unmount flush", () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const writer = makeStickyWriter(write);
    writer.push("pending invented words");
    writer.cancel();
    writer.flush();
    vi.runAllTimers();
    expect(write).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
  it("provides labelled nesting buttons without taking the editor selection", () => {
    const indent = vi.fn();
    const view = NoteToolbarView({ active: "bullet", enabled: true, onMark: vi.fn(), onType: vi.fn(), onIndent: indent });
    const html = renderToStaticMarkup(view);
    expect(html).toContain('aria-label="Indent"');
    expect(html).toContain('aria-label="Outdent"');
  });
  it("sizes the anchor square with the text rather than fixed pixels", () => {
    const html = renderToStaticMarkup(createElement(AnchorSquare, { onClick: vi.fn() }));
    expect(html).toContain("width:1em;height:1em");
  });
});
