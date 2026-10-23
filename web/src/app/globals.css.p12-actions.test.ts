import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
const luminance = (hex: string) => {
  const channels = hex.slice(1).match(/../g)!.map((c) => parseInt(c, 16) / 255)
    .map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};
const contrast = (a: string, b: string) => {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

describe("P12 shared orange action palette", () => {
  for (const selector of ["@theme", ":root", 'html[data-mode="dark"]', 'html[data-mode="system"]']) {
    it(`${selector} keeps white text AA and action edges/focus visible`, () => {
      const start = css.indexOf(`${selector} {`);
      const block = css.slice(start, css.indexOf("\n}", start));
      const token = (name: string) => {
        const match = block.match(new RegExp(`--color-action-${name}:\\s*(#[0-9a-f]{6});`));
        expect(match, `${selector}: ${name}`).not.toBeNull();
        return match![1];
      };
      const foreground = token("foreground");
      expect(foreground).toBe("#ffffff");
      for (const state of ["orange", "orange-hover"]) {
        expect(contrast(foreground, token(state))).toBeGreaterThanOrEqual(4.5);
      }
      const ground = selector.includes("html") ? "#232323" : "#fafafa";
      for (const edge of ["boundary", "focus"]) {
        expect(contrast(token(edge), ground)).toBeGreaterThanOrEqual(3);
      }
    });
  }
});

describe("P12 answers disclosure style", () => {
  const source = readFileSync(new URL("../components/reader/for-your-questions.tsx", import.meta.url), "utf8");
  it("uses the paper section title scale and shared action states without shrinking the label", () => {
    const button = source.slice(source.indexOf("<button"), source.indexOf("</button>"));
    for (const name of ["text-title", "bg-action-orange", "text-action-foreground", "border-action-boundary", "hover:bg-action-orange-hover", "focus-visible:outline-action-focus", "focus-visible:outline-2", "focus-visible:outline-offset-2", "max-w-full", "text-left"]) {
      expect(button).toContain(name);
    }
    expect(button).not.toContain("annotation");
    expect(button).toContain("shrink-0");
    expect(button).toContain("min-w-0");
    expect(button).not.toMatch(/whitespace-nowrap|truncate|line-clamp/);
    expect(css).toMatch(/\.reading-scaled \[class~="text-title"\]\s*\{\s*font-size:\s*calc\(var\(--text-title\)\s*\*\s*var\(--reading-scale,\s*1\)\);?\s*\}/);
  });
});
