import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { pageContainer } from "./page-container";

// P11-10 rule 3 (B P11-01 §4 C2; ruling §1h.113 (a)): the paper page's container has a `reader` width — full-bleed from 1024 css px, where
// the three-pane shell takes the window — and the `spread` width stays for the loading and error states.

const tokens = (options: Parameters<typeof pageContainer>[0]) => pageContainer(options).split(/\s+/);

describe("pageContainer — the reader width", () => {
  // P12-07/204: the responsive reader owns its column inset; no fixed 1024px container gate.
  it("gives the measured shell the full width; the narrow layout owns its inset", () => {
    const classes = tokens({ width: "reader", rhythm: "reader" });
    expect(classes).toContain("max-w-none");
    expect(classes).toContain("[&]:px-0");
    expect(classes).not.toContain("max-w-[760px]");
  });

  it("keeps the article's top at 16px while the measured shell stands", () => {
    expect(tokens({ width: "reader", rhythm: "reader" })).toContain("has-[.reader-shell]:pt-4");
    // The same rhythm on the spread width is unchanged: the loading and error states keep their xl top.
    expect(tokens({ width: "spread", rhythm: "reader" })).not.toContain("lg:pt-4");
    expect(tokens({ width: "spread", rhythm: "reader" })).toContain("xl:pt-4");
  });

  it("does not cap the width by the A / A step: the retired calc pair is not in it", () => {
    expect(pageContainer({ width: "reader", rhythm: "reader" })).not.toContain("--reading-scale");
  });

  it("leaves the spread width as it was: the 760 column, the xl and 2xl calc pair", () => {
    const classes = tokens({ width: "spread", rhythm: "reader" });
    expect(classes).toContain("max-w-[760px]");
    expect(classes).toContain("xl:max-w-[calc(1072px*var(--reading-scale,1))]");
    expect(classes).toContain("2xl:max-w-[calc(504px+680px*var(--reading-scale,1))]");
    expect(classes).not.toContain("lg:max-w-none");
  });
});

describe("the paper page uses it", () => {
  const page = readFileSync(resolve(process.cwd(), "src/app/papers/[id]/page.tsx"), "utf8");

  it("mounts the paper's article with width=\"reader\", and the other five containers (loading, error, empty states) keep the spread", () => {
    expect(page.match(/<PageContainer\s+width="reader"/g)).toHaveLength(1);
    expect(page.match(/<PageContainer\s+width="spread"/g)).toHaveLength(5);
    const at = page.indexOf('width="reader"');
    expect(page.slice(at, at + 200)).toContain('rhythm="reader"');
    expect(page.slice(at, at + 400)).toContain("data-zoom-root");
  });
});
