import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReadingMap } from "@/lib/papers/reading-map";
import { MAP } from "./copy";
import { ReadingMapView } from "./reading-map";

// P1-04 (§1f.12; blueprint §3.2 ② 图): the map under the question field.
// No DOM in this project's Vitest: rendered with react-dom/server; the
// row and phone toggles start from props a test can set.

const map: ReadingMap = {
  sections: [
    {
      id: "s1", heading: "1 Introduction", canonical: "introduction", role: "setup", page: 1, words: 400, minutes: 3,
      paragraphs: [
        { index: 0, opening: "Creep limits the life of parts that run hot for years under load." },
        { index: 1, opening: null },
        { index: 2, opening: "Grain boundaries are where most of the creep strain is thought to happen." },
      ],
    },
    {
      id: "s2", heading: "2.1 Samples", canonical: "methods", role: "method", page: 2, words: 150, minutes: 1,
      paragraphs: [{ index: 0, opening: "Twelve samples with different grain sizes were cut from one cast ingot." }],
    },
    { id: "s3", heading: "Problem Statement", canonical: "body", role: "body", words: 90, minutes: 1, paragraphs: [{ index: 0, opening: null }] },
  ],
  totalMinutes: 4,
};

const render = (props: Partial<Parameters<typeof ReadingMapView>[0]> = {}) =>
  renderToStaticMarkup(createElement(ReadingMapView, { map, ...props }));

describe("ReadingMapView", () => {
  it("heads the table with the summary line", () => {
    const html = render();

    expect(MAP.summary(3, 4)).toBe("3 sections · about 4 min");
    expect(MAP.summary(1, 1)).toBe("1 section · about 1 min");
    expect(html).toContain(MAP.heading);
    expect(html).toContain(MAP.summary(3, 4));
    expect(html.indexOf(MAP.summary(3, 4))).toBeLessThan(html.indexOf("1 Introduction"));
  });

  it("lists every section: heading linked to its anchor, role tag, page and minutes, in order", () => {
    const html = render();

    expect(html).toContain('href="#paper-section-0"');
    expect(html).toContain('href="#paper-section-1"');
    expect(html).toContain('href="#paper-section-2"');
    const order = ["1 Introduction", "2.1 Samples", "Problem Statement"].map((heading) => html.indexOf(heading));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain(`>${MAP.roles.setup}<`);
    expect(html).toContain(`>${MAP.roles.method}<`);
    expect(html).toContain(MAP.page(1));
    expect(html).toContain(MAP.page(2));
    expect(html).toContain(MAP.minutes(3));
    // A subsection is indented by its depth, as the contents rail does.
    expect(html).toMatch(/padding-left:0\.75rem[^>]*>(?:(?!<li).)*2\.1 Samples/);
  });

  it("gives the unplaced section no role tag and a PDF-less section no page", () => {
    const html = render();
    const row = html.slice(html.indexOf("Problem Statement"));

    expect(Object.values(MAP.roles).some((label) => row.includes(`>${label}<`))).toBe(false);
    expect(row).not.toContain("p.");
  });

  it("keeps a row's paragraph lines folded until it is opened, then lists the openings, each linked to its paragraph", () => {
    const folded = render();
    expect(folded).not.toContain("Creep limits the life");
    expect(folded).toContain('aria-expanded="false"');

    const opened = render({ openRows: [0] });
    expect(opened).toContain('aria-expanded="true"');
    expect(opened).toContain('href="#paper-section-0-p0"');
    expect(opened).toContain("Creep limits the life of parts that run hot for years under load.");
    expect(opened).toContain('href="#paper-section-0-p2"');
    // A paragraph with no opening is not listed.
    expect(opened).not.toContain('href="#paper-section-0-p1"');
  });

  it("offers no fold control for a section without a single opening", () => {
    const html = render({ openRows: [2] });
    const row = html.slice(html.indexOf("Problem Statement") - 400, html.indexOf("Problem Statement"));

    // Two row toggles (the two sections with openings), none for this one.
    expect(html.match(/aria-label="(?:Show|Hide) how the paragraphs of [^"]*"/g)).toHaveLength(2);
    expect(html).not.toContain(MAP.openLines("Problem Statement"));
    expect(row).not.toContain("paper-section-2-p");
  });

  it("on a phone shows only the summary and 'show map', and expands in place", () => {
    const collapsed = render();
    expect(collapsed).toContain(MAP.show);
    // The table is hidden below 40rem and shown from it: CSS, no viewport hook.
    expect(collapsed).toMatch(/class="hidden sm:block"/);

    const expanded = render({ phoneOpen: true });
    expect(expanded).toContain(MAP.hide);
    expect(expanded).not.toMatch(/class="hidden sm:block"/);
  });

  it("renders nothing for a map with no sections", () => {
    expect(render({ map: { sections: [], totalMinutes: 0 } })).toBe("");
  });
});
