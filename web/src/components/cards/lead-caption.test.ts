import { describe, expect, it } from "vitest";
import { isAbstractBlock, LEAD_CAPTION_CHARS, leadCaption } from "./paper-plate";

// P9-49 (N8, round 3's walk): the lead picture's caption is a sentence or nothing.
//
// The head cut every caption to 140 characters and wrote an ellipsis after the cut — so a caption whose cut
// fell after a full stop read "…films.…", and, under the spread's `line-clamp: 2`, a no-key page showed the
// paper's page-1 graphic with the abstract's own block ("ABSTRACT: …") for a caption, stopped mid-sentence.
//
//   * An abstract block (it starts with "Abstract", in any case, or it is the reading's abstract) is never the
//     picture's caption: the plate then has no caption (the feed's tile has none either; its title is the line
//     under it).
//   * A caption longer than the room is cut at a sentence end — no ellipsis, the stop is the end. If one sentence
//     is itself longer than the room, at a word, with one ellipsis and no stop or comma in front of it.
//   * A leading "Figure 4." is a label, not a sentence; "Fig.", "et al.", "e.g." and an initial do not end one.

/** The room under the plate: the head's `CAPTION_CHARS`, 140. */
const ROOM = LEAD_CAPTION_CHARS;

/** What the engine paired with an invented paper's page-1 graphic: the abstract block beside it. */
const ABSTRACT_BLOCK =
  "ABSTRACT: Terraced orchards lose water to storms and to dry spells. We laid dried seaweed in a thick layer, a thin layer or not at all between the trees of one terrace and logged soil water at three depths for two seasons.";

describe("an abstract block is never the lead picture's caption (rule 2)", () => {
  it.each([
    ["the engine's own block", ABSTRACT_BLOCK],
    ["lower case", "abstract: We study how seaweed keeps soil wet over two dry seasons in one orchard."],
    ["a full stop after the word", "Abstract. We study how seaweed keeps soil wet over two dry seasons in one orchard."],
    ["a dash after the word", "Abstract — We study how seaweed keeps soil wet over two dry seasons in one orchard."],
    ["no mark after the word", "ABSTRACT We study how seaweed keeps soil wet over two dry seasons in one orchard"],
    ["leading white space and a line break", "  \n Abstract\nWe study how seaweed keeps soil wet over two dry seasons."],
    ["the word alone", "Abstract"],
  ])("%s", (_name, block) => {
    expect(isAbstractBlock(block)).toBe(true);
    expect(leadCaption(block)).toBeNull();
  });

  it("is also true of a block that is the reading's abstract without the word (a banner above it, the abstract's own text)", () => {
    const abstract =
      "Terraced orchards lose water to storms and to dry spells. We laid dried seaweed in a thick layer, a thin layer or not at all between the trees of one terrace. The thick layer kept the most soil water.";
    const block = "Terraced  orchards lose water to storms and to dry spells. We laid dried seaweed in a thick layer, a thin layer or not at all between the trees of one terrace.";
    expect(isAbstractBlock(block, abstract)).toBe(true);
    expect(leadCaption(block, abstract)).toBeNull();
    // a block that carries the abstract's first words but is cut mid-way, in another case
    expect(leadCaption(block.toUpperCase().slice(0, 120), abstract)).toBeNull();
  });

  it("does not take a caption for an abstract: a word that only begins the same, a real caption beside the abstract", () => {
    const abstract = "Terraced orchards lose water to storms and to dry spells. We laid dried seaweed in a thick layer.";
    expect(isAbstractBlock("Abstractions of the terrace profile, drawn from the probe logs.")).toBe(false);
    expect(isAbstractBlock("Figure 1. Soil water by depth under a thick layer, a thin layer and bare soil.", abstract)).toBe(false);
    expect(leadCaption("Figure 1. Soil water by depth under a thick layer, a thin layer and bare soil.", abstract)).toBe(
      "Figure 1. Soil water by depth under a thick layer, a thin layer and bare soil.",
    );
  });

  it("is false for nothing, and a missing caption stays a missing caption", () => {
    expect(isAbstractBlock(null)).toBe(false);
    expect(isAbstractBlock("")).toBe(false);
    expect(leadCaption(null)).toBeNull();
    expect(leadCaption(undefined)).toBeNull();
    expect(leadCaption("   \n ")).toBeNull();
  });
});

describe("a caption is whole, or cut only where a sentence ends (rule 2)", () => {
  it("keeps the room the head had (140 characters under the plate)", () => {
    expect(ROOM).toBe(140);
  });

  it("leaves a caption that fits as it is (white space made single)", () => {
    expect(leadCaption("Figure 1. Soil water by depth.")).toBe("Figure 1. Soil water by depth.");
    expect(leadCaption("Figure 1.  Soil water\n by depth.")).toBe("Figure 1. Soil water by depth.");
    const exact = `Figure 1. ${"x".repeat(ROOM - 10)}`;
    expect(exact).toHaveLength(ROOM);
    expect(leadCaption(exact)).toBe(exact);
  });

  it("cuts a long caption at the last sentence end that fits, with no ellipsis (the stop is the end)", () => {
    const s1 = "Figure 1. Soil water by depth under a thick layer, a thin layer and bare soil."; // 78
    const s2 = "The bars show the median of four plots."; // 40
    const s3 = "Error bars show the full range between plots over both of the seasons."; // 70
    const out = leadCaption(`${s1} ${s2} ${s3}`);
    expect(out).toBe(`${s1} ${s2}`);
    expect(out).not.toContain("…");
    expect((out as string).length).toBeLessThanOrEqual(ROOM);
  });

  it("cuts the keyed example of the walk at its full stop, not at 'films.' plus an ellipsis", () => {
    const first = "Figure 2. Transmission electron micrographs of the as-deposited and the annealed thin films."; // 92
    const text = `${first} (b) The same films after thirty cycles of heating and cooling in air, with the scale bars as marked.`;
    expect(text.length).toBeGreaterThan(ROOM);
    const out = leadCaption(text) as string;
    expect(out).toBe(first);
    expect(out).not.toMatch(/[.!?]…/);
    expect(out).not.toContain("…");
  });

  it("does not take the label for a sentence: 'Figure 4.' is followed by what it labels", () => {
    const text =
      "Figure 4. A profile of the soil under the thick layer of seaweed at the middle depth of the terrace, drawn from the probe logs of the second season and showing the cracks that opened as the layer dried out over the long summer dry spell.";
    const out = leadCaption(text) as string;
    expect(out).not.toBe("Figure 4.");
    expect(out.startsWith("Figure 4. A profile of the soil")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
    for (const label of ["Fig. 2. A short sentence of the caption that goes on for a while longer than the first label does, ending here. And one more sentence after it so the whole is long.", "Figure 3a. Another sentence that is long enough to need a cut after the label and well before its own end, since it keeps going on and on."]) {
      expect(leadCaption(label)).not.toMatch(/^Fig(ure)?\.? \d+[a-z]?\.$/);
    }
  });

  it("cuts a single over-long sentence at a word, with one ellipsis and no stop or comma in front of it", () => {
    const text =
      "Figure 4. A profile of the soil under the thick layer of seaweed at the middle depth of the terrace, drawn from the probe logs of the second season and showing the cracks that opened as the layer dried out over the long summer dry spell.";
    const out = leadCaption(text) as string;
    expect(out.length).toBeLessThanOrEqual(ROOM);
    expect(out.match(/…/g)).toHaveLength(1);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/[.,;:!?\-–—(\[]\s*…$/);
    const body = out.slice(0, -1);
    expect(text.startsWith(body)).toBe(true);
    // a whole word, not a piece of one: the next character of the caption is a space
    expect(text[body.length]).toBe(" ");
  });

  it("does not end a sentence at 'et al.', 'e.g.' or an initial, even when a capital or a digit follows", () => {
    const etAl =
      "Figure 3. The effect of the thick layer on the water holding index of the soil over two seasons of storms and dry spells (Smith et al. 2024; Lee et al. 2025). Bars show medians.";
    expect(etAl.indexOf(". Bars")).toBeGreaterThan(ROOM); // the first real sentence end is beyond the room
    const outEtAl = leadCaption(etAl) as string;
    expect(outEtAl.endsWith("…")).toBe(true);
    expect(outEtAl).not.toMatch(/et al\.$/);
    expect(outEtAl.match(/…/g)).toHaveLength(1);

    const initial =
      "Figure 5. Plots laid out by J. R. Okafor and the crew in a fixed order that repeated four times across the whole of the terrace, as drawn here. A second sentence.";
    expect(initial.indexOf(". A second")).toBeGreaterThan(ROOM);
    const outInitial = leadCaption(initial) as string;
    expect(outInitial).not.toMatch(/\b[A-Z]\.$/);
    expect(outInitial.endsWith("…")).toBe(true);

    const eg =
      "Figure 6. Three layers of mulch on the terrace of the Hill Orchard, e.g. Plot 4 and Plot 7, set out in a fixed order and logged for two whole seasons, as in the scheme. Ends here.";
    expect(eg.indexOf(". Ends")).toBeGreaterThan(ROOM);
    const outEg = leadCaption(eg) as string;
    expect(outEg).not.toMatch(/e\.g\.$/);
    expect(outEg.endsWith("…")).toBe(true);
    expect(outEg.length).toBeLessThanOrEqual(ROOM);
  });

  it("does not end a sentence inside a number", () => {
    const text = "Figure 7. The water holding index was 0.62 under the thick layer and 0.38 on bare soil. It fell further by the eighth dry day, to 0.31 and 0.12 respectively over all of the plots.";
    expect(leadCaption(text)).toBe("Figure 7. The water holding index was 0.62 under the thick layer and 0.38 on bare soil.");
  });

  it("never writes a stop in front of an ellipsis, never two ellipses, never more than the room — over many captions", () => {
    const parts = [
      "Figure 1. Soil water by depth under a thick layer, a thin layer and bare soil.",
      "Bars show the median of four plots (e.g. the thick plots at the middle depth).",
      "Error bars: the full range between plots, as in Smith et al. (2024).",
      "(b) The same films after thirty cycles of heating and cooling in air.",
      "A very long sentence that keeps going without a stop for a good while, naming the layers, the depths, the seasons, the storms, the probes and the plots of the one terrace that was logged for two whole years in a row",
      "Scale bar, 50 µm.",
      "Panels a–d show the thick layer; panels e–h the thin one.",
    ];
    let checked = 0;
    for (let start = 0; start < parts.length; start++) {
      for (let count = 1; count <= parts.length; count++) {
        const text = Array.from({ length: count }, (_, i) => parts[(start + i) % parts.length]).join(" ");
        const out = leadCaption(text);
        expect(out, text).not.toBeNull();
        const value = out as string;
        expect(value.length, text).toBeLessThanOrEqual(ROOM);
        expect(value, text).not.toMatch(/[.!?:;,]\s*…/);
        expect((value.match(/…/g) ?? []).length, text).toBeLessThanOrEqual(1);
        if (!value.endsWith("…")) expect(text.replace(/\s+/g, " ").startsWith(value), text).toBe(true);
        checked += 1;
      }
    }
    expect(checked).toBe(parts.length * parts.length);
  });
});
