import { Children, createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CareerStagePicker, DirectionPicker, RadarPicker } from "./welcome-inputs";

describe("career stage picker", () => {
  it("shows all six selectable years and marks the stored PhD year", () => {
    const html = renderToStaticMarkup(createElement(CareerStagePicker, { value: "PhD Year 6", onChange: () => {} }));
    for (let year = 1; year <= 6; year++) expect(html).toContain(`aria-label="PhD Year ${year}"`);
    expect(html).toMatch(/aria-label="PhD Year 6" aria-pressed="true"/);
  });

  it("offers undergraduate and master's students their own selected stages", () => {
    for (const value of ["Undergraduate", "Master's student"] as const) {
      const html = renderToStaticMarkup(createElement(CareerStagePicker, { value, onChange: () => {} }));
      const selected = html.match(/<button[^>]*aria-pressed="true"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
      expect(selected).toContain(value.replace("'", "&#x27;"));
      expect(html).not.toContain('aria-label="PhD year"');
    }
  });

  it("does not show a PhD year for a postdoc or scientist", () => {
    for (const value of ["Postdoc", "Research Scientist"] as const) {
      const html = renderToStaticMarkup(createElement(CareerStagePicker, { value, onChange: () => {} }));
      expect(html).not.toContain('aria-label="PhD year"');
      expect(html).toContain('aria-pressed="true"');
    }
  });
});

describe("direction and radar pickers", () => {
  it("keeps the stored direction values when a card is selected", () => {
    const change = vi.fn();
    const tree = DirectionPicker({ value: "both", onChange: change });
    const cards = Children.toArray(tree.props.children) as ReactElement<{ onClick: () => void; "aria-pressed": boolean }>[];
    expect(cards).toHaveLength(5);
    expect(cards.filter((card) => card.props["aria-pressed"])).toHaveLength(1);
    cards[4].props.onClick();
    expect(change).toHaveBeenCalledWith("bigTech");
  });

  it("marks the active radar choice and keeps its explanation available", () => {
    const html = renderToStaticMarkup(createElement(RadarPicker, { label: "Focus", kind: "focus", value: "tight", options: [{ value: "tight", label: "Tight", help: "Stay close to my project." }, { value: "balanced", label: "Balanced" }], onChange: () => {} }));
    expect(html).toContain('aria-label="Focus"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Stay close to my project.");
  });
});
