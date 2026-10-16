import { describe, expect, it } from 'vitest';
import { buildParagraph, solveParagraph, type FlatterSettings, type Item } from '../src/index.ts';
import { every3, GERMAN_SAMPLE, mono, words } from './helpers.ts';

// Measure 100, Flatterzone 30, band 5: long lines 95–100, short lines 65–70.
const base: FlatterSettings = { measure: 100, flatterzone: 30, band: 5 };
const track = (max = 5, emSize = 50): FlatterSettings => ({ ...base, tracking: { enabled: true, max, emSize } });

describe('tracking assist (Laufweite)', () => {
  // Line 1 is 92.5 wide: 2.5 pt short of the long band. Nothing else fits.
  const loose = words('aaaaaaaaa bbbbbbbbb ccccccccccccc dddd');

  it('is off by default', () => {
    const plan = solveParagraph(loose, base);
    expect(plan.feasible).toBe(false);
    expect(plan.lines.every((l) => l.tracking === 0)).toBe(true);
  });

  it('rescues a line that just misses its band, with the smallest whole value', () => {
    const plan = solveParagraph(loose, track());
    expect(plan.feasible).toBe(true);
    expect(plan.solvedAs).toBe('strict');
    // 19 characters × 50 pt / 1000 = 0.95 pt per unit; 2.5 pt short needs 3 units.
    expect(plan.lines[0]!.tracking).toBe(3);
    expect(plan.lines[0]!.width).toBeCloseTo(92.5 + 3 * 0.95);
    expect(plan.lines.slice(1).every((l) => l.tracking === 0)).toBe(true);
    expect(plan.violations).toContainEqual(expect.objectContaining({ kind: 'tracking', severity: 'info', line: 0 }));
    expect(plan.stats.trackedLines).toBe(1);
  });

  it('respects the maximum', () => {
    const plan = solveParagraph(loose, track(2));
    expect(plan.feasible).toBe(false);
    expect(plan.lines.every((l) => Math.abs(l.tracking) <= 2)).toBe(true);
  });

  it('tightens a line that is slightly too long for its band', () => {
    // Line 2 is 71 wide: 1 pt too long for the short band (65–70), and nothing else fits there.
    const items: Item[] = [
      ...words('aaaaaaaaaaaaaaaaaaa'),
      { type: 'glue', width: 2.5 },
      { type: 'box', width: 71, text: 'c'.repeat(14), wordStart: true, wordEnd: true },
      { type: 'glue', width: 2.5 },
      ...words('eeeeeeeeeeeeeeeeeee ffff'),
    ];
    expect(solveParagraph(items, base).feasible).toBe(false);
    const plan = solveParagraph(items, track());
    expect(plan.feasible).toBe(true);
    expect(plan.lines[1]!.tracking).toBeLessThan(0);
    expect(plan.lines[1]!.width).toBeLessThanOrEqual(70 + 1e-9);
  });

  it('lets a line fit the measure by tightening', () => {
    // 101 pt of text cannot make a long line untracked; tightened it can.
    const items: Item[] = [
      { type: 'box', width: 101, text: 'x'.repeat(20), wordStart: true, wordEnd: true },
      { type: 'glue', width: 2.5 },
      { type: 'box', width: 67, text: 'y'.repeat(13), wordStart: true, wordEnd: true },
      { type: 'glue', width: 2.5 },
      ...words('zzzz'),
    ];
    const plan = solveParagraph(items, track());
    expect(plan.feasible).toBe(true);
    expect(plan.lines[0]!.tracking).toBeLessThan(0);
    expect(plan.lines[0]!.width).toBeLessThanOrEqual(100 + 1e-9);
  });

  it('is never used when the paragraph works without it', () => {
    const sample = buildParagraph(GERMAN_SAMPLE, { measure: mono, hyphenate: every3() });
    const plain = solveParagraph(sample, { measure: 300 });
    const tracked = solveParagraph(sample, { measure: 300, tracking: { enabled: true, max: 10, emSize: 10 } });
    expect(plain.feasible).toBe(true);
    expect(tracked.lines).toEqual(plain.lines);
  });

  it('prefers tracking over flipping the requested phase', () => {
    const plan = solveParagraph(loose, track());
    expect(plan.phaseFlipped).toBe(false);
    expect(plan.startRole).toBe('long');
  });

  it('requires the em size when enabled', () => {
    expect(() => solveParagraph(loose, { ...base, tracking: { enabled: true } })).toThrow(RangeError);
  });
});
