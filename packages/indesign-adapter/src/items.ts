/**
 * Build solver items from what InDesign measured: the paragraph's characters
 * and each character's advance (endHorizontalOffset − horizontalOffset, read in
 * place from the composed story). Pure: no InDesign APIs, tested in Node.
 */
import type { BreakCostRule, HyphenClass, Item } from '@flatter/core';

export interface PointSource {
  /**
   * Hyphenation points of a bare word (letters only), already merged with InDesign's (see mergePoints). `at` is the
   * word's first character in the paragraph, so words in another language can be told apart.
   */
  (word: string, at: number): { index: number; quality: HyphenClass }[];
}

export interface BuildFromMeasuredOptions {
  /** Width of a hyphen in this paragraph's font and size. */
  hyphenWidth: number;
  points?: PointSource;
  breakCost?: BreakCostRule;
  /** Advances with ligatures broken up (tracked text); boxes get the difference as trackedExtra. */
  trackedAdvances?: readonly number[];
  /**
   * For a compound with typed hyphens (letters only around them, e.g. "master-builder"): the positions
   * after a hyphen where InDesign will break, or undefined when unknown (then every hyphen is a break).
   * With hyphenation on, InDesign refuses some of them and hyphenates a part instead ("mas-ter-builder",
   * measured 2026-10-17).
   */
  hardBreaks?: (compound: string) => number[] | undefined;
}

export interface MeasuredParagraph {
  items: Item[];
  /** For each item: [first character, one past the last], relative to the paragraph start. */
  charRange: [number, number][];
  /** Characters the builder cannot handle in this version (tabs, anchored objects). */
  unsupported: string[];
}

const BREAKABLE_SPACE = /^[ \u2002\u2003\u2004\u2005\u2006\u2008\u2009\u200a]$/;
const NO_BREAK_SPACE = /^[\u00a0\u202f\u2007]$/;
const FORCED_BREAK = /^[\n\u2028]$/;
const SPACE = /^[ \u2002-\u200a\u00a0\u202f\u2007]$/;
const DISCRETIONARY = '\u00ad';
/** InDesign's discretionary line break: a break opportunity without a hyphen (URLs, slashes). */
const DISCRETIONARY_LINE_BREAK = '\u200b';
/** InDesign may break after these without adding a hyphen. */
const BREAK_AFTER = /^[-–—]$/;
const LETTER = /\p{L}/u;

/**
 * chars: the paragraph's characters (one string per InDesign character, without the final return).
 * advances: their widths in points, same length.
 */
export function itemsFromMeasured(chars: readonly string[], advances: readonly number[], opts: BuildFromMeasuredOptions): MeasuredParagraph {
  if (chars.length !== advances.length) throw new RangeError(`chars (${chars.length}) and advances (${advances.length}) differ in length`);
  const items: Item[] = [];
  const charRange: [number, number][] = [];
  const unsupported: string[] = [];
  const width = (a: number, b: number) => {
    let w = 0;
    for (let k = a; k < b; k++) w += advances[k]!;
    return w;
  };
  const words: { start: number; end: number }[] = [];

  let k = 0;
  let prevWord: string | undefined;
  let pendingGlue: { index: number; start: number } | undefined;
  while (k < chars.length) {
    const c = chars[k]!;
    if (FORCED_BREAK.test(c)) {
      items.push({ type: 'penalty', width: 0, flagged: false, forced: true });
      charRange.push([k, k + 1]);
      prevWord = undefined;
      k++;
      continue;
    }
    if (c === '\t' || c === '\ufffc') {
      unsupported.push(c === '\t' ? 'tab' : 'anchored object');
      items.push({ type: 'box', width: advances[k]!, text: c });
      charRange.push([k, k + 1]);
      k++;
      continue;
    }
    if (SPACE.test(c)) {
      let e = k + 1;
      while (e < chars.length && SPACE.test(chars[e]!) && NO_BREAK_SPACE.test(chars[e]!) === NO_BREAK_SPACE.test(c)) e++;
      const noBreak = NO_BREAK_SPACE.test(c);
      items.push(noBreak ? { type: 'glue', width: width(k, e), noBreak: true } : { type: 'glue', width: width(k, e) });
      charRange.push([k, e]);
      if (!noBreak) pendingGlue = { index: items.length - 1, start: k };
      k = e;
      continue;
    }
    // A word: everything up to the next space or forced break.
    let e = k;
    while (e < chars.length && !SPACE.test(chars[e]!) && !FORCED_BREAK.test(chars[e]!) && chars[e] !== '\t' && chars[e] !== '\ufffc') e++;
    const word = chars.slice(k, e).join('');
    if (pendingGlue && prevWord !== undefined && opts.breakCost) {
      const extra = opts.breakCost(prevWord, word);
      if (extra && extra.cost > 0) items[pendingGlue.index] = { ...(items[pendingGlue.index] as Item & { type: 'glue' }), breakCost: extra.cost, breakReason: extra.reason };
    }
    pendingGlue = undefined;
    pushWord(k, e, word);
    words.push({ start: k, end: e });
    prevWord = word;
    k = e;
  }
  return { items, charRange, unsupported };

  function pushWord(start: number, end: number, word: string): void {
    const local = chars.slice(start, end);
    // Cut positions (relative to the word) with their penalty.
    const cuts = new Map<number, Item>();
    if (local.includes(DISCRETIONARY)) {
      // Discretionary hyphens set in the text: only these points.
      local.forEach((ch, i) => {
        if (ch === DISCRETIONARY && i > 0 && i < local.length - 1) cuts.set(i + 1, { type: 'penalty', width: opts.hyphenWidth, flagged: true, quality: 'A' });
      });
    } else {
      local.forEach((ch, i) => {
        if (i > 0 && i < local.length - 1 && BREAK_AFTER.test(ch) && LETTER.test(local[i - 1]!) && LETTER.test(local[i + 1]!)) {
          cuts.set(i + 1, { type: 'penalty', width: 0, flagged: ch === '-' });
        }
      });
      if (cuts.size && opts.hardBreaks) {
        const lead = word.match(/^[^\p{L}]*/u)![0].length;
        const trail = word.match(/[^\p{L}]*$/u)![0].length;
        const accepted = opts.hardBreaks(word.slice(lead, word.length - trail));
        if (accepted) for (const at of [...cuts.keys()]) if (!accepted.includes(at - lead)) cuts.delete(at);
      }
      if (cuts.size === 0 && opts.points) {
        const lead = word.match(/^[^\p{L}]*/u)![0].length;
        const trail = word.match(/[^\p{L}]*$/u)![0].length;
        const core = word.slice(lead, word.length - trail);
        if (/^\p{L}+$/u.test(core)) {
          for (const p of opts.points(core, start + lead)) cuts.set(lead + p.index, { type: 'penalty', width: opts.hyphenWidth, flagged: true, quality: p.quality });
        }
      }
    }
    // Discretionary line breaks: InDesign may break after them, with no hyphen (2026-10-30).
    local.forEach((ch, i) => {
      if (ch === DISCRETIONARY_LINE_BREAK && i < local.length - 1) cuts.set(i + 1, { type: 'penalty', width: 0, flagged: false });
    });
    const lead = word.match(/^[^\p{L}]*/u)![0].length;
    const trail = word.match(/[^\p{L}]*$/u)![0].length;
    const key = word.slice(lead, word.length - trail).toLowerCase() || undefined;
    const bounds = [...cuts.keys()].sort((a, b) => a - b);
    bounds.push(local.length);
    let from = 0;
    bounds.forEach((to, idx) => {
      const w = width(start + from, start + to);
      let extra = 0;
      if (opts.trackedAdvances) {
        for (let q = start + from; q < start + to; q++) extra += opts.trackedAdvances[q]!;
        extra -= w;
      }
      items.push({
        type: 'box',
        width: w,
        ...(Math.abs(extra) > 0.001 ? { trackedExtra: extra } : {}),
        text: local.slice(from, to).join(''),
        ...(key !== undefined ? { wordKey: key } : {}),
        ...(idx === 0 ? { wordStart: true } : {}),
        ...(idx === bounds.length - 1 ? { wordEnd: true } : {}),
      });
      charRange.push([start + from, start + to]);
      if (idx < bounds.length - 1) {
        items.push(cuts.get(to)!);
        charRange.push([start + to, start + to]);
      }
      from = to;
    });
  }
}

/**
 * Merge our classification with the points InDesign accepts (spike S3):
 * - InDesign accepts it and we rate it A/B: keep our class (usable in Safe mode).
 * - InDesign accepts it, we rate it C or never proposed it: class C (Normal mode only, but a potential break).
 * - InDesign accepts it and we veto it (X): X. The composer could still take it, so steering must know.
 * - InDesign refuses it: dropped; the composer can never break there.
 * Without probe data (indesign undefined) our classification is used as is (predict and verify).
 */
export function mergePoints(
  ours: readonly { index: number; quality: HyphenClass }[],
  indesign: readonly number[] | undefined,
): { index: number; quality: HyphenClass }[] {
  if (!indesign) return [...ours];
  const byIndex = new Map(ours.map((p) => [p.index, p.quality] as const));
  return [...new Set(indesign)]
    .sort((a, b) => a - b)
    .map((index) => {
      const q = byIndex.get(index);
      return { index, quality: q === 'A' || q === 'B' ? q : q === 'X' ? 'X' : 'C' } as const;
    });
}
