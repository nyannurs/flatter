import { describe, expect, it } from 'vitest';
import { buildParagraph, solveParagraph, type FlatterSettings, type Plan } from '../src/index.ts';
import { every3, GERMAN_SAMPLE, mono } from './helpers.ts';

// Functional Flattersatz (ADR-021): one zone, no fixed order, fluttering edge, breaks at reading pauses.
describe('functional style', () => {
  const sample = buildParagraph(GERMAN_SAMPLE, { measure: mono, hyphenate: every3() });
  const functional = (extra: Partial<FlatterSettings> = {}): FlatterSettings => ({ measure: 300, flatterzone: 50, band: 15, style: 'functional', ...extra });
  const bandLines = (p: Plan) => p.lines.filter((l) => l.kind === 'band');

  it('ends every line inside the Flatterzone', () => {
    const plan = solveParagraph(sample, functional());
    expect(plan.feasible).toBe(true);
    for (const l of bandLines(plan)) {
      expect(l.gap, l.text).toBeGreaterThanOrEqual(-1e-6);
      expect(l.gap, l.text).toBeLessThanOrEqual(50 + 1e-6);
    }
  });

  it('does not force long and short to alternate', () => {
    // A zone where the aesthetic rhythm is impossible is no problem for the functional style.
    const tight = { measure: 300, flatterzone: 30, band: 6 };
    expect(solveParagraph(sample, tight).feasible).toBe(false);
    expect(solveParagraph(sample, { ...tight, style: 'functional' }).feasible).toBe(true);
  });

  it('makes the edge flutter more with a larger band', () => {
    const spread = (p: Plan) => {
      const g = bandLines(p).map((l) => l.gap);
      return g.slice(1).reduce((s, x, i) => s + Math.abs(x - g[i]!), 0) / Math.max(1, g.length - 1);
    };
    expect(spread(solveParagraph(sample, functional({ band: 30 })))).toBeGreaterThan(spread(solveParagraph(sample, functional({ band: 1 }))));
  });

  it('prefers breaks at reading pauses', () => {
    const pauses = (p: Plan) => bandLines(p).filter((l) => /[.,;:!?]$/.test(l.text)).length;
    const withPauses = solveParagraph(sample, functional());
    const without = solveParagraph(sample, functional({ weights: { pauseless: 0 } }));
    expect(pauses(withPauses)).toBeGreaterThanOrEqual(pauses(without));
  });

  it('avoids staircases', () => {
    const stairs = (p: Plan) => p.violations.filter((v) => v.kind === 'staircase').length;
    expect(stairs(solveParagraph(sample, functional()))).toBeLessThanOrEqual(stairs(solveParagraph(sample, functional({ weights: { staircase: 0 } }))));
  });

  it('uses Laufweite only to rescue lines that would end outside the zone', () => {
    const narrow = { measure: 300, flatterzone: 22, band: 6, style: 'functional' as const, mode: 'strict' as const };
    const without = solveParagraph(sample, narrow);
    const rescued = solveParagraph(sample, { ...narrow, tracking: { enabled: true, mode: 'precise', max: 10, emSize: 10, wordSpaceMax: 80 } });
    const outside = (p: Plan) => bandLines(p).filter((l) => l.gap < -1e-6 || l.gap > 22 + 1e-6).length;
    expect(outside(rescued)).toBeLessThanOrEqual(outside(without));
    // Lines already inside the zone keep their natural spacing.
    for (const l of bandLines(rescued)) if (l.tracking !== 0 || l.wordSpace !== 0) expect(l.gap).toBeGreaterThan(-1e-6);
    expect(bandLines(rescued).filter((l) => l.tracking !== 0 || l.wordSpace !== 0).length).toBeLessThan(bandLines(rescued).length);
  });

  it('reports a line outside the zone once, with no contrast or alternation errors', () => {
    const plan = solveParagraph(sample, { measure: 300, flatterzone: 8, band: 4, style: 'functional', mode: 'soft' });
    const kinds = new Set(plan.violations.map((v) => v.kind));
    expect(kinds.has('contrast')).toBe(false);
    expect(kinds.has('hole')).toBe(false);
    const perLine = new Map<number, number>();
    for (const v of plan.violations.filter((x) => x.kind === 'band')) perLine.set(v.line, (perLine.get(v.line) ?? 0) + 1);
    expect([...perLine.values()].every((n) => n === 1)).toBe(true);
  });
});
