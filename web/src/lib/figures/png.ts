// A PNG, written by hand.
//
// `unpdf` hands back a PDF's embedded pictures as raw pixels — width, height,
// one, three or four channels — and nothing on the server turns pixels into a
// file: no canvas, no sharp, no native image library, because the deployed
// runtime has none of them. PNG is the one format that needs only what Node
// ships: zlib for the pixel stream and thirty lines of chunk framing.
//
// Unfiltered rows (filter byte 0), one IDAT. Not the smallest PNG possible;
// a figure is served once and cached at the edge for a day.

import { deflateSync } from "node:zlib";

export interface RawImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
  channels: 1 | 3 | 4;
}

const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** PNG colour type for a channel count: greyscale, truecolour, truecolour with alpha. */
const COLOUR_TYPE: Record<RawImage["channels"], number> = { 1: 0, 3: 2, 4: 6 };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  out.set([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)], 4);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

export function encodePng(image: RawImage): Uint8Array {
  const { width, height, channels } = image;
  if (!(width > 0 && height > 0)) throw new Error("png: empty image");
  const rowBytes = width * channels;
  if (image.data.length < rowBytes * height) throw new Error("png: pixel data shorter than the image");

  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = COLOUR_TYPE[channels];
  // compression 0, filter 0, interlace 0 — already zero.

  // Each row gets a leading filter byte: 0, "none".
  const rows = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    rows[y * (rowBytes + 1)] = 0;
    rows.set(image.data.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1);
  }
  const idat = new Uint8Array(deflateSync(rows));

  const parts = [SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    png.set(p, at);
    at += p.length;
  }
  return png;
}
