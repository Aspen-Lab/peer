import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

// P9-59 (A P9-W5 §5 N10, §7 item 1): a figure the deep report bound to a result is drawn under its section with
// the caption the figure engine found, and the engine's caption is a hard slice — `MAX_FIGURE_TEXT_CHARS = 500`,
// `.slice(0, 500)` — so a long caption reached the page as exactly 500 characters ending on a bare article, no stop
// and no mark (the keyed Summary's Figure 4: 500 characters at every width, the Reading's own 1,272 whole).
// `MattedFigure` printed it raw; the lead plate is protected by `leadCaption`. The rule here is the lead's with a
// room fit for a figure under a section: a caption is whole, or cut where a sentence ends, or visibly cut ("…") —
// never a slice that stops in the middle of a clause. The picture's alt and the lightbox read the same line.
//
// No DOM here (this project's Vitest runs in Node): the component runs on the minimal hook runtime and the tree it
// returns is read, as `matted-figure.test.tsx` (P9-57) does. The captions are invented.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import type { ReactElement, ReactNode } from "react";
import { leadCaption } from "@/components/cards/paper-plate";
import { hookRuntime } from "@/test-support/hook-runtime";
import { MarginFigure as FigureLightbox } from "./margin-figure";
import { MattedFigure } from "./matted-figure";

const SRC = "/api/papers/upload%3A0123456789abcdef/figure-image?page=2&fig=1";
/** The room: the figure engine's own cap (see the last describe), and what a figure under a section may carry. */
const ROOM = 500;

type Props = Record<string, unknown> & { children?: ReactNode };
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props>;
  return [element, ...elements(element.props.children)];
}
const lightboxOf = (tree: ReactNode) => elements(tree).find((el) => el.type === FigureLightbox);

/**
 * What one caption puts in front of a reader: the lines the figure sets under the picture (`lines`, one per
 * figcaption), the picture's alt, and the caption the lightbox is handed. With `fail`, the picture reports that it
 * could not load, once, as the browser would (P9-57).
 */
async function printed(caption: string | null | undefined, fail = false) {
  let reported = false;
  const page = () => {
    const tree = MattedFigure({ src: SRC, caption });
    if (fail && !reported) {
      reported = true;
      (lightboxOf(tree)?.props.onError as (() => void) | undefined)?.();
    }
    return tree;
  };
  const tree = (await hookRuntime.mount(page)).value;
  const box = lightboxOf(tree);
  return {
    tree,
    lines: elements(tree).filter((el) => el.type === "figcaption").map((el) => el.props.children),
    alt: box?.props.alt,
    lightbox: box?.props.caption,
  };
}
/** The one line under the picture. */
async function line(caption: string | null | undefined): Promise<string> {
  const { lines } = await printed(caption);
  expect(lines).toHaveLength(1);
  return lines[0] as string;
}

// ── Invented captions of an exact length ─────────────────────────────────────────────────────────────

const WORDS = [
  "soil", "water", "held", "beneath", "the", "thick", "layer", "across", "three", "orchards", "while",
  "bare", "plots", "dried", "faster", "than", "mulched", "rows", "after", "each", "irrigation",
];
/** `n` characters of running text with no stop in it: words, single spaces, no trailing space. */
function run(n: number, from = 0): string {
  let out = "";
  for (let i = from; out.length < n; i += 1) out += (out ? " " : "") + WORDS[i % WORDS.length];
  out = out.slice(0, n);
  return out.endsWith(" ") ? `${out.slice(0, -1)}x` : out;
}
/** One sentence of exactly `n` characters: a capital, running text, a stop. */
function sentence(n: number, from = 0): string {
  const body = run(n - 1, from);
  return `${body[0]!.toUpperCase()}${body.slice(1)}.`;
}
const capital = (text: string): string => `${text[0]!.toUpperCase()}${text.slice(1)}`;
/** What the figure engine hands the binder: the text, white space made single, cut hard at 500 characters. */
const engineSlice = (text: string): string => text.replace(/\s+/g, " ").trim().slice(0, ROOM);
/** The engine's slice of a text for the first starting word whose slice is 500 long and `fits`. */
function slicedWhere(make: (from: number) => string, fits: (slice: string) => boolean): string {
  const found = WORDS.map((_, from) => engineSlice(make(from))).find((slice) => slice.length === ROOM && fits(slice));
  if (!found) throw new Error("no starting word gives the slice this test needs");
  return found;
}

// The measured captions (the brief's four): a short one ending on a stop; the engine's slice, ending mid-clause;
// a 500-character run with no sentence end at all; a 2,000-character caption.
const LABEL = "Figure 4.";
const SHORT = `Figure 3. ${sentence(110)}`; // 120 characters, ends on a stop
const S1 = sentence(160);
const S2 = sentence(190, 5);
const S3 = sentence(130, 2);
const WHOLE = `${LABEL} ${S1} ${S2}`; // what the slices below are cut back to: 361 characters
// The slice of "label, two sentences, a third that runs on", in the two ways it can end: inside a word, or on the
// space after one (the engine normalizes, then slices, so its 500th character may be that space).
const SLICED = slicedWhere((from) => `${WHOLE} ${capital(run(400, from))}`, (s) => !s.endsWith(" "));
const SLICED_ON_A_SPACE = slicedWhere((from) => `${WHOLE} ${capital(run(400, from))}`, (s) => s.endsWith(" "));
// 500 characters with no sentence end at all (the label is not one), likewise.
const RUN_ON = slicedWhere((from) => `${LABEL} ${run(700, from)}`, (s) => !s.endsWith(" "));
const RUN_ON_ON_A_SPACE = slicedWhere((from) => `${LABEL} ${run(700, from)}`, (s) => s.endsWith(" "));
const LONG_HEAD = `${WHOLE} ${S3} ${sentence(300, 7)} ${sentence(400, 11)} ${sentence(500, 13)}`;
const LONG = `${LONG_HEAD} ${sentence(2000 - LONG_HEAD.length - 1, 1)}`; // 2,000 characters, ends on a stop

describe("the fixtures are the captions they say they are", () => {
  it("has the lengths and the endings of the brief's four", () => {
    expect(SHORT).toHaveLength(120);
    expect(SHORT).toMatch(/\.$/);
    expect(WHOLE).toHaveLength(361);
    expect(`${WHOLE} ${S3}`.length).toBeLessThanOrEqual(ROOM); // the third sentence would fit, were it whole
    for (const sliced of [SLICED, SLICED_ON_A_SPACE, RUN_ON, RUN_ON_ON_A_SPACE]) {
      expect(sliced).toHaveLength(ROOM);
      expect(sliced).not.toMatch(/[.!?…]\s*$/);
    }
    expect(SLICED.startsWith(WHOLE)).toBe(true);
    expect(RUN_ON.slice(LABEL.length)).not.toMatch(/[.!?]/);
    expect(LONG).toHaveLength(2000);
    expect(LONG).toMatch(/\.$/);
  });
});

describe("a caption that fits and ends on a stop is printed as it is (P9-59)", () => {
  it("prints the 120-character caption exactly as it was handed in", async () => {
    expect(await line(SHORT)).toBe(SHORT);
  });

  it("prints a 500-character caption that ends on a stop as it is, and one that ends on a stop and a closing mark", async () => {
    const whole = `${sentence(300)} ${sentence(ROOM - 301, 6)}`;
    expect(whole).toHaveLength(ROOM);
    expect(await line(whole)).toBe(whole);
    const closed = `${whole.slice(0, -2)}.”`;
    expect(closed).toHaveLength(ROOM);
    expect(await line(closed)).toBe(closed);
    const bracket = `${whole.slice(0, -2)}.)`;
    expect(bracket).toHaveLength(ROOM);
    expect(await line(bracket)).toBe(bracket);
  });

  it("makes its white space single, as the lead's caption does, and nothing else", async () => {
    expect(await line("Figure 1.  Soil water\n by depth.")).toBe("Figure 1. Soil water by depth.");
  });
});

describe("a caption that does not end on a stop but is shorter than the engine's cut is whole (P9-59)", () => {
  // The engine's slice is 500 characters. A shorter caption was never sliced: it ends where its author ended it,
  // and many captions end on no stop ("Figure 2: Overview of the sampling design"). Cutting those would be a
  // regression, not the fix.
  it("prints a label-style caption with no stop as it is", async () => {
    const label = "Figure 2: Overview of the sampling design at the three sites";
    expect(await line(label)).toBe(label);
  });

  it("prints a 499-character caption with no stop as it is, and cuts the same text at 500", async () => {
    const shorter = `${LABEL} ${run(ROOM - LABEL.length - 2, 4)}`;
    expect(shorter).toHaveLength(ROOM - 1);
    expect(await line(shorter)).toBe(shorter);
    expect(await line(`${shorter}e`)).not.toBe(`${shorter}e`);
  });

  it("leaves a caption that already says it is cut ('…') as it is, at 500", async () => {
    const cut = `${LABEL} ${run(ROOM - LABEL.length - 2, 4)}…`;
    expect(cut).toHaveLength(ROOM);
    expect(await line(cut)).toBe(cut);
  });
});

describe("the engine's slice is cut back to its last whole sentence (P9-59, N10)", () => {
  it("prints the label and the two whole sentences, ending on the second one's stop", async () => {
    // The slice is 500 characters and ends inside a third sentence; the head printed all 500.
    expect(await line(SLICED)).toBe(WHOLE);
  });

  it("does the same when the slice's last character is the space before the next word", async () => {
    expect(await line(SLICED_ON_A_SPACE)).toBe(WHOLE);
  });

  it("does not mark a sentence-end cut: the stop is the end, as it is under the lead plate", async () => {
    const out = await line(SLICED);
    expect(out).toMatch(/\.$/);
    expect(out).not.toContain("…");
  });
});

describe("a 500-character caption with no sentence end is cut at a word, with one '…' (P9-59, N10)", () => {
  it("ends in exactly one ellipsis, kept as a prefix of the caption cut at a word, with no stop or comma before it", async () => {
    const out = await line(RUN_ON);
    expect(out.endsWith("…")).toBe(true);
    expect(out.match(/…/g)).toHaveLength(1);
    const kept = out.slice(0, -1);
    expect(RUN_ON.startsWith(kept)).toBe(true);
    expect(RUN_ON[kept.length]).toBe(" "); // cut between words, not inside one
    expect(kept).not.toMatch(/[\s,;:.!?\-–—(\[]$/);
    expect(out.length).toBeLessThanOrEqual(ROOM);
    expect(kept.length).toBeGreaterThan(ROOM - 40); // it keeps nearly all of the room, not a stub
  });

  it("is not the bare label: 'Figure 4.' is a label, not a sentence", async () => {
    const out = await line(RUN_ON);
    expect(out).not.toBe(LABEL);
    expect(out.length).toBeGreaterThan(LABEL.length + 100);
  });

  it("does the same for a run with no label at all", async () => {
    const bare = run(ROOM, 8);
    expect(bare).toHaveLength(ROOM);
    const out = await line(bare);
    expect(out.endsWith("…")).toBe(true);
    expect(bare.startsWith(out.slice(0, -1))).toBe(true);
    expect(out.length).toBeLessThanOrEqual(ROOM);
  });

  it("keeps the last word of a slice that ended on a space: that word is whole, and the mark follows it", async () => {
    expect(await line(RUN_ON_ON_A_SPACE)).toBe(`${RUN_ON_ON_A_SPACE.trimEnd()}…`);
  });
});

describe("a caption longer than the room is cut the same way (P9-59)", () => {
  it("cuts the 2,000-character caption at the last sentence end that fits in 500", async () => {
    const out = await line(LONG);
    expect(out).toBe(`${WHOLE} ${S3}`);
    expect(out.length).toBeLessThanOrEqual(ROOM);
    expect(out).toMatch(/\.$/);
  });

  it("cuts a caption ending on a stop at 501 characters back to the first sentence, and keeps it whole at 500", async () => {
    const first = sentence(300);
    const over = `${first} ${sentence(ROOM - 300, 6)}`;
    expect(over).toHaveLength(ROOM + 1);
    expect(await line(over)).toBe(first);
    const exact = `${first} ${sentence(ROOM - 301, 6)}`;
    expect(exact).toHaveLength(ROOM);
    expect(await line(exact)).toBe(exact);
  });

  it("cuts a caption whose first sentence is longer than the room at a word, with one '…'", async () => {
    const one = `${sentence(700)} ${sentence(1200, 3)}`;
    const out = await line(one);
    expect(out.endsWith("…")).toBe(true);
    expect(out.match(/…/g)).toHaveLength(1);
    expect(out.length).toBeLessThanOrEqual(ROOM);
    expect(one.startsWith(out.slice(0, -1))).toBe(true);
    expect(one[out.length - 1]).toBe(" "); // the room's last character is the mark; the word before it is whole
  });
});

describe("a label, an abbreviation and an initial are not where a sentence ends (P9-59; the lead's rule)", () => {
  // A slice whose only stops are false ones: it is cut at a word, not on "Fig.", "et al." or "J. R.".
  const FALSE_STOPS = [
    "Figure 4. Soil water by depth, after J. R. Okafor et al. 2019 and Fig. 3 of Diaz, e.g. under the thick layer vs. bare plots",
    "Fig. 2. Soil water, approx. 40 percent, cf. Table 1 and Eq. 3 of Diaz et al. for the mulched rows",
  ];

  for (const head of FALSE_STOPS) {
    it(`cuts the slice that begins "${head.slice(0, 24)}" at a word, as the lead does at its own room`, async () => {
      const caption = `${head} ${run(ROOM)}`.slice(0, ROOM).replace(/ $/, "x");
      expect(caption).toHaveLength(ROOM);
      const out = await line(caption);
      expect(out.endsWith("…")).toBe(true);
      expect(out.length).toBeGreaterThan(ROOM - 40);
      // The rule is the lead's: the same caption under the lead plate is also a word cut, never one of these stops.
      const lead = leadCaption(caption) as string;
      expect(lead.endsWith("…")).toBe(true);
    });
  }

  it("takes the same real sentence end the lead takes, where both rooms hold it", async () => {
    const first =
      "Figure 4. Soil water after J. R. Okafor et al. and Fig. 3 of Diaz, e.g. under the thick layer, was measured at three depths.";
    expect(first.length).toBeLessThanOrEqual(140);
    const caption = `${first} ${sentence(600, 2)}`;
    expect(leadCaption(caption)).toBe(first);
    expect(await line(caption)).toBe(first);
  });
});

describe("P12-09: mat and alt retain caption cuts; margin viewer retains the complete caption", () => {
  const measured = { short: SHORT, sliced: SLICED, slicedOnASpace: SLICED_ON_A_SPACE, runOn: RUN_ON, long: LONG };
  for (const [name, caption] of Object.entries(measured)) {
    it(`keeps the mat/alt equal and the complete margin caption for ${name}`, async () => {
      const { lines, alt, lightbox } = await printed(caption);
      expect(lines).toHaveLength(1);
      expect(typeof lines[0]).toBe("string");
      expect(alt).toBe(lines[0]);
      expect(lightbox).toBe(caption);
    });
  }

  it("keeps the mat/alt cut and hands the whole caption to the margin viewer", async () => {
    for (const caption of [SLICED, RUN_ON, LONG]) {
      const { alt, lightbox } = await printed(caption);
      expect(alt).not.toBe(caption);
      expect(lightbox).toBe(caption);
    }
  });

  it("keeps P9-57's error path: the cut caption alone, once, with no alt and no picture", async () => {
    for (const caption of [SLICED, RUN_ON, LONG]) {
      const shown = await line(caption);
      expect(shown).not.toBe(caption);
      const { tree, lines } = await printed(caption, true);
      expect(lines).toEqual([shown]);
      expect(lightboxOf(tree)).toBeUndefined();
      expect(elements(tree).some((el) => "alt" in el.props || el.type === "img")).toBe(false);
    }
  });

  it("draws nothing at all for a failed picture whose caption is only white space (no empty figure)", async () => {
    expect((await printed("  \n ", true)).tree).toBeNull();
  });

  it("draws the picture with no figcaption and an empty alt for no caption, or only white space", async () => {
    for (const caption of [null, undefined, "", "  \n "]) {
      const { lines, alt } = await printed(caption);
      expect(lines).toHaveLength(0);
      expect(alt).toBe("");
    }
  });
});

describe("whatever the caption, what is printed is whole, cut at a stop, or marked (P9-59)", () => {
  // Captions of every length from just under the room to well over it, cut anywhere: what is printed is never
  // longer than the room, is the caption or a prefix of it (less its mark), is whole, ends on a stop, or ends on the
  // mark — never on a stop and the mark — and printing it again changes nothing.
  const base = [
    LABEL, sentence(130), sentence(90, 4), sentence(170, 8), sentence(60, 12), sentence(240, 2), sentence(300, 6),
    sentence(250, 9), sentence(400, 3), sentence(300, 5),
  ].join(" ");
  const lengths = [479, 480, 497, 498, 499, 500, 501, 502, 520, 640, 780, 1000, 1500, 1800];

  for (const n of lengths) {
    it(`handles a caption of ${n} characters`, async () => {
      expect(base.length).toBeGreaterThanOrEqual(1800);
      const caption = base.slice(0, n).trimEnd();
      const out = await line(caption);
      expect(out.length).toBeLessThanOrEqual(ROOM);
      const kept = out.endsWith("…") ? out.slice(0, -1) : out;
      expect(caption.startsWith(kept)).toBe(true);
      expect(out === caption || /[.!?]$/.test(out) || out.endsWith("…")).toBe(true);
      expect(out).not.toMatch(/[.!?,;:]…$/);
      expect(await line(out)).toBe(out);
    });
  }
});

describe("the room is the figure engine's own cap, named (P9-59)", () => {
  // `MAX_FIGURE_TEXT_CHARS` stays 500 (raising it needs a figure-request `v` bump, BACKLOG-60, and `isSameFigure`
  // compares captions exactly). The view's room is that cap: a caption that reaches it may be the engine's slice,
  // one below it never was. If the engine's cap ever moves, this test is where the view's room is found to need
  // moving with it.
  const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
  const numberAfter = (text: string, name: string) =>
    Number(new RegExp(`${name}\\s*=\\s*([\\d_]+)`).exec(text)?.[1]?.replace(/_/g, ""));

  it("names the room in matted-figure.tsx and makes it the engine's cap", () => {
    const engine = numberAfter(source("src/lib/figures/pdf-engine.ts"), "MAX_FIGURE_TEXT_CHARS");
    const view = numberAfter(source("src/components/reader/matted-figure.tsx"), "FIGURE_CAPTION_CHARS");
    expect(engine).toBe(ROOM);
    expect(view).toBe(engine);
  });
});
