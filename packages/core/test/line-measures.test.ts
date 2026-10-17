import { describe, expect, it } from 'vitest';
import { buildParagraph, solveParagraph } from '../src/index.ts';
import { every3, GERMAN_SAMPLE, mono } from './helpers.ts';

// Threaded frames of different widths: the measure changes from one line to the next.
describe('per-line measures (lineMeasures)', () => {
  const sample = buildParagraph(GERMAN_SAMPLE, { measure: mono, hyphenate: every3() });
  const base = { measure: 240, flatterzone: 40, band: 20 };

  it('changes nothing when every line has the paragraph measure', () => {
    const plain = solveParagraph(sample, base);
    const same = solveParagraph(sample, { ...base, lineMeasures: [240, 240, 240] });
    expect(same.lines.map((l) => l.breakAt)).toEqual(plain.lines.map((l) => l.breakAt));
  });

  it('sets lines after the change to the wider measure, with zone and band scaled', () => {
    const plan = solveParagraph(sample, { ...base, lineMeasures: [240, 240, 240, 240, 480] });
    expect(plan.feasible).toBe(true);
    plan.lines.forEach((l, i) => {
      const m = i < 4 ? 240 : 480;
      expect(l.available + l.indent).toBe(m);
      if (l.kind !== 'band') return;
      const s = m / 240;
      const lo = l.role === 'long' ? 0 : 40 * s;
      expect(l.gap).toBeGreaterThanOrEqual(lo - 1e-6);
      expect(l.gap).toBeLessThanOrEqual(lo + 20 * s + 1e-6);
    });
    // The wide lines really use the room: some line after the change is longer than the narrow measure.
    expect(plan.lines.slice(4).some((l) => l.width > 240)).toBe(true);
  });

  it('keeps the long/short rhythm across the change', () => {
    const plan = solveParagraph(sample, { ...base, lineMeasures: [240, 240, 240, 360] });
    const roles = plan.lines.filter((l) => l.kind === 'band').map((l) => l.role);
    roles.forEach((r, i) => i > 0 && expect(r).not.toBe(roles[i - 1]));
  });
});
