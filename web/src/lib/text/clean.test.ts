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
    expect(cleanDisplayText("275 Â°C and 3 Â± 0.2")).toBe("275 °C and 3 ± 0.2");
  });

  it("D3: still folds a micro sign to the Greek letter and leaves Σ, Å, ∼ and ≫ alone (guard)", () => {
    // U+00B5 MICRO SIGN becomes U+03BC GREEK SMALL LETTER MU.
    expect(cleanDisplayText("4 µm, Σ3, 5 Å, ∼1 μm, 110 ≫ 101")).toBe(
      "4 μm, Σ3, 5 Å, ∼1 μm, 110 ≫ 101",
    );
  });

  it("D3b: the &micro; entity is the Greek letter too, not the word", () => {
    expect(cleanDisplayText("4 &micro;m")).toBe("4 μm");
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
