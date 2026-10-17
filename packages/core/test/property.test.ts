/**
 * Property tests (plan §9 Phase 1): invariants that must hold for any text,
 * plus an exhaustive check that strict mode finds a solution whenever one exists.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  evaluateBreaks,
  ParagraphMetrics,
  resolveParams,
  solveParagraph,
  type FlatterSettings,
  type HyphenClass,
  type Item,
} from '../src/index.ts';

const TOL = 1e-6;

const wordArb = fc.record({
  letters: fc.integer({ min: 1, max: 14 }),
  points: fc.array(fc.record({ at: fc.integer({ min: 2, max: 12 }), q: fc.constantFrom<HyphenClass>('A', 'B', 'C', 'X') }), {
    maxLength: 3,
  }),
});

function toItems(ws: { letters: number; points: { at: number; q: HyphenClass }[] }[]): Item[] {
  const items: Item[] = [];
  ws.forEach((w, wi) => {
    if (wi > 0) items.push({ type: 'glue', width: 2.5 });
    const cuts = [...new Map(w.points.filter((p) => p.at < w.letters - 1).map((p) => [p.at, p.q])).entries()].sort((a, b) => a[0] - b[0]);
    let from = 0;
    const key = `w${w.letters}`;
    cuts.forEach(([at, q], ci) => {
      items.push({ type: 'box', width: (at - from) * 5, text: 'x'.repeat(at - from), wordKey: key, ...(ci === 0 ? { wordStart: true } : {}) });
      items.push({ type: 'penalty', width: 3, flagged: true, quality: q });
      from = at;
    });
    items.push({
      type: 'box',
      width: (w.letters - from) * 5,
      text: 'x'.repeat(w.letters - from),
      wordKey: key,
      wordEnd: true,
      ...(cuts.length === 0 ? { wordStart: true } : {}),
    });
  });
  return items;
}

const settingsArb = (minMeasure: number, maxMeasure: number) =>
  fc
    .record({
      measure: fc.integer({ min: minMeasure, max: maxMeasure }),
      zFrac: fc.double({ min: 1 / 12, max: 1 / 4, noNaN: true }),
      bFrac: fc.double({ min: 0.15, max: 0.7, noNaN: true }),
      mode: fc.constantFrom<'strict' | 'soft'>('strict', 'soft'),
      hyphenation: fc.constantFrom<'safe' | 'normal'>('safe', 'normal'),
      maxConsecutiveHyphens: fc.integer({ min: 1, max: 3 }),
      phase: fc.constantFrom<'long' | 'short' | 'auto'>('long', 'short', 'auto'),
      variation: fc.constantFrom(0, 0.5, 1),
      hanging: fc.boolean(),
      tracking: fc.option(fc.integer({ min: 0, max: 10 }), { nil: undefined }),
      trackingMode: fc.constantFrom<'rescue' | 'precise'>('rescue', 'precise'),
    })
    .map(
      (r): FlatterSettings => ({
        measure: r.measure,
        flatterzone: r.measure * r.zFrac,
        band: r.measure * r.zFrac * r.bFrac,
        mode: r.mode,
        hyphenation: r.hyphenation,
        maxConsecutiveHyphens: r.maxConsecutiveHyphens,
        phase: r.phase,
        variation: r.variation,
        hyphenCountsTowardWidth: !r.hanging,
        ...(r.tracking !== undefined ? { tracking: { enabled: true, mode: r.trackingMode, max: r.tracking, emSize: 10 } } : {}),
      }),
    );

describe('solver invariants for any paragraph', () => {
  it('holds every rule it claims to hold', () => {
    fc.assert(
      fc.property(fc.array(wordArb, { minLength: 1, maxLength: 60 }), settingsArb(80, 400), (ws, settings) => {
        const items = toItems(ws);
        const plan = solveParagraph(items, settings);
        const P = plan.params;

        // Every box appears exactly once, in order.
        let next = 0;
        for (const line of plan.lines) {
          for (let k = next; k < line.startItem; k++) expect(items[k]!.type).not.toBe('box');
          expect(line.startItem).toBeGreaterThanOrEqual(next);
          expect(line.endItem).toBeLessThanOrEqual(line.breakAt === items.length ? items.length : line.breakAt);
          next = line.endItem;
        }
        for (let k = next; k < items.length; k++) expect(items[k]!.type).not.toBe('box');

        // Correctness rules are never relaxed.
        for (const line of plan.lines) {
          expect(line.hyphenClass).not.toBe('X');
          if (P.hyphenation === 'safe') expect(line.hyphenClass).not.toBe('C');
        }

        // Lines exceed the measure only when reported.
        plan.lines.forEach((line, i) => {
          if (line.width > line.available + TOL) {
            expect(plan.violations.some((v) => v.kind === 'overfull' && v.line === i)).toBe(true);
          }
        });

        // Roles alternate.
        plan.lines.forEach((line, i) => {
          if (i > 0) expect(line.role).not.toBe(plan.lines[i - 1]!.role);
        });

        // A strict solve is always feasible, and a feasible plan really is strict.
        if (plan.solvedAs === 'strict') expect(plan.feasible).toBe(true);
        if (plan.feasible) {
          let run = 0;
          plan.lines.forEach((line, i) => {
            run = line.endsWithHyphen ? run + 1 : 0;
            expect(run).toBeLessThanOrEqual(P.maxConsecutiveHyphens);
            expect(line.width).toBeLessThanOrEqual(line.available + TOL);
            if (line.kind !== 'band') return;
            const lo = line.role === 'long' ? 0 : P.flatterzone;
            expect(line.gap).toBeGreaterThanOrEqual(lo - TOL);
            expect(line.gap).toBeLessThanOrEqual(lo + P.band + TOL);
            const prev = plan.lines[i - 1];
            if (prev?.kind === 'band') {
              const diff = line.role === 'short' ? line.gap - prev.gap : prev.gap - line.gap;
              expect(diff).toBeGreaterThanOrEqual(P.contrast - TOL);
            }
          });
        }

        // Steering stays between the planned width and the next possible break.
        for (const line of plan.lines.filter((l) => l.kind === 'band')) {
          expect(line.steerWidth).toBeGreaterThanOrEqual(line.inkWidth - TOL);
          const margin = line.tracking ? Math.max(P.epsilon, 0.25 * P.tracking.emSize) : P.epsilon;
          expect(line.steerWidth).toBeLessThanOrEqual(line.inkWidth + margin + TOL);
          if (line.slack > 0) expect(line.steerWidth).toBeLessThan(line.inkWidth + line.slack);
        }

        // Tracking: whole units within the maximum, only on band lines, and only as a rescue.
        for (const line of plan.lines) {
          if (P.tracking.mode === 'rescue') expect(Number.isInteger(line.tracking)).toBe(true);
          if (!P.tracking.enabled) expect(line.tracking).toBe(0);
          expect(Math.abs(line.tracking)).toBeLessThanOrEqual(P.tracking.enabled ? P.tracking.max : 0);
          if (line.kind !== 'band') expect(line.tracking).toBe(0);
        }
        if (P.tracking.enabled && P.tracking.mode === 'rescue' && P.mode === 'strict') {
          const untracked = solveParagraph(items, { ...settings, tracking: { enabled: false } });
          if (untracked.solvedAs === 'strict' && !untracked.phaseFlipped) expect(plan.stats.trackedLines).toBe(0);
        }

        // Deterministic.
        expect(solveParagraph(items, settings).lines).toEqual(plan.lines);
      }),
      { numRuns: 400 },
    );
  });
});

describe('strict mode is exact', () => {
  it('finds a strict solution whenever one exists (brute force on small paragraphs)', () => {
    fc.assert(
      fc.property(
        fc.array(wordArb, { minLength: 2, maxLength: 7 }),
        // The brute force below knows nothing about tracking, so it stays off here.
        settingsArb(40, 140).map((s) => ({ ...s, mode: 'strict' as const, phase: 'long' as const, tracking: { enabled: false } })),
        (ws, settings) => {
          const items = toItems(ws);
          const P = resolveParams(settings, items);
          const cands = new ParagraphMetrics(items, P).candidates.slice(0, -1);
          fc.pre(cands.length <= 13);

          let exists = false;
          const total = 1 << cands.length;
          for (let mask = 0; mask < total && !exists; mask++) {
            const breaks = cands.filter((_, i) => mask & (1 << i));
            for (const role of ['long', 'short'] as const) {
              if (evaluateBreaks(items, settings, breaks, role).feasible) {
                exists = true;
                break;
              }
            }
          }
          const plan = solveParagraph(items, settings);
          expect(plan.feasible).toBe(exists);
          expect(plan.solvedAs === 'strict').toBe(exists);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('agrees with the independent checker on its own plans', () => {
    fc.assert(
      fc.property(fc.array(wordArb, { minLength: 1, maxLength: 40 }), settingsArb(80, 300), (ws, settings) => {
        const items = toItems(ws);
        const plan = solveParagraph(items, settings);
        const breaks = plan.lines.slice(0, -1).map((l) => l.breakAt);
        const ev = evaluateBreaks(items, settings, breaks, plan.startRole, plan.lines.map((l) => l.tracking));
        expect(ev.lines).toEqual(plan.lines);
        expect(ev.feasible).toBe(plan.feasible);
      }),
      { numRuns: 300 },
    );
  });
});
