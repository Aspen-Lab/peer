import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_VERSION } from "@/lib/version";
import { VersionLine } from "./version-line";

// P11-17a rule 1 (§1h.113 (b) O-1): twice the owner reported as current a defect main had already fixed, because their
// server was an old build and nothing on screen said which. The line names the commit the running build was made from:
// `Peer 0.45.0 · c550daa · What's new`. `next.config.ts` fixes the value (`env.PEER_BUILD_REF`, from `lib/build-ref.ts`)
// when it is evaluated, at `next build` or `next dev` start, so here the environment stands in for it.

const render = (props: Parameters<typeof VersionLine>[0] = {}) => renderToStaticMarkup(createElement(VersionLine, props));
/** What the line reads, the separators' margins aside. */
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;|&apos;/g, "'");

// The line as it was before P11-17a, byte for byte (rendered from 8d7ea474's `version-line.tsx`).
const TODAY = `<p class="text-meta text-text-faint ">Peer ${APP_VERSION}<span class="mx-1.5" aria-hidden="true">·</span><a class="hover:text-heading transition-colors " href="/changelog">What&#x27;s new</a></p>`;

describe("VersionLine — the build's commit (P11-17a rule 1)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("shows the commit between the version and What's new, as seven hex characters, with a title that says what it is", () => {
    vi.stubEnv("PEER_BUILD_REF", "c550daa");
    const html = render();

    expect(text(html)).toBe(`Peer ${APP_VERSION}·c550daa·What's new`);
    expect(html).toContain('title="Built from commit c550daa"');
    expect(html.match(/·/g)).toHaveLength(2);
  });

  it("with no commit is exactly the line it was: no placeholder, no extra dot", () => {
    vi.stubEnv("PEER_BUILD_REF", "");
    expect(render()).toBe(TODAY);
    expect(render({ className: "mt-10" })).toBe(TODAY.replace('class="text-meta text-text-faint "', 'class="text-meta text-text-faint mt-10"'));
  });

  it("with the variable unset is the same line", () => {
    vi.stubEnv("PEER_BUILD_REF", undefined);
    expect(render()).toBe(TODAY);
  });

  it("shows nothing that is not a seven-character commit, whatever the variable holds", () => {
    for (const value of ["c550da", "c550daa3", "C550DAA", "c550daz", "<b>c550daa</b>", "unknown", " c550daa"]) {
      vi.stubEnv("PEER_BUILD_REF", value);
      expect(render(), value).toBe(TODAY);
    }
  });
});
