import { describe, expect, it } from 'vitest';
import type { Plan, PlannedLine } from '@flatter/core';
import { bandsFor, checkParagraph, checkStory, itemsFromMeasured, mergePoints, toothFor, type LineSlot } from '../src/index.ts';

const adv = (s: string) => [...s].map((c) => (c === ' ' ? 2.5 : 5));

describe('itemsFromMeasured', () => {
  it('builds boxes and glue from character advances', () => {
    const chars = [...'Ein Satz'];
    const m = itemsFromMeasured(chars, adv('Ein Satz'), { hyphenWidth: 3 });
    expect(m.items.map((i) => i.type)).toEqual(['box', 'glue', 'box']);
    expect(m.items[0]).toMatchObject({ width: 15, text: 'Ein' });
    expect(m.charRange).toEqual([[0, 3], [3, 4], [4, 8]]);
  });

  it('gives boxes the extra width their ligatures gain when tracked', () => {
    const chars = [...'The fox'];
    // "Th" set as a ligature is 1 pt narrower than the two letters InDesign sets in tracked text.
    const set = adv('The fox');
    set[0] = 4;
    const m = itemsFromMeasured(chars, set, { hyphenWidth: 3, trackedAdvances: adv('The fox') });
    expect(m.items[0]).toMatchObject({ text: 'The', width: 14, trackedExtra: 1 });
    expect(m.items[2]).not.toHaveProperty('trackedExtra');
  });

  it('keeps no-break spaces unbreakable and turns forced line breaks into forced penalties', () => {
    const chars = [...'10\u00a0kg Text\nNeu'];
    const m = itemsFromMeasured(chars, adv('10 kg Text Neu'), { hyphenWidth: 3 });
    expect(m.items[1]).toMatchObject({ type: 'glue', noBreak: true });
    expect(m.items.find((i) => i.type === 'penalty')).toMatchObject({ forced: true });
  });

  it('uses only discretionary hyphens when the word has them', () => {
    const word = 'Wach\u00adstube';
    const m = itemsFromMeasured([...word], [...word].map((c) => (c === '\u00ad' ? 0 : 5)), { hyphenWidth: 3, points: () => [{ index: 2, quality: 'B' }] });
    const pens = m.items.filter((i) => i.type === 'penalty');
    expect(pens).toHaveLength(1);
    expect(pens[0]).toMatchObject({ flagged: true, quality: 'A' });
  });

  it('breaks words with an existing hyphen after it, adding no glyph', () => {
    const m = itemsFromMeasured([...'E-Mail'], adv('E-Mail'), { hyphenWidth: 3 });
    expect(m.items.filter((i) => i.type === 'penalty')).toEqual([{ type: 'penalty', width: 0, flagged: true }]);
  });

  it('adds hyphenation points with the hyphen width and keeps total widths', () => {
    const m = itemsFromMeasured([...'Flattersatz'], adv('Flattersatz'), { hyphenWidth: 3, points: () => [{ index: 7, quality: 'A' }] });
    expect(m.items).toHaveLength(3);
    expect(m.items[1]).toMatchObject({ type: 'penalty', width: 3, quality: 'A' });
    expect(m.items.filter((i) => i.type === 'box').reduce((s, b) => s + b.width, 0)).toBe(55);
  });

  it('attaches Sinneinheiten costs to the space before the next word', () => {
    const m = itemsFromMeasured([...'der Hund'], adv('der Hund'), { hyphenWidth: 3, breakCost: (a) => (a === 'der' ? { cost: 30, reason: 'article' } : null) });
    expect(m.items[1]).toMatchObject({ type: 'glue', breakCost: 30 });
  });

  it('flags tabs as unsupported', () => {
    expect(itemsFromMeasured([...'a\tb'], [5, 10, 5], { hyphenWidth: 3 }).unsupported).toEqual(['tab']);
  });

  it('rejects mismatched input', () => {
    expect(() => itemsFromMeasured(['a'], [], { hyphenWidth: 3 })).toThrow(RangeError);
  });
});

describe('mergePoints (spike S3)', () => {
  const ours = [
    { index: 2, quality: 'A' as const },
    { index: 4, quality: 'B' as const },
    { index: 6, quality: 'C' as const },
    { index: 8, quality: 'X' as const },
  ];
  it('keeps agreed points, demotes InDesign-only points to C, keeps vetoes, drops refused points', () => {
    expect(mergePoints(ours, [2, 6, 8, 9])).toEqual([
      { index: 2, quality: 'A' },
      { index: 6, quality: 'C' },
      { index: 8, quality: 'X' },
      { index: 9, quality: 'C' },
    ]);
  });
  it('uses our classification when InDesign was not probed', () => {
    expect(mergePoints(ours, undefined)).toEqual(ours);
  });
});

describe('toothFor', () => {
  const slot: LineSlot = { page: 0, baseline: 100, startX: 20, columnRight: 320, gutter: 12, size: 10 };
  const line = (kind: PlannedLine['kind'], steerWidth: number) => ({ kind, steerWidth }) as PlannedLine;

  it('places a thin tooth from the steering width to just past the column edge', () => {
    const t = toothFor(line('band', 250), slot, 0, 3)!;
    expect(t.bounds[1]).toBe(270);
    expect(t.bounds[3]).toBe(322);
    expect(t.bounds[2] - t.bounds[0]).toBeCloseTo(0.1);
    expect((t.bounds[0] + t.bounds[2]) / 2).toBeCloseTo(100 - 2.25);
    expect(t).toMatchObject({ paragraph: 0, line: 3 });
  });

  it('never reaches more than half the gutter into the next column', () => {
    expect(toothFor(line('band', 250), { ...slot, gutter: 2 }, 0, 0)!.bounds[3]).toBeCloseTo(320.9);
  });

  it('skips last lines, forced lines and lines steered to the full measure', () => {
    expect(toothFor(line('last', 100), slot, 0, 0)).toBeUndefined();
    expect(toothFor(line('forced', 100), slot, 0, 0)).toBeUndefined();
    expect(toothFor(line('band', 300), slot, 0, 0)).toBeUndefined();
  });
});

describe('settings', () => {
  it('lists what a paragraph needs changed', () => {
    const issues = checkParagraph(0, { composer: 'Adobe Paragraph Composer', justification: 'LEFT_ALIGN', hyphenationZone: 36, providerHyphenationStyle: 'HYPH_ALL', hyphenateCapitalizedWords: false }, 'German: 2006 Reform');
    expect(issues.map((i) => i.attribute).sort()).toEqual(['composer', 'hyphenateCapitalizedWords', 'hyphenationZone', 'providerHyphenationStyle']);
    expect(issues.find((i) => i.attribute === 'composer')).toMatchObject({ required: true, fix: 'Adobe Single-line Composer' });
  });

  it('does not ask English paragraphs for a Duden style', () => {
    expect(checkParagraph(0, { providerHyphenationStyle: 'HYPH_ALL', hyphenateCapitalizedWords: false }, 'English: USA')).toEqual([]);
  });

  it('reports story conditions found in spike S6', () => {
    expect(checkStory({ opticalMarginAlignment: true, ignoresWrap: true, wrapOnlyBeneath: true, controlLayerNotOnTop: true, overset: false })).toHaveLength(3);
    expect(checkStory({ opticalMarginAlignment: false, ignoresWrap: false, wrapOnlyBeneath: true, controlLayerNotOnTop: false, overset: false })).toEqual([]);
  });
});

describe('bandsFor', () => {
  const slot = (page: number, baseline: number, startX = 40): LineSlot => ({ page, baseline, startX, columnRight: 240, gutter: 12, size: 10 });
  const plan = (available: number[]) =>
    ({ params: { band: 10, flatterzone: 30 }, lines: available.map((a) => ({ available: a })) }) as unknown as Plan;

  it('draws a long and a short strip per stretch of lines in one column', () => {
    const bands = bandsFor(plan([200, 200, 200]), [slot(0, 100), slot(0, 112), slot(0, 124)], 12);
    expect(bands).toHaveLength(2);
    expect(bands[0]).toMatchObject({ kind: 'long', page: 0 });
    // Measure ends at 40 + 200: long band 230–240, short band 200–210.
    expect(bands[0]!.bounds[1]).toBeCloseTo(230);
    expect(bands[0]!.bounds[3]).toBeCloseTo(240);
    expect(bands[1]!.bounds[1]).toBeCloseTo(200);
    expect(bands[1]!.bounds[3]).toBeCloseTo(210);
    // From above the first line to below the last.
    expect(bands[0]!.bounds[0]).toBeLessThan(100 - 8);
    expect(bands[0]!.bounds[2]).toBeGreaterThan(124);
  });

  it('starts new strips in the next frame and leaves out overset lines', () => {
    const bands = bandsFor(plan([200, 200, 200, 200]), [slot(0, 100), slot(0, 112), slot(1, 50), undefined], 12);
    expect(bands.map((b) => `${b.kind}@${b.page}`)).toEqual(['long@0', 'short@0', 'long@1', 'short@1']);
  });

  it('uses each line\'s own start, so a first-line indent does not shift the measure', () => {
    // First line indented by 10: starts at 50 with 190 available; the measure still ends at 240.
    const bands = bandsFor(plan([190, 200]), [slot(0, 100, 50), slot(0, 112, 40)], 12);
    expect(bands[0]!.bounds[3]).toBeCloseTo(240);
  });
});
