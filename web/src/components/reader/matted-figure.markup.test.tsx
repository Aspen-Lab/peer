import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MattedFigure } from "./matted-figure";

// P9-57, rule 3 ("nothing else"): a bound figure whose picture loads is drawn as it was. The first paint of a
// `MattedFigure` — what the server and the first client render give before any picture has been tried — is the
// mat, the lightbox button, the picture with the caption as its alt, and the figcaption. These are the exact
// strings the head renders; a change to what a loading figure draws fails here.
const SRC = "/api/papers/upload%3A0123456789abcdef/figure-image?page=2&fig=1";
const CAPTION = "Figure 1. Soil water against layer depth, three orchards.";
const render = (caption?: string | null) => renderToStaticMarkup(createElement(MattedFigure, { src: SRC, caption }));

describe("a bound figure's first paint is what it was (P9-57, rule 3)", () => {
  it("with a caption: the mat, the picture with the caption as its alt, the caption under it", () => {
    expect(render(CAPTION)).toBe(
      '<figure class="cropmarks [--cm-inset:6px] [--cm-c:var(--plate-ink-faint)] bg-[var(--plate-mat)] p-4 mt-4"><button type="button" aria-label="Enlarge figure" class="cursor-zoom-in block"><img src="/api/papers/upload%3A0123456789abcdef/figure-image?page=2&amp;fig=1" alt="Figure 1. Soil water against layer depth, three orchards." loading="lazy" decoding="async" referrerPolicy="no-referrer" class="mx-auto max-h-[260px] sm:max-h-[360px] object-contain"/></button><figcaption class="font-reading text-body-sm text-text-muted mt-3">Figure 1. Soil water against layer depth, three orchards.</figcaption></figure>',
    );
  });

  it("without a caption: the mat and the picture with an empty alt, no figcaption", () => {
    expect(render(null)).toBe(
      '<figure class="cropmarks [--cm-inset:6px] [--cm-c:var(--plate-ink-faint)] bg-[var(--plate-mat)] p-4 mt-4"><button type="button" aria-label="Enlarge figure" class="cursor-zoom-in block"><img src="/api/papers/upload%3A0123456789abcdef/figure-image?page=2&amp;fig=1" alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" class="mx-auto max-h-[260px] sm:max-h-[360px] object-contain"/></button></figure>',
    );
  });
});
