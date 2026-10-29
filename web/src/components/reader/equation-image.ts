/** Draw the already typeset formula with its loaded KaTeX fonts onto a PNG. */
export async function equationPng(element: HTMLElement): Promise<Blob> {
  await document.fonts.ready;
  const root = element.getBoundingClientRect();
  const width = Math.ceil(Math.max(element.scrollWidth, root.width));
  const height = Math.ceil(Math.max(element.scrollHeight, root.height));
  if (!width || !height) throw new Error("Formula is not ready");

  const padding = 32;
  const imageWidth = width + padding * 2;
  const imageHeight = height + padding * 2;
  const scale = Math.min(2, 8192 / imageWidth, 8192 / imageHeight);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(imageWidth * scale);
  canvas.height = Math.ceil(imageHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image rendering is unavailable");
  ctx.scale(scale, scale);
  ctx.fillStyle = "#f7f5fc";
  ctx.fillRect(0, 0, imageWidth, imageHeight);
  const x = (left: number) => left - root.left + padding;
  const y = (top: number) => top - root.top + padding;
  const ink = "#24223a";

  // Fractions, overlines and roots use CSS rules as well as glyphs.
  for (const node of Array.from(element.querySelectorAll<HTMLElement>("*"))) {
    if (node.closest(".katex-mathml") || node.closest("svg")) continue;
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    for (const edge of ["top", "bottom"] as const) {
      const border = parseFloat(edge === "top" ? style.borderTopWidth : style.borderBottomWidth);
      const kind = edge === "top" ? style.borderTopStyle : style.borderBottomStyle;
      if (border > 0 && kind !== "none" && rect.width > 0) {
        ctx.fillStyle = ink;
        ctx.fillRect(x(rect.left), y(edge === "top" ? rect.top : rect.bottom - border), rect.width, border);
      }
    }
  }

  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    const text = node.textContent;
    if (!parent || !text?.trim() || parent.closest(".katex-mathml, svg")) continue;
    const style = getComputedStyle(parent);
    if (style.visibility === "hidden" || style.display === "none") continue;
    ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    ctx.fillStyle = ink;
    ctx.textBaseline = "alphabetic";
    let offset = 0;
    for (const line of text.split("\n")) {
      if (line.trim()) {
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + line.length);
        const rect = range.getBoundingClientRect();
        if (rect.width && rect.height) {
          const metrics = ctx.measureText(line);
          const glyphHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
          const baseline = rect.top + (rect.height - glyphHeight) / 2 + metrics.actualBoundingBoxAscent;
          ctx.fillText(line, x(rect.left), y(baseline));
        }
      }
      offset += line.length + 1;
    }
  }

  // KaTeX draws extensible radicals and arrows with SVG paths.
  for (const svg of Array.from(element.querySelectorAll<SVGSVGElement>(".katex-html svg"))) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(rect.width));
    clone.setAttribute("height", String(rect.height));
    clone.style.color = ink;
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      ctx.drawImage(image, x(rect.left), y(rect.top), rect.width, rect.height);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Image rendering failed")), "image/png");
  });
}
