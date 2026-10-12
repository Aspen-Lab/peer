import { describe, expect, it } from "vitest";
import { extractPdfTextFromBytes } from "@/lib/papers/pdf-text";
import { minimalPdf, prose } from "@/lib/papers/minimal-pdf.test-helper";
import { cleanDisplayText, cleanPaperText } from "./clean";

describe("cleanDisplayText", () => {
  it("2-03: folds the stray fraction-slash artifact (U+2044) out of a PDF-extracted caption", () => {
    // PyMuPDF reorders a stacked inline fraction like "L/d" into
    // letters-then-fraction-slash ("Ld" + U+2044) when lifting text from a
    // PDF's glyph layout (1-17). This is the display-side counterpart to
    // evidence.ts's matching-only fold: a figure caption or body sentence
    // carrying the raw artifact should render without the stray glyph.
    expect(cleanDisplayText("Ld ⁄ = 0.44")).toBe("Ld = 0.44");
  });

  it("2-03: never touches an ordinary ASCII slash", () => {
    // Unlike the matching-only fold in evidence.ts, a display fold must
    // never strip the real "/" character — it is load-bearing text
    // everywhere cleanDisplayText runs (titles, abstracts, captions).
    expect(cleanDisplayText("km/h")).toBe("km/h");
    expect(cleanDisplayText("2024/01/15")).toBe("2024/01/15");
    expect(cleanDisplayText("and/or")).toBe("and/or");
  });
});

// P9-10, cluster D (B P9-02 §2, Appendix B D1-D4): display text carries the
// paper's own symbols. The ASCII alphabet is the evidence matcher's, not the
// reader's (evidence.ts `normalizeForMatch` folds them there).
describe("cleanDisplayText — the paper's symbols stay symbols (P9-10, D)", () => {
  it("D1: keeps ° × ± ≤ ≥ in display text", () => {
    const s = "grown at T = 275 °C with a 0° tilt, (3 ± 0.2) × 10 cm, 0 ≤ φ ≤ 360°, a ≥ b";
    expect(cleanDisplayText(s)).toBe(s);
  });

  it("D2: keeps the symbol an HTML entity or a LaTeX macro names", () => {
    expect(cleanDisplayText("275 &deg;C, 5 &times; 10, &plusmn;0.2, &le; 3, &ge; 2")).toBe(
      "275 °C, 5 × 10, ±0.2, ≤ 3, ≥ 2",
    );
    expect(cleanDisplayText("$5 \\times 10$ and $\\pm 0.2$")).toBe("5 × 10 and ± 0.2");
  });

  it("D2b: keeps the symbol a mojibake repair recovers", () => {
    // UTF-8 "°" and "±" read as Latin-1 arrive as "Â°" and "Â±".
    expect(cleanDisplayText("275 \u00C2\u00B0C and 3 \u00C2\u00B1 0.2")).toBe("275 \u00B0C and 3 \u00B1 0.2");
  });

  it("D3: still folds a micro sign to the Greek letter and leaves Σ, Å, ∼ and ≫ alone (guard)", () => {
    // U+00B5 MICRO SIGN becomes U+03BC GREEK SMALL LETTER MU (rule 3 took NFKC
    // away, which used to do it; the cleaner now names the map itself).
    expect(cleanDisplayText("4 \u00B5m, Σ3, 5 Å, ∼1 \u03BCm, 110 ≫ 101")).toBe(
      "4 \u03BCm, Σ3, 5 Å, ∼1 \u03BCm, 110 ≫ 101",
    );
  });

  it("D3b: the &micro; entity is the Greek letter too, not the word", () => {
    expect(cleanDisplayText("4 &micro;m")).toBe("4 \u03BCm");
  });

  it("D4: end to end, a PDF's text layer reads with its symbols", async () => {
    const bytes = minimalPdf([
      [
        ["A Paper About Cathodes", 72, 90, 18],
        ["1 Introduction", 72, 130, 12, true],
        ...prose(
          [
            "The films were grown at 275 °C with a gap of 0.5 mm ± 0.1 mm over five cells.",
            "Each cell held 5 × 10 pellets and the tilt was 0° for every run of the sweep.",
            "Nothing else in the furnace schedule changed between the first and the last run.",
          ],
          150,
        ),
      ],
    ]);
    const result = await extractPdfTextFromBytes(bytes);
    const text = (result.doc?.sections ?? []).map((s) => s.text).join(" ");
    expect(text).toContain("275 °C");
    expect(text).toContain("0.5 mm ± 0.1 mm");
    expect(text).toContain("5 × 10 pellets");
    expect(text).toContain("0° for every run");
    expect(text).not.toMatch(/degrees|\+\/-/);
  });
});

// P9-10, cluster G's gate (B P9-01 §5, B P9-02 §5 item 2): the PDF line builder
// writes exponents and charges as Unicode super- and subscripts; the cleaner
// used to flatten them with NFKC and now normalizes with NFC plus a named map.
// Characters that look alike are spelled by code point.
describe("cleanDisplayText — scripts, ligatures, spaces and ½ (P9-10, G's gate)", () => {
  it("keeps Unicode super- and subscripts", () => {
    expect(cleanDisplayText("7 mA/cm² (Figure")).toBe("7 mA/cm² (Figure");
    expect(cleanDisplayText("10⁻¹³ cm²/s")).toBe("10⁻¹³ cm²/s");
    expect(cleanDisplayText("Co(OH)₆⁴⁻")).toBe("Co(OH)₆⁴⁻");
    expect(cleanDisplayText("H₂O")).toBe("H₂O");
    expect(cleanDisplayText("s⁻¹ and a 2⁺ charge, x⁽ⁿ⁾, y₍ₘ₎, z⁼")).toBe("s⁻¹ and a 2⁺ charge, x⁽ⁿ⁾, y₍ₘ₎, z⁼");
  });

  it("keeps ½ (and the other vulgar fractions): no 12", () => {
    expect(cleanDisplayText("½")).toBe("½");
    expect(cleanDisplayText("a ½ cup and ¾ of it")).toBe("a ½ cup and ¾ of it");
  });

  it("keeps the fraction-slash guard: a stray U+2044 token is still removed", () => {
    expect(cleanDisplayText("Ld \u2044 = 0.44")).toBe("Ld = 0.44");
    expect(cleanDisplayText("1\u20442")).toBe("12");
  });

  it("writes the ligatures as letters", () => {
    expect(cleanDisplayText("\uFB01lm")).toBe("film");
    expect(cleanDisplayText("\uFB00 \uFB01 \uFB02 \uFB03 \uFB04 \uFB05 \uFB06")).toBe("ff fi fl ffi ffl st st");
    expect(cleanDisplayText("o\uFB03ce, e\uFB00ect, \uFB02ow, a\uFB04uent")).toBe("office, effect, flow, affluent");
  });

  it("writes the no-break, thin and hair spaces (and the other fixed-width ones) as one space", () => {
    expect(cleanDisplayText("a\u00A0b\u2009c\u200Ad\u202Fe\u2002f\u3000g\u205Fh")).toBe("a b c d e f g h");
    expect(cleanDisplayText("12\u2009\u00A0\u2009mm")).toBe("12 mm");
  });

  it("writes the full-width ASCII forms as ASCII", () => {
    expect(cleanDisplayText("\uFF21\uFF22\uFF23\uFF11\uFF12\uFF13")).toBe("ABC123");
    expect(cleanDisplayText("\uFF48\uFF45\uFF4C\uFF4C\uFF4F\uFF0C\uFF57\uFF4F\uFF52\uFF4C\uFF44\uFF01")).toBe("hello,world!");
    expect(cleanDisplayText("\uFF3B\uFF11\uFF3D")).toBe("[1]");
  });

  it("composes (NFC) and keeps the canonical singletons: the Angstrom and Ohm signs become the letters", () => {
    expect(cleanDisplayText("Mu\u0308ller, Cafe\u0301")).toBe("M\u00FCller, Caf\u00E9");
    expect(cleanDisplayText("5 \u212B and 3 \u2126")).toBe("5 \u00C5 and 3 \u03A9");
  });

  it("keeps the spelled-out ellipsis, as the entity and the mojibake repair already give it", () => {
    expect(cleanDisplayText("Wait\u2026 what")).toBe("Wait... what");
    expect(cleanDisplayText("Wait&hellip; what")).toBe("Wait... what");
  });
});

// P9-10, cluster H's second site (B P9-01 §6.1, B P9-02 §5 item 3; BACKLOG-19):
// a capital and a digit a PDF spaced apart join only inside a formula word.
describe("cleanDisplayText — the capital-and-digit join (P9-10, H; BACKLOG-19)", () => {
  it("joins the tail of a formula word: CO 2 -> CO2", () => {
    expect(cleanDisplayText("the CO 2 reduction")).toBe("the CO2 reduction");
    expect(cleanDisplayText("emits CO 2.")).toBe("emits CO2.");
    expect(cleanDisplayText("NH 3, SO 2 and NO 2")).toBe("NH3, SO2 and NO2");
  });

  it("keeps a stand-alone capital's space: A 3D", () => {
    expect(cleanDisplayText("A 3D instantaneous view")).toBe("A 3D instantaneous view");
    expect(cleanDisplayText("shows A 3D map")).toBe("shows A 3D map");
  });

  it("keeps a stand-alone capital's space before a decimal: A 0.25 mm", () => {
    expect(cleanDisplayText("A 0.25 mm diameter wire")).toBe("A 0.25 mm diameter wire");
  });

  it("keeps a figure label apart: Figure S 1", () => {
    expect(cleanDisplayText("see Figure S 1 and Table S 2")).toBe("see Figure S 1 and Table S 2");
  });

  it("keeps a type or class letter apart: Type A 2.5 mm", () => {
    expect(cleanDisplayText("a Type A 2.5 mm cell")).toBe("a Type A 2.5 mm cell");
  });

  it("does not read WAS 0.4 as a formula, BACKLOG-19", () => {
    expect(cleanDisplayText("WAS 0.4")).toBe("WAS 0.4");
    expect(cleanDisplayText("the WAS 0.4 value, then WAS 0,4")).toBe("the WAS 0.4 value, then WAS 0,4");
  });
});

// P9-10: braces are LaTeX's grouping, stripped only from LaTeX.
describe("cleanDisplayText — braces stay outside LaTeX (P9-10)", () => {
  it("keeps the braces of a plane family", () => {
    expect(cleanDisplayText("the {003} plane")).toBe("the {003} plane");
    expect(cleanDisplayText("{003}")).toBe("{003}");
    expect(cleanDisplayText("{110} ≫ {101}")).toBe("{110} ≫ {101}");
    expect(cleanDisplayText("{110} ≫ {101} > {104} ≫ {003}")).toBe("{110} ≫ {101} > {104} ≫ {003}");
  });

  it("still strips the braces of a LaTeX command", () => {
    expect(cleanDisplayText("\\mathbf{x}")).toBe("x");
    expect(cleanDisplayText("\\text{rate} of $\\mathrm{Li}_{2}$O")).toBe("rate of Li2O");
    // The gate is the whole text: once a backslash command is there, the
    // leftover grouping braces of the same text go with it, as before.
    expect(cleanDisplayText("{ab} and \\mathbf{x}")).toBe("ab and x");
  });

  it("still folds the subscript and superscript groups LaTeX writes without a backslash", () => {
    expect(cleanDisplayText("H_{2}O and x^{3}")).toBe("H2O and x(3)");
  });
});

// P9-16 (round P9 round-3 Theme 1; cluster D of the round-2 blind read): the
// paper's display text keeps the minus sign and the dashes as the author set
// them. The cleaner folded U+2212, U+2013 and U+2014 to "-", so "[12 −20 8 1]"
// printed as "[12 -20 8 1]" and every minus sign of the owner's paper was lost.
// The ruling (§1h.55) keeps them on the PAPER path only: `cleanPaperText` (what
// `papers/pdf-text.ts` uses) narrows the dash step to the hyphen glyphs, and
// `cleanDisplayText`, which feeds the sources and from them `scoring/tokenize.ts`
// (it keeps only "-" inside a token), folds every dash and minus as it always
// did. The evidence matcher folds every dash and minus to "-" itself
// (evidence.ts), so a quote typed with "-" still finds the body.
// The characters look alike, so every one is spelled by code point.
const MINUS = "\u2212"; // MINUS SIGN
const EN = "\u2013"; // EN DASH
const EM = "\u2014"; // EM DASH
const HYPHEN = "\u2010"; // HYPHEN
const NB_HYPHEN = "\u2011"; // NON-BREAKING HYPHEN
const FIGURE = "\u2012"; // FIGURE DASH
const BAR = "\u2015"; // HORIZONTAL BAR

describe("cleanDisplayText — the default still folds every dash and minus to a hyphen-minus (P9-16 guard)", () => {
  it("P9-16 guard: folds the minus sign and the en dash to '-'", () => {
    expect(cleanDisplayText(`[12 ${MINUS}20 8 1]`)).toBe("[12 -20 8 1]");
    expect(cleanDisplayText(`20${MINUS}30 mV`)).toBe("20-30 mV");
    expect(cleanDisplayText(`1990${EN}2000`)).toBe("1990-2000");
  });

  it("P9-16 guard: folds the em dash and the rest of the family to '-'", () => {
    expect(cleanDisplayText(`a ${EM} b`)).toBe("a - b");
    expect(cleanDisplayText(`re${HYPHEN}use and non${NB_HYPHEN}breaking`)).toBe("re-use and non-breaking");
    expect(cleanDisplayText(`12${FIGURE}34 and a ${BAR} b`)).toBe("12-34 and a - b");
  });

  it("P9-16 guard: the entities and a mojibake dash read as '-', before the LaTeX step as they always did", () => {
    expect(cleanDisplayText("&minus;20 and 1990&ndash;2000 and a &mdash; b")).toBe("-20 and 1990-2000 and a - b");
    expect(cleanDisplayText("1990\u00E2\u20AC\u201C2000 and a \u00E2\u20AC\u201D b")).toBe("1990-2000 and a - b");
    // The entity is a hyphen when the LaTeX subscript step runs, so the "_" goes
    // with it exactly as for a typed hyphen-minus.
    expect(cleanDisplayText("x_&minus;1")).toBe(cleanDisplayText("x_-1"));
  });
});

describe("cleanPaperText — the author's minus sign and dashes stay (P9-16)", () => {
  it("P9-16: keeps the minus sign: a vector, a range, a charge and a formula", () => {
    expect(cleanPaperText(`[12 ${MINUS}20 8 1]`)).toBe(`[12 ${MINUS}20 8 1]`);
    expect(cleanPaperText(`20${MINUS}30 mV`)).toBe(`20${MINUS}30 mV`);
    expect(cleanPaperText(`Li1${MINUS}xCoO2 and a drift of ${MINUS}0.4 V`)).toBe(
      `Li1${MINUS}xCoO2 and a drift of ${MINUS}0.4 V`,
    );
  });

  it("P9-16: keeps the en dash and the em dash", () => {
    expect(cleanPaperText(`1990${EN}2000`)).toBe(`1990${EN}2000`);
    expect(cleanPaperText(`a ${EM} b`)).toBe(`a ${EM} b`);
    expect(cleanPaperText(`a${EM}b and pp. 4${EN}9`)).toBe(`a${EM}b and pp. 4${EN}9`);
  });

  it("P9-16: folds the hyphen glyphs to the hyphen-minus", () => {
    expect(cleanPaperText(`re${HYPHEN}use`)).toBe("re-use");
    expect(cleanPaperText(`non${NB_HYPHEN}breaking`)).toBe("non-breaking");
  });

  it("P9-16: folds the figure dash to an en dash and the horizontal bar to an em dash", () => {
    expect(cleanPaperText(`12${FIGURE}34`)).toBe(`12${EN}34`);
    expect(cleanPaperText(`a ${BAR} b`)).toBe(`a ${EM} b`);
  });

  it("P9-16: the ASCII hyphen-minus is what it was", () => {
    expect(cleanPaperText("GPT-4, a 4-2 split and x = -3")).toBe("GPT-4, a 4-2 split and x = -3");
  });

  it("P9-16: a numeric reference to the glyph keeps it, a reference to a hyphen glyph folds", () => {
    expect(cleanPaperText("&#8722;20 and &#x2212;20, 4&#8211;9 and a&#x2014;b")).toBe(
      `${MINUS}20 and ${MINUS}20, 4${EN}9 and a${EM}b`,
    );
    expect(cleanPaperText("re&#8208;use and non&#x2011;breaking")).toBe("re-use and non-breaking");
  });

  it("P9-16: it is the same pipeline with the dash step narrowed — folding its dashes gives the default", () => {
    const samples = [
      `[12 ${MINUS}20 8 1] and Li1${MINUS}xCoO2`,
      `grown at T = 275 \u00B0C, 1990${EN}2000, a ${EM} b, 0 \u2264 \u03C6 \u2264 360\u00B0`,
      `CO 2 and {003} and H_{2}O and 12${FIGURE}34, a ${BAR} b, re${HYPHEN}use`,
      `4 \u00B5m \u00E2\u20AC\u201C 5 \u00B5m and ${MINUS}0.4 V`,
    ];
    for (const sample of samples) {
      expect(cleanPaperText(sample).replace(/[\u2013\u2014\u2212]/g, "-")).toBe(cleanDisplayText(sample));
    }
    // And with no dash in it, the two are the same string.
    expect(cleanPaperText("the {003} plane at 275 \u00B0C, a \u2264 b, CO 2")).toBe(
      cleanDisplayText("the {003} plane at 275 \u00B0C, a \u2264 b, CO 2"),
    );
  });

  it("P9-16: end to end, a PDF's text layer keeps its en and em dashes", async () => {
    // WinAnsi: byte 0x96 is the en dash, 0x97 the em dash (the helper writes
    // Latin-1, so U+0096 and U+0097 are those bytes). `extractPdfTextFromBytes`
    // cleans through `cleanPaperText`.
    const bytes = minimalPdf([
      [
        ["A Paper About Cathodes", 72, 90, 18],
        ["1 Introduction", 72, 130, 12, true],
        ...prose(
          [
            "The cells were cycled between 1990\u0096 and 2000 rpm for five days of the sweep.",
            "Each run was timed \u0097 start to finish \u0097 over the full schedule of the furnace.",
            "Nothing else in the furnace schedule changed between the first and the last run.",
          ],
          150,
        ),
      ],
    ]);
    const result = await extractPdfTextFromBytes(bytes);
    const text = (result.doc?.sections ?? []).map((s) => s.text).join(" ");
    expect(text).toContain(`1990${EN}`);
    expect(text).toContain(`timed ${EM} start to finish ${EM} over`);
  });
});
