import { describe, expect, it } from 'vitest';
import { buildParagraph, solveParagraph, splitAdjustment, type FlatterSettings, type Item } from '../src/index.ts';
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

  it('keeps tracked lines a safety distance (0.1 em) from the measure', () => {
    const plan = solveParagraph(sample, precise(30, 20));
    const tracked = plan.lines.filter((l) => l.kind === 'band' && l.tracking > 0);
    expect(tracked.length).toBeGreaterThan(0);
    for (const l of tracked) expect(l.gap, l.text).toBeGreaterThanOrEqual(1 - 1e-6);
  });

  it('counts the width ligatures gain when tracked (Box.trackedExtra)', () => {
    // Every box widens by 0.2 pt when tracked, as broken-up ligatures do in InDesign.
    const withLigatures = sample.map((it) => (it.type === 'box' ? { ...it, trackedExtra: 0.2 } : it));
    const plan = solveParagraph(withLigatures, precise(30, 20));
    const tracked = plan.lines.filter((l) => l.kind === 'band' && l.tracking !== 0 && Math.abs(l.tracking) < 30 - 1e-9);
    expect(tracked.length).toBeGreaterThan(0);
    for (const l of tracked) {
      // The planned width includes the extra, and the line still lands on its edge.
      // If the solver ignored the extra, these lines would miss by 0.2 pt per box (several points).
      expect(Math.abs(l.available - l.targetWidth - l.gap), l.text).toBeLessThan(0.05);
    }
  });

  it('leaves the last line untracked and does not flood the report', () => {
    const plan = solveParagraph(sample, precise(30));
    expect(plan.lines.at(-1)!.tracking).toBe(0);
    expect(plan.violations.filter((v) => v.kind === 'tracking')).toEqual([]);
  });
});

describe('word spaces (ADR-015)', () => {
  const sample = buildParagraph(GERMAN_SAMPLE, { measure: mono, hyphenate: every3() });
  const precise = (max: number, wordSpaceMax: number): FlatterSettings => ({
    measure: 300, flatterzone: 60, band: 20, tracking: { enabled: true, mode: 'precise', max, emSize: 10, wordSpaceMax },
  });
  const within = (plan: ReturnType<typeof solveParagraph>, pt: number) =>
    plan.lines.filter((l) => l.kind === 'band' && Math.abs(l.available - l.targetWidth - l.gap) <= pt).length;

  it('shares a correction by reach: equal reach, equal relative use', () => {
    // Letters: 0.5 pt per unit, max 10 (reach 5 pt). Spaces: 0.05 pt per unit, max 100 (reach 5 pt).
    expect(splitAdjustment(4, 0.5, 10, 0.05, 100)).toEqual({ t: 4, w: 40 });
    // One control alone.
    expect(splitAdjustment(2, 0.5, 10, 0, 0)).toEqual({ t: 4, w: 0 });
    expect(splitAdjustment(-1, 0, 0, 0.05, 100)).toEqual({ t: 0, w: -20 });
  });

  it('gives the rest to the other control when one reaches its maximum', () => {
    // Letters reach 5 pt, spaces 1 pt: letters do more and hit their maximum first; spaces take the rest.
    const s = splitAdjustment(5.5, 0.5, 10, 0.05, 20);
    expect(s.t).toBe(10);
    expect(s.w).toBeCloseTo(10, 1);
    // Both at their maximum: the line stays short of its target, never past it.
    expect(splitAdjustment(20, 0.5, 2, 0.05, 100)).toEqual({ t: 2, w: 100 });
  });

  it('never overshoots: values are cut toward zero', () => {
    const { t, w } = splitAdjustment(1.234567, 0.37, 30, 0.03, 300);
    expect(t * 0.37 + w * 0.03).toBeLessThanOrEqual(1.234567 + 1e-9);
    expect(Number.isInteger(Math.round(t * 100))).toBe(true);
  });

  it('is off by default and only used in precise mode', () => {
    expect(solveParagraph(sample, precise(10, 0)).lines.every((l) => l.wordSpace === 0)).toBe(true);
    const rescue = solveParagraph(sample, { ...base, tracking: { enabled: true, max: 5, emSize: 10, wordSpaceMax: 100 } });
    expect(rescue.lines.every((l) => l.wordSpace === 0)).toBe(true);
  });

  it('brings more line ends onto their edges than letter tracking alone', () => {
    const letters = solveParagraph(sample, precise(5, 0));
    const both = solveParagraph(sample, precise(5, 100));
    expect(both.feasible).toBe(true);
    expect(both.stats.spacedLines).toBeGreaterThan(0);
    expect(within(both, 0.1)).toBeGreaterThan(within(letters, 0.1));
    expect(both.stats.edgeMiss).toBeLessThanOrEqual(letters.stats.edgeMiss + 1e-9);
    for (const l of both.lines) {
      expect(Math.abs(l.wordSpace)).toBeLessThanOrEqual(100 + 1e-9);
      expect(l.width).toBeLessThanOrEqual(l.available + 1e-6);
      if (l.kind !== 'band') expect(l.wordSpace).toBe(0);
    }
  });
});
