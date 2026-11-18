/**
 * A tiny stand-in for InDesign's Single-line Composer, enough to test the apply
 * loop in Node: greedy line breaking, teeth limit a line's width by baseline,
 * InDesign's squeeze tolerance (spike S2), and a dictionary that may refuse points.
 */
import { paragraphLanguages, type BandSpec, type LanguageRun, type LineSlot, type ParagraphData, type Port, type ReadLine, type ToothSpec, type TrackingSpan } from '../src/index.ts';

export interface FakeOptions {
  measure: number;
  size?: number;
  leading?: number;
  language?: string;
  /** Points the fake dictionary accepts in a word (break before word[index]), probed in this language. */
  accepts: (word: string, language: string) => number[];
  /** Language runs per paragraph (paragraph-relative); paragraphs without runs are in `language`. */
  runs?: (LanguageRun[] | undefined)[];
  /** Whether probing is available (spike S3). */
  probing?: boolean;
  /** Squeeze tolerance: a line may be this much wider than allowed. */
  tolerance?: number;
  /** Space before each paragraph in points. */
  spaceBefore?: number;
  /** Lines that fit in the frame; later lines are overset. */
  maxLines?: number;
  /** A second, threaded frame of another width: from this line of the story on, lines have this measure. */
  frameFrom?: { line: number; measure: number };
  /** Columns of this many lines side by side (a story through many columns); no space before at a column top. */
  columnLines?: number;
  /** Leave the column ids out of the read-back, as before slots were predicted (for comparison). */
  hideColumns?: boolean;
  /** InDesign's "Hyphenate Across Column": false = the last line of a column never hyphenates. */
  hyphenateAcrossColumns?: boolean;
  /** Compounds whose typed hyphen InDesign will not break after (like "master-builder" with hyphenation on). */
  refusesAfterHyphen?: (compound: string, at: number) => boolean;
}

const advance = (c: string) => (c === ' ' ? 2.5 : /[il.,:;'’!]/.test(c) ? 2.5 : /[mwMW]/.test(c) ? 7.5 : 5);
const HYPHEN = 3;

export class FakeInDesign implements Port {
  teeth: ToothSpec[] = [];
  compositions = 0;
  /** Tracking units per paragraph and character (1/1000 em). */
  tracking = new Map<number, number[]>();
  private readonly texts: string[];
  private readonly o: Required<Omit<FakeOptions, 'spaceBefore' | 'frameFrom' | 'runs' | 'columnLines' | 'hideColumns' | 'hyphenateAcrossColumns'>> & { spaceBefore: number; frameFrom?: { line: number; measure: number }; runs?: (LanguageRun[] | undefined)[]; columnLines?: number; hideColumns?: boolean; hyphenateAcrossColumns?: boolean };
  /** Every probe call: the language asked for (undefined = the paragraph's) and the words. */
  probes: { language: string | undefined; words: string[] }[] = [];

  constructor(texts: string[], o: FakeOptions) {
    this.texts = texts;
    this.o = { size: 10, leading: 13, language: 'German: 2006 Reform', probing: true, tolerance: 0.1, spaceBefore: 0, ...o };
  }

  paragraphs(): ParagraphData[] {
    return this.texts.map((t, index) => ({
      index,
      chars: [...t],
      advances: [...t].map(advance),
      ...(this.o.runs?.[index] ? (({ language, runs }) => ({ language, ...(runs ? { languages: runs } : {}) }))(paragraphLanguages(this.o.runs[index]!, [...t], 0)) : { language: this.o.language }),
      hyphenWidth: HYPHEN,
      size: this.o.size,
      leading: this.o.leading,
      measure: this.o.measure,
      columnWidth: this.o.measure,
      firstLineIndent: 0,
      spaceBefore: index > 0 ? this.o.spaceBefore : 0,
      spaceAfter: 0,
      ...(this.o.hyphenateAcrossColumns !== undefined ? { hyphenateAcrossColumns: this.o.hyphenateAcrossColumns } : {}),
    }));
  }

  overset(): boolean {
    return this.o.maxLines !== undefined && this.allLines().length > this.o.maxLines;
  }

  probe(words: readonly string[], paragraph: ParagraphData, language?: string): Map<string, number[]> | undefined {
    this.probes.push({ language, words: [...words] });
    if (!this.o.probing) return undefined;
    return new Map(words.map((w) => [w, w.includes('-') ? this.hyphenBreaks(w) : this.o.accepts(w, language ?? paragraph.language)]));
  }

  private hyphenBreaks(compound: string): number[] {
    const out: number[] = [];
    Array.from(compound).forEach((c, i) => {
      if (c === '-' && i > 0 && !this.o.refusesAfterHyphen?.(compound, i + 1)) out.push(i + 1);
    });
    return out;
  }

  bands: BandSpec[] = [];

  setBands(bands: readonly BandSpec[]): void {
    this.bands = [...bands];
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
    const all = this.allLines();
    return this.o.maxLines === undefined ? all : all.slice(0, this.o.maxLines);
  }

  private allLines(): ReadLine[] {
    const out: ReadLine[] = [];
    let y = 0;
    let storyLine = 0;
    // Columns: a line fits while its baseline plus 0.3 of the type size stays above the column's bottom.
    const columnLines = this.o.columnLines;
    const bottom = columnLines ? this.o.leading * columnLines + 0.3 * this.o.size : undefined;
    let column = 0;
    let atTop = true;
    this.texts.forEach((text, paragraph) => {
      const chars = [...text];
      let start = 0;
      let line = 0;
      while (start < chars.length) {
        let baseline = atTop ? this.o.leading : y + this.o.leading + (line === 0 && paragraph > 0 ? this.o.spaceBefore : 0);
        if (bottom !== undefined && !atTop && baseline + 0.3 * this.o.size > bottom) {
          column++;
          baseline = this.o.leading;
        }
        atTop = false;
        const measure = this.o.frameFrom && storyLine >= this.o.frameFrom.line ? this.o.frameFrom.measure : this.o.measure;
        const x0 = columnLines ? column * (this.o.measure + 10) : 0;
        const slot: LineSlot = {
          page: 0, baseline, startX: x0, columnLeft: x0, columnRight: x0 + measure, gutter: 10, size: this.o.size,
          ...(this.o.maxLines !== undefined ? { limit: this.o.leading * this.o.maxLines } : bottom !== undefined ? { limit: bottom } : {}),
          ...(columnLines && !this.o.hideColumns ? { column, columnBounds: [x0, x0 + measure] as [number, number] } : {}),
        };
        const tooth = this.teeth.find((t) => t.bounds[0] <= baseline && t.bounds[2] >= baseline - this.o.size && t.bounds[3] > x0 && t.bounds[1] < x0 + measure + 10);
        const max = tooth ? Math.min(tooth.bounds[1] - slot.startX, measure) : measure;
        const track = this.tracking.get(paragraph) ?? [];
        // The last line of a column: no line below it fits.
        const lastInColumn = bottom !== undefined && baseline + this.o.leading + 0.3 * this.o.size > bottom;
        const noHyphen = lastInColumn && this.o.hyphenateAcrossColumns === false;
        const { end, hyphenated } = this.breakLine(chars, start, max, (k) => advance(chars[k]!) + ((track[k] ?? 0) * this.o.size) / 1000, noHyphen);
        let last = end - 1;
        while (last > start && chars[last] === ' ') last--;
        out.push({ paragraph, line, lastVisible: last, hyphenated, slot });
        start = end;
        while (start < chars.length && chars[start] === ' ') start++;
        line++;
        storyLine++;
        y = baseline;
      }
    });
    return out;
  }

  private trackOf(_chars: string[], _k: number): number {
    return 0;
  }

  /** Greedy: the last break that fits within max (+ tolerance). Returns one past the line's last character. */
  private breakLine(chars: string[], start: number, max: number, adv: (k: number) => number, noHyphen = false): { end: number; hyphenated: boolean } {
    const limit = max + this.o.tolerance;
    let width = 0;
    let best: { end: number; hyphenated: boolean } | undefined;
    let wordStart = start;
    for (let k = start; k < chars.length; k++) {
      const c = chars[k]!;
      if (c === '\n' || c === '\u2028') return { end: k + 1, hyphenated: false };
      // After a discretionary line break (U+200B), no hyphen.
      if (k > start && chars[k - 1] === '\u200b' && width <= limit) best = { end: k, hyphenated: false };
      if (c === ' ') {
        if (width <= limit) best = { end: k, hyphenated: false };
        else break;
        wordStart = k + 1;
      } else if (k > wordStart && chars[k - 1] === '-' && /\p{L}/u.test(c) && /\p{L}/u.test(chars[k - 2] ?? '')) {
        // After a typed hyphen in a compound, unless this compound refuses it.
        let a = wordStart;
        let e = k;
        while (e < chars.length && /[\p{L}-]/u.test(chars[e]!)) e++;
        while (a < k && !/\p{L}/u.test(chars[a]!)) a++;
        const compound = chars.slice(a, e).join('');
        if (width <= limit && !this.o.refusesAfterHyphen?.(compound, k - a)) best = { end: k, hyphenated: false };
      } else if (k > wordStart) {
        // Hyphenation point before chars[k]?
        const wordEnd = (() => { let e = k; while (e < chars.length && /\p{L}/u.test(chars[e]!)) e++; return e; })();
        const word = chars.slice(wordStart, wordEnd).join('');
        if (!noHyphen && /^\p{L}+$/u.test(word) && this.o.accepts(word, this.o.language).includes(k - wordStart) && width + HYPHEN + this.trackOf(chars, k) <= limit) best = { end: k, hyphenated: true };
      }
      width += adv(k);
      if (width > limit && best) return best;
    }
    if (width <= limit) return { end: chars.length, hyphenated: false };
    return best ?? { end: Math.max(start + 1, chars.length), hyphenated: false };
  }
}
