// Minimal declarations for untyped development dependencies.
declare module 'hyphen/*' {
  const lang: { hyphenateSync(text: string, options?: { hyphenChar?: string; minWordLength?: number }): string };
  export default lang;
}

declare module 'opentype.js' {
  interface PathCommand {
    type: 'M' | 'L' | 'Q' | 'C' | 'Z';
    x?: number;
    y?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
  }
  interface Path {
    commands: PathCommand[];
    toPathData(decimalPlaces?: number): string;
  }
  interface Font {
    unitsPerEm: number;
    ascender: number;
    descender: number;
    tables: { os2?: { sxHeight?: number; sCapHeight?: number } };
    getAdvanceWidth(text: string, fontSize: number, options?: { kerning?: boolean }): number;
    getPath(text: string, x: number, y: number, fontSize: number, options?: { kerning?: boolean }): Path;
  }
  const opentype: { parse(buffer: ArrayBuffer): Font };
  export default opentype;
  export type { Font, Path, PathCommand };
}

declare module '*.woff' {
  const bytes: Uint8Array;
  export default bytes;
}

declare module '*.txt' {
  const text: string;
  export default text;
}
