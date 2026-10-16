import { describe, expect, it } from 'vitest';
import { buildParagraph, type Box, type Item, type Penalty } from '../src/index.ts';
import { every3, mono } from './helpers.ts';

const boxes = (items: Item[]) => items.filter((i): i is Box => i.type === 'box').map((b) => b.text);
const penalties = (items: Item[]) => items.filter((i): i is Penalty => i.type === 'penalty');

describe('buildParagraph', () => {
  it('turns words and spaces into boxes and glue', () => {
    const items = buildParagraph('Ein Satz  hier.', { measure: mono });
    expect(items.map((i) => i.type)).toEqual(['box', 'glue', 'box', 'glue', 'box']);
    expect(boxes(items)).toEqual(['Ein', 'Satz', 'hier.']);
    expect(items[2]).toMatchObject({ wordKey: 'satz', wordStart: true, wordEnd: true });
  });

  it('keeps non-breaking spaces unbreakable and turns newlines into forced breaks', () => {
    const items = buildParagraph('10 kg Mehl\nZeile', { measure: mono });
    expect(items[1]).toMatchObject({ type: 'glue', noBreak: true });
    expect(items[5]).toMatchObject({ type: 'penalty', forced: true });
  });

  it('hyphenates eligible words at the hyphenator points', () => {
    const items = buildParagraph('Flattersatz', { measure: mono, hyphenate: every3() });
    expect(boxes(items)).toEqual(['Fla', 'tte', 'rsatz']);
    expect(penalties(items).every((p) => p.flagged && p.quality === 'B')).toBe(true);
  });

  it('respects the 2-before / 3-after rule and the minimum word length', () => {
    const hy = () => [
      { index: 1, quality: 'B' as const },
      { index: 2, quality: 'B' as const },
      { index: 5, quality: 'B' as const },
    ];
    expect(boxes(buildParagraph('abcdefg', { measure: mono, hyphenate: hy }))).toEqual(['ab', 'cdefg']);
    expect(boxes(buildParagraph('abcde', { measure: mono, hyphenate: hy }))).toEqual(['abcde']);
  });

  it('never hyphenates numbers, all-caps words or (in English) capitalised words', () => {
    const opts = { measure: mono, hyphenate: every3() };
    expect(boxes(buildParagraph('1234567890', opts))).toHaveLength(1);
    expect(boxes(buildParagraph('UNESCOWELT', opts))).toHaveLength(1);
    expect(boxes(buildParagraph('Washington', { ...opts, language: 'en' }))).toHaveLength(1);
    expect(boxes(buildParagraph('Washington', { ...opts, language: 'de' })).length).toBeGreaterThan(1);
  });

  it('breaks words with an existing hyphen only after that hyphen', () => {
    const items = buildParagraph('E-Mail-Adresse', { measure: mono, hyphenate: every3() });
    expect(boxes(items)).toEqual(['E-', 'Mail-', 'Adresse']);
    expect(penalties(items)).toEqual([
      { type: 'penalty', width: 0, flagged: true },
      { type: 'penalty', width: 0, flagged: true },
    ]);
  });

  it('uses only discretionary hyphens when the text has them', () => {
    const items = buildParagraph('Wach­stube', { measure: mono, hyphenate: every3() });
    expect(boxes(items)).toEqual(['Wach', 'stube']);
    expect(penalties(items)[0]).toMatchObject({ flagged: true, quality: 'A' });
  });

  it('keeps kerning by measuring each fragment from the word start', () => {
    // Kerning-like measure: "AV" is 2 pt tighter than its parts.
    const kern = (s: string) => mono(s) - 2 * (s.match(/AV/g)?.length ?? 0);
    const items = buildParagraph('xxAVxxyy', { measure: kern, hyphenate: () => [{ index: 3, quality: 'B' }] });
    const total = items.filter((i) => i.type === 'box').reduce((s, b) => s + b.width, 0);
    expect(total).toBeCloseTo(kern('xxAVxxyy'));
  });

  it('marks hyphens before a dash, parenthesis or quote as costly', () => {
    const items = buildParagraph('Verständnis (siehe oben)', { measure: mono, hyphenate: every3() });
    expect(penalties(items).every((p) => (p.cost ?? 0) > 0 && p.reason)).toBe(true);
  });

  it('applies a Sinneinheiten break-cost rule to spaces', () => {
    const items = buildParagraph('der Hund bellt', {
      measure: mono,
      breakCost: (before) => (before === 'der' ? { cost: 30, reason: 'Line ends on an article.' } : null),
    });
    expect(items[1]).toMatchObject({ type: 'glue', breakCost: 30, breakReason: 'Line ends on an article.' });
    expect(items[3]).toEqual({ type: 'glue', width: 2.5 });
  });
});
