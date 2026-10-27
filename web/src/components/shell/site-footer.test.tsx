import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LICENSE_NAME, LICENSE_URL, REPO_URL } from "@/lib/site";
import { SiteFooter } from "./site-footer";

/**
 * Peer is AGPL-3.0-only. A site running AGPL code must offer its users the
 * source (AGPL section 13), and the owners' agreement asks that every page
 * link to the repository and name the license. The footer is that offer, so
 * this test pins two things: what it says, and that the root layout mounts
 * it on every page — read as text, the way layout-icon.test.ts guards the
 * tab-icon <link>, because nothing else renders the root layout in a test.
 */

const html = renderToStaticMarkup(createElement(SiteFooter));

describe("the site footer — the AGPL source offer on every page", () => {
  it("links to the public source and the license, and names both owners", () => {
    expect(html).toContain(`href="${REPO_URL}"`);
    expect(html).toContain(`href="${LICENSE_URL}"`);
    expect(html).toContain(LICENSE_NAME);
    expect(html).toContain("Baichuan Wang and Xiaoyang Wang");
    expect(html).toContain('href="/privacy"');
  });

  it("is mounted by the root layout, before the thumb bar", () => {
    // Resolved from this file, like layout-icon.test.ts, so the test does not
    // depend on where vitest is invoked. lastIndexOf: the layout's comments
    // name both tags before the JSX that mounts them.
    const layout = readFileSync(fileURLToPath(new URL("../../app/layout.tsx", import.meta.url)), "utf8");
    const footer = layout.lastIndexOf("<SiteFooter />");
    const bar = layout.lastIndexOf("<ThumbBar />");
    expect(footer).toBeGreaterThan(-1);
    expect(bar).toBeGreaterThan(footer);
  });
});
