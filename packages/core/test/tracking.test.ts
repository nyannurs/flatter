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
    // 18 tracking steps (19 characters, tracking sits between them) × 50 pt / 1000 = 0.9 pt per unit; 2.5 pt short needs 3 units.
    expect(plan.lines[0]!.tracking).toBe(3);
    expect(plan.lines[0]!.width).toBeCloseTo(92.5 + 3 * 0.9);
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

describe('precise Laufweite (ADR-013)', () => {
  const sample = buildParagraph(GERMAN_SAMPLE, { measure: mono, hyphenate: every3() });
  const precise = (max: number, band = 6): FlatterSettings => ({ measure: 300, flatterzone: 60, band, tracking: { enabled: true, mode: 'precise', max, emSize: 10 } });

  it('puts every line end on its target unless the line needs more tracking than allowed', () => {
    for (const max of [5, 10, 30]) {
      const plan = solveParagraph(sample, precise(max, 20));
      expect(plan.feasible).toBe(true);
      for (const l of plan.lines.filter((x) => x.kind === 'band')) {
        const miss = Math.abs(l.available - l.targetWidth - l.gap);
        // A line not held back by the limit lands on its edge (0.01-unit steps).
        if (Math.abs(l.tracking) < max - 1e-9) expect(miss, `max ${max}: ${l.text}`).toBeLessThan(0.05);
      }
    }
  });

  it('never sets a line wider than the measure, and stays within the maximum', () => {
    for (const max of [1, 3, 10]) {
      const plan = solveParagraph(sample, precise(max, 20));
      for (const l of plan.lines) {
        expect(l.width).toBeLessThanOrEqual(l.available + 1e-6);
        expect(Math.abs(l.tracking)).toBeLessThanOrEqual(max + 1e-9);
      }
    }
  });

  it('makes the edges tighter than without tracking', () => {
    const without = solveParagraph(sample, { measure: 300, flatterzone: 60, band: 20 });
    const with5 = solveParagraph(sample, { ...precise(5, 20) });
    // The honest measure is the worst distance of a line end from its target.
    expect(with5.stats.edgeMiss).toBeLessThan(without.stats.edgeMiss);
  });

  it('leaves the last line untracked and does not flood the report', () => {
    const plan = solveParagraph(sample, precise(30));
    expect(plan.lines.at(-1)!.tracking).toBe(0);
    expect(plan.violations.filter((v) => v.kind === 'tracking')).toEqual([]);
  });
});
