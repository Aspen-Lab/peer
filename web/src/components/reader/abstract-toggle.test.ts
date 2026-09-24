import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AbstractToggle } from "./abstract-toggle";

// 8-03/S25: collapsed by default, every open — asserting the closed/default
// render only, matching this repo's own ceiling for this class of UI (see
// 6-08's precedent, named in the fix guide).
describe("AbstractToggle", () => {
  it("renders closed by default: aria-expanded false, panel absent from the DOM", () => {
    const html = renderToStaticMarkup(
      createElement(AbstractToggle, null, createElement("p", null, "hidden abstract text")),
    );

    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('id="abstract-panel"');
    expect(html).not.toContain("hidden abstract text");
    expect(html).toContain("Abstract");
  });
});
