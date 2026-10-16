/**
 * Font metrics for the simulator. Browser-safe: takes the font bytes, not a path.
 * Note: opentype.js does not apply this font's kerning, so widths are slightly
 * wider than InDesign's. Production widths always come from InDesign.
 */
import opentype, { type Font, type PathCommand } from 'opentype.js';

export interface SimFont {
  /** Advance width of a text run in points. */
  measure(text: string, size: number): number;
  /** SVG path data for the run with its baseline at y. */
  pathData(text: string, x: number, y: number, size: number): string;
  /** Height of lower-case x as a fraction of the font size. */
  xHeight: number;
  ascender: number;
  descender: number;
}

export function fontFromBytes(bytes: Uint8Array): SimFont {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return wrap(opentype.parse(buffer));
}

function wrap(font: Font): SimFont {
  const upm = font.unitsPerEm;
  const cache = new Map<string, number>();
  return {
    measure(text, size) {
      const key = `${size}\u0000${text}`;
      let w = cache.get(key);
      if (w === undefined) {
        w = font.getAdvanceWidth(text, size, { kerning: true });
        cache.set(key, w);
      }
      return w;
    },
    pathData: (text, x, y, size) => toPathData(font.getPath(text, x, y, size, { kerning: true }).commands),
    xHeight: (font.tables.os2?.sxHeight ?? upm * 0.48) / upm,
    ascender: font.ascender / upm,
    descender: font.descender / upm,
  };
}

/**
 * Our own serializer: opentype.js 2.0's toPathData(decimals) emits "NaN" for
 * some coordinates, and SVG stops drawing a path at the first bad number.
 */
function toPathData(commands: readonly PathCommand[]): string {
  const f = (n: number | undefined) => {
    const r = Math.round((n ?? 0) * 100) / 100;
    return Object.is(r, -0) ? '0' : String(r);
  };
  let d = '';
  for (const c of commands) {
    switch (c.type) {
      case 'M':
      case 'L':
        d += `${c.type}${f(c.x)} ${f(c.y)}`;
        break;
      case 'Q':
        d += `Q${f(c.x1)} ${f(c.y1)} ${f(c.x)} ${f(c.y)}`;
        break;
      case 'C':
        d += `C${f(c.x1)} ${f(c.y1)} ${f(c.x2)} ${f(c.y2)} ${f(c.x)} ${f(c.y)}`;
        break;
      case 'Z':
        d += 'Z';
        break;
    }
  }
  return d;
}
