import { describe, expect, it } from 'vitest';
import { ParagraphMetrics, type Item } from '../src/index.ts';
import { words } from './helpers.ts';

const metrics = (items: Item[], hyphenation: 'safe' | 'normal' = 'safe', hyphenCountsTowardWidth = true) =>
  new ParagraphMetrics(items, { hyphenation, hyphenCountsTowardWidth });

describe('ParagraphMetrics', () => {
  // items: 0 box "ab" | 1 glue | 2 box "cde" | 3 pen | 4 box "fg" | 5 glue | 6 box "h"
  const items = words('ab cde|fg h');

  it('lists glue and hyphen breaks plus the paragraph end', () => {
    expect(metrics(items).candidates).toEqual([1, 3, 5, 7]);
  });

  it('measures lines with and without the hyphen', () => {
    const m = metrics(items);
    expect(m.geometry(-1, 3)).toEqual({ start: 0, end: 3, width: 10 + 2.5 + 15 + 3, ink: 10 + 2.5 + 15 + 3 });
    const hanging = metrics(items, 'safe', false);
    expect(hanging.geometry(-1, 3).width).toBe(27.5);
    expect(hanging.geometry(-1, 3).ink).toBe(30.5);
  });

  it('starts the next line after the break and strips the final space', () => {
    const m = metrics(items);
    expect(m.lineStart(1)).toBe(2);
    expect(m.lineStart(3)).toBe(4);
    expect(m.geometry(5, 7)).toMatchObject({ start: 6, end: 7, width: 5 });
  });

  it('never plans at vetoed points, and at class C only in Normal mode', () => {
    const x = words('abc|def', { quality: 'X' });
    const c = words('abc|def', { quality: 'C' });
    expect(metrics(x, 'normal').candidates).toEqual([3]);
    expect(metrics(c, 'safe').candidates).toEqual([3]);
    expect(metrics(c, 'normal').candidates).toEqual([1, 3]);
    // The composer could still take them, so steering must account for them.
    expect(metrics(x).potential).toEqual([1, 3]);
  });

  it('does not break at non-breaking spaces', () => {
    const it: Item[] = [
      { type: 'box', width: 10 },
      { type: 'glue', width: 2, noBreak: true },
      { type: 'box', width: 10 },
    ];
    expect(metrics(it).candidates).toEqual([3]);
  });

  it('reports the width of the next possible break for steering', () => {
    const m = metrics(items);
    // After "ab", the next potential break is the hyphen in "cde-".
    expect(m.nextInk(-1, 1)).toBe(10 + 2.5 + 15 + 3);
    expect(m.nextInk(-1, 7)).toBe(Infinity);
  });

  it('renders line text with a hyphen', () => {
    const m = metrics(items);
    const g = m.geometry(-1, 3);
    expect(m.text(g.start, g.end, 3)).toBe('ab cde-');
  });
});
