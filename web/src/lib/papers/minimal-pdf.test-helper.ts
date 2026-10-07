// A real, minimal PDF built in the test, for the tests that need pdf.js to
// read an actual file: no dependency, no Python. Not a test file itself
// (Vitest runs `*.test.ts` only).

/** One run of text: the words, x, y measured from the TOP of an A4 page (the
 *  way the old PyMuPDF fixtures placed them), the size, and whether it is set
 *  in the bold face. */
export type Run = [text: string, x: number, top: number, size: number, bold?: boolean];

/**
 * A real, minimal PDF — one text layer, base-14 Helvetica — built in the test
 * so pdf.js reads it exactly as it reads a paper. No dependency and no
 * Python: the fixtures the PyMuPDF tests used to draw are drawn here. A page
 * with no runs is a page with no text layer, the way a scan reads.
 */
export function minimalPdf(pages: Run[][]): Buffer {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body);
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const pagesId = add("");
  const kids: number[] = [];
  const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  for (const runs of pages) {
    const stream = runs
      .map(([text, x, top, size, bold]) => `BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${842 - top} Td (${escape(text)}) Tj ET`)
      .join("\n");
    const contents = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] ` +
          `/Resources << /Font << /F1 1 0 R /F2 2 0 R >> >> /Contents ${contents} 0 R >>`,
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

/** Prose lines, `pitch` apart, starting at `top`. */
export function prose(lines: string[], top: number, pitch = 14): Run[] {
  return lines.map((text, i): Run => [text, 72, top + i * pitch, 11]);
}
