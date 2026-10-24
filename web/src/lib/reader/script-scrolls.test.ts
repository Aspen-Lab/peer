import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { followSectionLink } from "@/components/reader/evidence-quote";
import { goToPassage } from "@/components/notes/note-tags";

// P11-32 (BACKLOG-107; C P11-29's unsettled 6): a scroll the page makes by script respects `prefers-reduced-motion`. The stylesheet already does for the
// ones the browser makes (`html[data-scroll-behavior="smooth"]` stands inside `@media (prefers-reduced-motion: no-preference)`, `globals.css.focus-motion.test.ts`),
// but a `scrollIntoView({ behavior: "smooth" })` is the script asking for the animation by name and still animated under "reduce". Three scrolls did:
//   - the "§Heading" link, when the body is under the other tab (`followSectionLink`, `evidence-quote.tsx`);
//   - the notes' blue square and the strip's "go to the highlight" (`goToPassage`, `note-tags.tsx`: a block's top, or a page block's first mark, centred);
//   - "Read it here" (`scrollToBody`, in the reading page, which cannot be mounted in this Node-only suite, so its source is read).
// Each asks for "auto" (the stylesheet's rule: instant under "reduce") when the reader prefers reduced motion and "smooth" otherwise. Every text is invented.

/** A window that answers `matchMedia` for the reduced-motion query as the reader's setting says. */
function readerPrefers(reduce: boolean): void {
  vi.stubGlobal("window", {
    matchMedia: (query: string) => ({ matches: reduce && query.includes("prefers-reduced-motion: reduce") }),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("the '§Heading' link (followSectionLink)", () => {
  function follow(): Array<ScrollIntoViewOptions | undefined> {
    const scrolled: Array<ScrollIntoViewOptions | undefined> = [];
    const element = { scrollIntoView: (options?: ScrollIntoViewOptions) => scrolled.push(options) };
    let onPage = false;
    const jobs: Array<() => void> = [];
    followSectionLink({ preventDefault: () => {} }, "paper-section-1", (run) => jobs.push(run), () => (onPage ? element : null), () => {});
    onPage = true;
    jobs[0]();
    return scrolled;
  }

  it("scrolls at once when the reader prefers reduced motion", () => {
    readerPrefers(true);
    expect(follow()).toEqual([{ behavior: "auto", block: "start" }]);
  });

  it("scrolls smoothly otherwise", () => {
    readerPrefers(false);
    expect(follow()).toEqual([{ behavior: "smooth", block: "start" }]);
  });
});

describe("going to a passage (goToPassage)", () => {
  interface Box {
    scrollIntoView: ReturnType<typeof vi.fn>;
    classList: { add: (...c: string[]) => void; remove: (...c: string[]) => void };
    querySelectorAll: () => Box[];
  }
  function box(marks: Box[] = []): Box {
    return { scrollIntoView: vi.fn(), classList: { add: () => {}, remove: () => {} }, querySelectorAll: () => marks };
  }
  const go = (target: Box, anchor: Parameters<typeof goToPassage>[0]) =>
    goToPassage(anchor, { doc: { getElementById: () => target } as unknown as Document, navigate: () => {} });
  const highlight = (paragraphId: string) => ({ paperId: "p1", paragraphId, highlightId: "h1" });
  const sticky = { paperId: "p1", paragraphId: "paper-section-1-p2", quote: "deeper layers held water", n: 1, start: 10, end: 34 };

  for (const [reduce, behavior] of [
    [true, "auto"],
    [false, "smooth"],
  ] as const) {
    describe(reduce ? "a reader who prefers reduced motion" : "a reader with no such preference", () => {
      it(`scrolls a page block's first mark, centred, ${reduce ? "at once" : "smoothly"}`, () => {
        readerPrefers(reduce);
        const mark = box();
        const block = box([mark]);
        go(block, highlight("answers-block"));
        expect(mark.scrollIntoView).toHaveBeenCalledWith({ behavior, block: "center" });
        expect(block.scrollIntoView).not.toHaveBeenCalled();
      });

      it(`scrolls a block's top, ${reduce ? "at once" : "smoothly"}, for a highlight with no mark drawn`, () => {
        readerPrefers(reduce);
        const block = box();
        go(block, highlight("summary-method"));
        expect(block.scrollIntoView).toHaveBeenCalledWith({ behavior, block: "start" });
      });

      it(`scrolls a paragraph's top, ${reduce ? "at once" : "smoothly"}, for a highlight of the body and for a sticky`, () => {
        readerPrefers(reduce);
        const paragraph = box([box()]);
        go(paragraph, highlight("paper-section-1-p2"));
        go(paragraph, sticky);
        expect(paragraph.scrollIntoView).toHaveBeenCalledTimes(2);
        expect(paragraph.scrollIntoView).toHaveBeenNthCalledWith(1, { behavior, block: "start" });
        expect(paragraph.scrollIntoView).toHaveBeenNthCalledWith(2, { behavior, block: "start" });
      });
    });
  }
});

// ── "Read it here", and the rule that holds the rest ───────────────────────

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const squash = (text: string) => text.replace(/\s+/g, " ");

/** Every source file under `src` that is not a test, as `[path, text]`. */
function sources(dir = resolve(process.cwd(), "src")): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(path));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push([path, readFileSync(path, "utf8")]);
  }
  return out;
}

describe("'Read it here' (scrollToBody, in the reading page)", () => {
  const page = squash(read("src/app/papers/[id]/page.tsx"));
  const start = page.indexOf("const scrollToBody = useCallback(");
  const body = start < 0 ? "" : page.slice(start, page.indexOf("}, []);", start));

  it("asks for the scroll's behavior from the reader's setting, not by name", () => {
    expect(body).toContain('block.scrollIntoView({ behavior: scrollBehavior(), block: "start" })');
    expect(body).not.toMatch(/behavior:\s*["']smooth["']/);
    expect(page).toContain('import { scrollBehavior } from "@/lib/reader/scroll-motion";');
  });
});

describe("no script scroll asks for the animation by name", () => {
  it("leaves 'behavior: \"smooth\"' to the one helper that reads the setting (`lib/reader/scroll-motion.ts`)", () => {
    const named = sources()
      .filter(([path, text]) => !path.endsWith("/lib/reader/scroll-motion.ts") && /behavior:\s*["']smooth["']/.test(text))
      .map(([path]) => path.slice(resolve(process.cwd(), "src").length + 1));
    expect(named).toEqual([]);
  });

  it("uses the helper in each of the three files that scroll by script", () => {
    for (const path of ["src/components/reader/evidence-quote.tsx", "src/components/notes/note-tags.tsx", "src/app/papers/[id]/page.tsx"]) {
      expect(read(path), path).toContain('from "@/lib/reader/scroll-motion"');
      expect(read(path), path).toContain("scrollBehavior()");
    }
  });
});
