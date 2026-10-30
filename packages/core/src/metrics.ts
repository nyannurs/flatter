/**
 * Precomputed line geometry for one paragraph.
 *
 * Break positions are item indices. A break at a glue item ends the line
 * before that glue. A break at a penalty ends the line before the penalty and
 * adds the penalty width (the hyphen). The paragraph end is the virtual break
 * position `n` (= items.length). The paragraph start is the virtual break `-1`.
 */
import type { Item, Penalty } from './items.ts';
import type { HyphenationMode } from './params.ts';

export interface LineGeometry {
  /** First content item of the line. */
  start: number;
  /** One past the last content item of the line. */
  end: number;
  /** Width used for band checks (excludes a hanging hyphen). */
  width: number;
  /** Visible width including the hyphen. */
  ink: number;
}

const LETTER = /\p{L}/gu;

export class ParagraphMetrics {
  readonly items: readonly Item[];
  readonly n: number;
  /** prefix[k] = summed width of boxes and glue in items[0..k). */
  private readonly prefix: Float64Array;
  /** Letters in boxes of items[0..k). */
  private readonly letterPrefix: Int32Array;
  /** Glue items in items[0..k). */
  private readonly gluePrefix: Int32Array;
  /** Characters in items[0..k): box text plus one per space. Tracking applies to each. */
  private readonly charPrefix: Int32Array;
  /** Prefix sums of Box.trackedExtra. */
  private readonly extraPrefix: Float64Array;
  /** Breaks the solver may choose, ascending, ending with n. */
  candidates: number[];
  /** Breaks a composer might take regardless of our vetoes, ascending, ending with n. */
  readonly potential: number[];
  private readonly hyphenCountsTowardWidth: boolean;

  constructor(
    items: readonly Item[],
    opts: { hyphenation: HyphenationMode; hyphenCountsTowardWidth: boolean; senseFirst?: boolean },
    /** Restrict the candidates to these breaks (to score one given set of breaks). */
    only?: readonly number[],
  ) {
    this.items = items;
    this.n = items.length;
    this.hyphenCountsTowardWidth = opts.hyphenCountsTowardWidth;
    this.prefix = new Float64Array(this.n + 1);
    this.letterPrefix = new Int32Array(this.n + 1);
    this.gluePrefix = new Int32Array(this.n + 1);
    this.charPrefix = new Int32Array(this.n + 1);
    this.extraPrefix = new Float64Array(this.n + 1);
    this.candidates = [];
    this.potential = [];
    for (let k = 0; k < this.n; k++) {
      const it = items[k]!;
      const w = it.type === 'penalty' ? 0 : it.width;
      if (!Number.isFinite(w)) throw new RangeError(`item ${k} has a non-finite width`);
      this.prefix[k + 1] = this.prefix[k]! + w;
      this.extraPrefix[k + 1] = this.extraPrefix[k]! + (it.type === 'box' ? (it.trackedExtra ?? 0) : 0);
      this.letterPrefix[k + 1] =
        this.letterPrefix[k]! + (it.type === 'box' && it.text ? (it.text.match(LETTER)?.length ?? 0) : 0);
      this.gluePrefix[k + 1] = this.gluePrefix[k]! + (it.type === 'glue' ? 1 : 0);
      this.charPrefix[k + 1] =
        this.charPrefix[k]! + (it.type === 'glue' ? 1 : it.type === 'box' && it.text ? [...it.text].length : 0);
      if (this.isPotentialBreak(k)) this.potential.push(k);
      if (this.isCandidateBreak(k, opts.hyphenation, opts.senseFirst ?? false)) this.candidates.push(k);
    }
    this.candidates.push(this.n);
    this.potential.push(this.n);
    if (only) this.candidates = [...new Set(only.filter((b) => b >= 0 && b < this.n)), this.n].sort((x, y) => x - y);
  }

  /** A break a greedy composer could take (we cannot veto it by steering alone). */
  private isPotentialBreak(k: number): boolean {
    const it = this.items[k]!;
    if (it.type === 'glue') return !it.noBreak && this.items[k - 1]?.type === 'box';
    return it.type === 'penalty';
  }

  /** A break the solver is allowed to plan. Correctness rules are never relaxed. */
  private isCandidateBreak(k: number, mode: HyphenationMode, senseFirst: boolean): boolean {
    const it = this.items[k]!;
    // Sense first: never inside a unit of meaning (a space that carries a Sinneinheiten cost).
    if (it.type === 'glue') return !it.noBreak && this.items[k - 1]?.type === 'box' && !(senseFirst && (it.breakCost ?? 0) > 0);
    if (it.type !== 'penalty') return false;
    if (it.forced) return true;
    if (it.quality === 'X') return false;
    if (it.quality === 'C') return mode === 'normal';
    return true;
  }

  isForced(b: number): boolean {
    const it = this.items[b];
    return it?.type === 'penalty' && it.forced === true;
  }

  /** The penalty at break position b, if the break is at a penalty. */
  penaltyAt(b: number): Penalty | undefined {
    const it = this.items[b];
    return it?.type === 'penalty' ? it : undefined;
  }

  /** True when breaking at b leaves a visible hyphen at the line end. */
  isFlagged(b: number): boolean {
    return this.penaltyAt(b)?.flagged === true;
  }

  /** First content item of a line that follows break a. */
  lineStart(a: number): number {
    if (a < 0) return 0;
    let k = a + 1;
    while (k < this.n) {
      const it = this.items[k]!;
      if (it.type === 'box') break;
      if (it.type === 'penalty' && it.forced) break;
      k++;
    }
    return k;
  }

  /** One past the last content item of a line ending at break b. */
  contentEnd(b: number): number {
    if (b < this.n) return b;
    let k = this.n;
    while (k > 0 && this.items[k - 1]!.type !== 'box') k--;
    return k;
  }

  geometry(a: number, b: number): LineGeometry {
    const start = this.lineStart(a);
    const end = Math.max(start, this.contentEnd(b));
    const base = this.prefix[end]! - this.prefix[start]!;
    const pen = b < this.n ? (this.penaltyAt(b)?.width ?? 0) : 0;
    const ink = base + pen;
    return { start, end, width: this.hyphenCountsTowardWidth ? ink : base, ink };
  }

  /** Width of the content from start to end, ignoring any hyphen. */
  contentWidth(start: number, end: number): number {
    return end > start ? this.prefix[end]! - this.prefix[start]! : 0;
  }

  letters(start: number, end: number): number {
    return end > start ? this.letterPrefix[end]! - this.letterPrefix[start]! : 0;
  }

  /**
   * How many tracking steps move the line's end. Tracking is applied to every character of the line
   * except the last one: InDesign also counts the tracking after a line's last glyph when it decides
   * whether the line fits, so tracking that last glyph would make a line planned to the edge too wide
   * (found in the user's test, 2026-10-16). A line of n characters therefore gains n − 1 steps, and the
   * generated hyphen, inheriting the untracked last letter, adds none.
   */
  /** Extra width items start…end take on when tracked (ligatures break apart, see Box.trackedExtra). */
  trackedExtra(start: number, end: number): number {
    return end > start ? this.extraPrefix[end]! - this.extraPrefix[start]! : 0;
  }

  trackedChars(start: number, end: number, _b: number): number {
    const base = end > start ? this.charPrefix[end]! - this.charPrefix[start]! : 0;
    return Math.max(0, base - 1);
  }

  glueCount(start: number, end: number): number {
    return end > start ? this.gluePrefix[end]! - this.gluePrefix[start]! : 0;
  }

  /**
   * Smallest visible width the line starting after `a` would have if the
   * composer broke at any later potential break than `b`. Steering must stay
   * below this so the composer cannot take one more fragment.
   */
  nextInk(a: number, b: number, trackPerChar = 0, trackPerSpace = 0): number {
    if (b >= this.n || this.isForced(b)) return Infinity;
    const start = this.lineStart(a);
    let lo = 0;
    let hi = this.potential.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.potential[mid]! <= b) lo = mid + 1;
      else hi = mid;
    }
    let best = Infinity;
    for (let i = lo; i < this.potential.length; i++) {
      const p = this.potential[i]!;
      const end = this.contentEnd(p);
      const pen = p < this.n ? (this.penaltyAt(p)?.width ?? 0) : 0;
      // The next fragment would carry the line's tracking too.
      const tracked =
        (trackPerChar !== 0 ? trackPerChar * this.trackedChars(start, end, p) + this.trackedExtra(start, end) : 0) +
        trackPerSpace * this.glueCount(start, end);
      best = Math.min(best, this.contentWidth(start, end) + pen + tracked);
      if (p >= this.n || this.items[p]!.type === 'glue' || this.isForced(p)) break;
    }
    return best;
  }

  /** Visible text of a line, with a trailing hyphen when the break adds one. */
  text(start: number, end: number, b: number): string {
    let s = '';
    for (let k = start; k < end; k++) {
      const it = this.items[k]!;
      if (it.type === 'box') s += it.text ?? '□';
      else if (it.type === 'glue') s += it.noBreak ? '\u00a0' : ' ';
    }
    const pen = b < this.n ? this.penaltyAt(b) : undefined;
    if (pen?.flagged && pen.width > 0) s += '-';
    return s;
  }
}
