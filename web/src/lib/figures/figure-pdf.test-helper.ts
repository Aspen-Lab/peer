// Tiny synthetic PDFs for the figure-engine tests: vector shapes, one small
// raster, and base-14 Helvetica text, built in the test with no dependency and
// no committed binary. Not a test file itself (Vitest runs `*.test.ts` only);
// the text-only sibling is `papers/minimal-pdf.test-helper.ts`.
//
// Every y here is measured from the TOP of the page, the way a reader (and
// MuPDF's page space) counts; the PDF's own bottom-left origin is applied once,
// below. The PDFs are invented — the owner's paper is never a fixture.

import { deflateSync } from "node:zlib";

type Rgb = [number, number, number];

/** One run of text: the words, x, the baseline's distance from the top, the size. */
export type TextRun = [text: string, x: number, top: number, size: number];

export type Shape =
  /** A rectangle, outlined in black and filled when `fill` is given. */
  | { kind: "rect"; x: number; top: number; w: number; h: number; fill?: Rgb }
  | { kind: "line"; x1: number; top1: number; x2: number; top2: number }
  /** A cubic Bézier stroked in red: start, two control points, end. */
  | { kind: "curve"; points: [number, number, number, number, number, number, number, number] }
  /** A 16 x 16 gradient raster drawn into the given box. */
  | { kind: "image"; x: number; top: number; w: number; h: number };

export interface FigurePage {
  /** Width and height in points; US Letter when omitted. */
  size?: [number, number];
  text?: TextRun[];
  shapes?: Shape[];
}

const RASTER_SIDE = 16;

function rasterBytes(): string {
  const rgb = Buffer.alloc(RASTER_SIDE * RASTER_SIDE * 3);
  for (let y = 0; y < RASTER_SIDE; y++) {
    for (let x = 0; x < RASTER_SIDE; x++) {
      const at = (y * RASTER_SIDE + x) * 3;
      rgb[at] = x * 16;
      rgb[at + 1] = y * 16;
      rgb[at + 2] = 128;
    }
  }
  return deflateSync(rgb).toString("latin1");
}

const escapeText = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const n = (value: number) => (Math.round(value * 100) / 100).toString();

/** A real, minimal PDF: one page per entry. A page with no shapes and no text
 *  is blank; a page with text and no shapes is a page with nothing to extract. */
export function figurePdf(pages: FigurePage[]): Buffer {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body);
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const pagesId = add("");
  const kids: number[] = [];
  const raster = rasterBytes();

  for (const page of pages) {
    const [width, height] = page.size ?? [612, 792];
    const y = (top: number) => n(height - top);
    const ops: string[] = [];
    const images: number[] = [];
    for (const shape of page.shapes ?? []) {
      if (shape.kind === "rect") {
        const fill = shape.fill ? `${shape.fill.map(n).join(" ")} rg ` : "";
        ops.push(
          `0 0 0 RG 0.8 w ${fill}${n(shape.x)} ${y(shape.top + shape.h)} ${n(shape.w)} ${n(shape.h)} re ${shape.fill ? "B" : "S"}`,
        );
      } else if (shape.kind === "line") {
        ops.push(`0 0 0 RG 1 w ${n(shape.x1)} ${y(shape.top1)} m ${n(shape.x2)} ${y(shape.top2)} l S`);
      } else if (shape.kind === "curve") {
        const [x0, t0, x1, t1, x2, t2, x3, t3] = shape.points;
        ops.push(
          `1 0 0 RG 1.5 w ${n(x0)} ${y(t0)} m ${n(x1)} ${y(t1)} ${n(x2)} ${y(t2)} ${n(x3)} ${y(t3)} c S`,
        );
      } else {
        const id = add(
          `<< /Type /XObject /Subtype /Image /Width ${RASTER_SIDE} /Height ${RASTER_SIDE} ` +
            `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${raster.length} >>\n` +
            `stream\n${raster}\nendstream`,
        );
        images.push(id);
        ops.push(`q ${n(shape.w)} 0 0 ${n(shape.h)} ${n(shape.x)} ${y(shape.top + shape.h)} cm /Im${images.length} Do Q`);
      }
    }
    for (const [text, x, top, size] of page.text ?? []) {
      ops.push(`BT /F1 ${size} Tf ${n(x)} ${y(top)} Td (${escapeText(text)}) Tj ET`);
    }
    const stream = ops.join("\n");
    const contents = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    const xobjects = images.length
      ? `/XObject << ${images.map((id, i) => `/Im${i + 1} ${id} 0 R`).join(" ")} >> `
      : "";
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${width} ${height}] ` +
          `/Resources << /Font << /F1 1 0 R >> ${xobjects}>> /Contents ${contents} 0 R >>`,
      ),
    );
  }
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** Body text: `lines` of 10-point prose from `top`, `pitch` apart. */
export function bodyText(lines: string[], top: number, pitch = 13): TextRun[] {
  return lines.map((line, i): TextRun => [line, 72, top + i * pitch, 10]);
}

/** A vector bar chart with axes and a curve, no raster anywhere: `x`, `top` is
 *  its upper-left corner. Its drawn extent, to the point, is
 *  `[x, top - 10, x + 270, top + 150]` — the curve's control point sits 10
 *  above the y axis. */
export function barChart(x: number, top: number): Shape[] {
  const shapes: Shape[] = [];
  [40, 90, 130, 70, 110].forEach((h, i) => {
    shapes.push({ kind: "rect", x: x + 10 + i * 50, top: top + 150 - h, w: 36, h, fill: [0.2, 0.4 + i * 0.1, 0.8] });
  });
  shapes.push({ kind: "line", x1: x, top1: top + 150, x2: x + 270, top2: top + 150 });
  shapes.push({ kind: "line", x1: x, top1: top, x2: x, top2: top + 150 });
  shapes.push({ kind: "curve", points: [x + 10, top + 20, x + 90, top - 10, x + 170, top + 60, x + 260, top + 10] });
  return shapes;
}

/** A framed panel of coloured squares, `w` x `h`, upper-left at (`x`, `top`). */
export function panel(x: number, top: number, w = 370, h = 160): Shape[] {
  const shapes: Shape[] = [{ kind: "rect", x, top, w, h }];
  for (let i = 0; i < 4; i++) {
    shapes.push({ kind: "rect", x: x + 30 + i * 80, top: top + 40 + (i % 2) * 30, w: 44, h: 44, fill: [0.9, 0.5 - 0.1 * i, 0.2] });
  }
  return shapes;
}

/** The IHDR width and height of a PNG, and whether it carries the PNG signature. */
export function pngInfo(png: Uint8Array): { signature: boolean; width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => png[i] === byte);
  return { signature, width: view.getUint32(16), height: view.getUint32(20) };
}

// ── The invented PDFs the figure tests share ─────────────────────────────

export const CHART_CAPTION = "Figure 1. A synthetic vector bar chart drawn with paths only, no raster image anywhere.";
export const RASTER_CAPTION = "Figure 1. A synthetic raster drawn into a box.";
export const PANEL_ONE = "Figure 3. Vector panel one of a two-figure page.";
export const PANEL_TWO = "Figure 10. Vector panel two of a two-figure page.";

const prose = bodyText(["Synthetic body text, one line.", "Synthetic body text, a second line."], 80);
const nothing = bodyText(["A page of prose and nothing else.", "Nothing here is drawn."], 80);

/** Two vector panels on one page, a caption under each. */
const twoPanelPage: FigurePage = {
  text: [
    [PANEL_ONE, 100, 262, 9],
    [PANEL_TWO, 100, 512, 9],
  ],
  shapes: [...panel(100, 80), ...panel(100, 330)],
};

export const fixtures = {
  /** One vector bar chart and its caption (Figure 1). */
  chart: figurePdf([{ text: [...prose, [CHART_CAPTION, 72, 440, 9]], shapes: barChart(110, 250) }]),
  /** Two vector panels on one page (Figures 3 and 10). */
  twoPanel: figurePdf([twoPanelPage]),
  /** Four pages: nothing; a raster (Figure 1); a chart (Figure 2); two panels (Figures 3, 10). */
  paper: figurePdf([
    { text: nothing },
    { text: [...prose, [RASTER_CAPTION, 72, 370, 9]], shapes: [{ kind: "image", x: 100, top: 150, w: 200, h: 200 }] },
    { text: [...prose, ["Figure 2. A synthetic vector bar chart on page three.", 72, 440, 9]], shapes: barChart(110, 250) },
    twoPanelPage,
  ]),
  /** Prose and nothing else. */
  textOnly: figurePdf([{ text: nothing }]),
  /** The chart without a "Figure N" caption under it. */
  uncaptioned: figurePdf([{ text: [...prose, ["A chart with no caption of its own.", 72, 440, 9]], shapes: barChart(110, 250) }]),
  /** A poster-sized page with one 800 x 800 pt vector figure: at the default
   *  2.8x it would be 5.3 Mpx, over the 4.5 Mpx ceiling. */
  hugeFigure: figurePdf([
    {
      size: [900, 1000],
      text: [["Figure 1. One very large vector figure.", 50, 880, 9]],
      shapes: [{ kind: "rect", x: 50, top: 50, w: 800, h: 800, fill: [0.85, 0.9, 1] }, ...barChart(150, 300)],
    },
  ]),
};
