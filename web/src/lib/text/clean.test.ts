import { describe, expect, it } from "vitest";
import { extractPdfTextFromBytes } from "@/lib/papers/pdf-text";
import { minimalPdf, prose } from "@/lib/papers/minimal-pdf.test-helper";
import { cleanDisplayText } from "./clean";

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
