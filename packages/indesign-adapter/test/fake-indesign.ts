/**
 * A tiny stand-in for InDesign's Single-line Composer, enough to test the apply
 * loop in Node: greedy line breaking, teeth limit a line's width by baseline,
 * InDesign's squeeze tolerance (spike S2), and a dictionary that may refuse points.
 */
import type { LineSlot, ParagraphData, Port, ReadLine, ToothSpec, TrackingSpan } from '../src/index.ts';

export interface FakeOptions {
  measure: number;
  size?: number;
  leading?: number;
  language?: string;
  /** Points the fake dictionary accepts in a word (break before word[index]). */
  accepts: (word: string) => number[];
  /** Whether probing is available (spike S3). */
  probing?: boolean;
  /** Squeeze tolerance: a line may be this much wider than allowed. */
  tolerance?: number;
  /** Space before each paragraph in points. */
  spaceBefore?: number;
}

const advance = (c: string) => (c === ' ' ? 2.5 : /[il.,:;'’!]/.test(c) ? 2.5 : /[mwMW]/.test(c) ? 7.5 : 5);
const HYPHEN = 3;

export class FakeInDesign implements Port {
  teeth: ToothSpec[] = [];
  compositions = 0;
  /** Tracking units per paragraph and character (1/1000 em). */
  tracking = new Map<number, number[]>();
  private readonly texts: string[];
  private readonly o: Required<Omit<FakeOptions, 'spaceBefore'>> & { spaceBefore: number };

  constructor(texts: string[], o: FakeOptions) {
    this.texts = texts;
    this.o = { size: 10, leading: 13, language: 'German: 2006 Reform', probing: true, tolerance: 0.1, spaceBefore: 0, ...o };
  }

  paragraphs(): ParagraphData[] {
    return this.texts.map((t, index) => ({
      index,
      chars: [...t],
      advances: [...t].map(advance),
      language: this.o.language,
      hyphenWidth: HYPHEN,
      size: this.o.size,
      leading: this.o.leading,
      measure: this.o.measure,
      firstLineIndent: 0,
    }));
  }

  probe(words: readonly string[]): Map<string, number[]> | undefined {
    if (!this.o.probing) return undefined;
    return new Map(words.map((w) => [w, this.o.accepts(w)]));
  }

  setTeeth(teeth: readonly ToothSpec[]): void {
    this.teeth = [...teeth];
  }

  setTracking(paragraph: number, spans: readonly TrackingSpan[]): void {
    const t = new Array([...this.texts[paragraph]!].length).fill(0);
    for (const s of spans) for (let k = s.from; k < s.to; k++) t[k] = s.units;
    this.tracking.set(paragraph, t);
  }

  readLines(): ReadLine[] {
    this.compositions++;
    const out: ReadLine[] = [];
    let y = 0;
    this.texts.forEach((text, paragraph) => {
      y += paragraph > 0 ? this.o.spaceBefore : 0;
      const chars = [...text];
      let start = 0;
      let line = 0;
      while (start < chars.length) {
        const baseline = y + this.o.leading;
        const slot: LineSlot = { page: 0, baseline, startX: 0, columnRight: this.o.measure, gutter: 10, size: this.o.size };
        const tooth = this.teeth.find((t) => t.bounds[0] <= baseline && t.bounds[2] >= baseline - this.o.size);
        const max = tooth ? tooth.bounds[1] - slot.startX : this.o.measure;
        const track = this.tracking.get(paragraph) ?? [];
        const { end, hyphenated } = this.breakLine(chars, start, max, (k) => advance(chars[k]!) + ((track[k] ?? 0) * this.o.size) / 1000);
        let last = end - 1;
        while (last > start && chars[last] === ' ') last--;
        out.push({ paragraph, line, lastVisible: last, hyphenated, slot });
        start = end;
        while (start < chars.length && chars[start] === ' ') start++;
        line++;
        y = baseline;
      }
    });
    return out;
  }

  private trackOf(_chars: string[], _k: number): number {
    return 0;
  }

  /** Greedy: the last break that fits within max (+ tolerance). Returns one past the line's last character. */
  private breakLine(chars: string[], start: number, max: number, adv: (k: number) => number): { end: number; hyphenated: boolean } {
    const limit = max + this.o.tolerance;
    let width = 0;
    let best: { end: number; hyphenated: boolean } | undefined;
    let wordStart = start;
    for (let k = start; k < chars.length; k++) {
      const c = chars[k]!;
      if (c === '\n') return { end: k + 1, hyphenated: false };
      if (c === ' ') {
        if (width <= limit) best = { end: k, hyphenated: false };
        else break;
        wordStart = k + 1;
      } else if (k > wordStart) {
        // Hyphenation point before chars[k]?
        const wordEnd = (() => { let e = k; while (e < chars.length && /\p{L}/u.test(chars[e]!)) e++; return e; })();
        const word = chars.slice(wordStart, wordEnd).join('');
        if (/^\p{L}+$/u.test(word) && this.o.accepts(word).includes(k - wordStart) && width + HYPHEN + this.trackOf(chars, k) <= limit) best = { end: k, hyphenated: true };
      }
      width += adv(k);
      if (width > limit && best) return best;
    }
    if (width <= limit) return { end: chars.length, hyphenated: false };
    return best ?? { end: Math.max(start + 1, chars.length), hyphenated: false };
  }
}
