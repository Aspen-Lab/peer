import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { encodePng } from "./png";

function chunks(png: Uint8Array): { type: string; body: Uint8Array }[] {
  const out: { type: string; body: Uint8Array }[] = [];
  let at = 8;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  while (at < png.length) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    out.push({ type, body: png.subarray(at + 8, at + 8 + len) });
    at += 12 + len;
  }
  return out;
}

describe("encodePng", () => {
  it("writes a file a decoder would accept: signature, IHDR, IDAT, IEND", () => {
    // 2×2 RGB: red, green / blue, white.
    const data = Uint8ClampedArray.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
    const png = encodePng({ data, width: 2, height: 2, channels: 3 });

    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const parts = chunks(png);
    expect(parts.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);

    const ihdr = new DataView(parts[0].body.buffer, parts[0].body.byteOffset);
    expect(ihdr.getUint32(0)).toBe(2);
    expect(ihdr.getUint32(4)).toBe(2);
    expect(parts[0].body[8]).toBe(8); // bit depth
    expect(parts[0].body[9]).toBe(2); // truecolour

    // The pixel stream inflates to the rows, each led by a filter byte of 0.
    const rows = inflateSync(parts[1].body);
    expect(Array.from(rows)).toEqual([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255]);
  });

  it("names the colour type by the channel count", () => {
    const grey = encodePng({ data: Uint8ClampedArray.from([0, 128, 255, 64]), width: 2, height: 2, channels: 1 });
    expect(chunks(grey)[0].body[9]).toBe(0);
    const rgba = encodePng({ data: new Uint8ClampedArray(16), width: 2, height: 2, channels: 4 });
    expect(chunks(rgba)[0].body[9]).toBe(6);
  });

  it("refuses an image its data cannot fill", () => {
    expect(() => encodePng({ data: new Uint8ClampedArray(3), width: 2, height: 2, channels: 3 })).toThrow();
    expect(() => encodePng({ data: new Uint8ClampedArray(0), width: 0, height: 0, channels: 1 })).toThrow();
  });
});
