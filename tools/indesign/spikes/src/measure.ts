/**
 * Build solver items from InDesign's own measurements: the paragraph is set on
 * one very wide line, and every fragment's width comes from character offsets.
 */
import type { HyphenClass, Item } from '@flatter/core';
import { asArray, textFrame, type Any, type TextSetup } from './lib.ts';

export interface Measured {
  items: Item[];
  /** For each item: [first story character, one past the last]. */
  charRange: [number, number][];
  hyphenWidth: number;
  xHeight: number;
}

export function measureParagraph(
  doc: Any,
  y: number,
  text: string,
  setup: TextSetup,
  hyphenate?: (word: string) => { index: number; quality: HyphenClass }[],
): Measured {
  const wide = textFrame(doc, [y, 20, y + 40, 20 + 9000], text + ' x-', { ...setup, hyphenation: false });
  const story = wide.parentStory;
  const xs: number[] = asArray(story.characters.everyItem().horizontalOffset).map(Number);
  const xe: number[] = asArray(story.characters.everyItem().endHorizontalOffset).map(Number);
  const n = text.length;
  const hyphenWidth = xe[n + 2]! - xs[n + 2]!;
  // x-height from the font's metrics: InDesign does not expose it, so use the text frame's baseline and a lowercase 'x' outline.
  const xHeight = (setup.size ?? 10) * 0.45;
  const width = (a: number, b: number) => xe[b - 1]! - xs[a]!;
  const items: Item[] = [];
  const charRange: [number, number][] = [];
  const re = /\S+|\s+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const s = m.index;
    const e = s + m[0].length;
    if (/^\s+$/.test(m[0])) {
      items.push({ type: 'glue', width: width(s, e) });
      charRange.push([s, e]);
      continue;
    }
    const word = m[0];
    const lead = word.match(/^[^\p{L}]*/u)![0].length;
    const trail = word.match(/[^\p{L}]*$/u)![0].length;
    const core = word.slice(lead, word.length - trail);
    const points = hyphenate && /^\p{L}+$/u.test(core) ? hyphenate(core).map((p) => ({ at: lead + p.index, q: p.quality })) : [];
    const key = core.toLowerCase();
    let from = 0;
    points.forEach((p, i) => {
      items.push({ type: 'box', width: width(s + from, s + p.at), text: word.slice(from, p.at), wordKey: key, ...(i === 0 ? { wordStart: true } : {}) });
      charRange.push([s + from, s + p.at]);
      items.push({ type: 'penalty', width: hyphenWidth, flagged: true, quality: p.q });
      charRange.push([s + p.at, s + p.at]);
      from = p.at;
    });
    items.push({ type: 'box', width: width(s + from, e), text: word.slice(from), wordKey: key, wordEnd: true, ...(points.length === 0 ? { wordStart: true } : {}) });
    charRange.push([s + from, e]);
  }
  return { items, charRange, hyphenWidth, xHeight };
}
