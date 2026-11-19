import { describe, expect, it } from 'vitest';
import {
  buildParagraph,
  evaluateBreaks,
  solveParagraph,
  solveStory,
  type FlatterSettings,
  type Item,
  type Plan,
} from '../src/index.ts';
import { every3, GERMAN_SAMPLE, mono, words } from './helpers.ts';

const errors = (plan: { violations: Plan['violations'] }) => plan.violations.filter((v) => v.severity === 'error');
const sample = buildParagraph(GERMAN_SAMPLE, { measure: mono, hyphenate: every3() });

function expectStrictRhythm(plan: Plan): void {
  const { flatterzone: Z, band: b, contrast } = plan.params;
  const lines = plan.lines;
  lines.forEach((line, i) => {
    expect(line.width).toBeLessThanOrEqual(line.available + 1e-9);
    if (i > 0) expect(line.role).not.toBe(lines[i - 1]!.role);
    if (line.kind !== 'band') return;
    if (line.role === 'long') {
      expect(line.gap).toBeGreaterThanOrEqual(-1e-9);
      expect(line.gap).toBeLessThanOrEqual(b + 1e-9);
    } else {
      expect(line.gap).toBeGreaterThanOrEqual(Z - 1e-9);
      expect(line.gap).toBeLessThanOrEqual(Z + b + 1e-9);
    }
    const prev = lines[i - 1];
    if (prev?.kind === 'band') {
      const diff = line.role === 'short' ? line.gap - prev.gap : prev.gap - line.gap;
      expect(diff).toBeGreaterThanOrEqual(contrast - 1e-9);
    }
  });
}

describe('solveParagraph: strict alternation', () => {
  it('sets the German sample in strict alternation, starting long', () => {
    const plan = solveParagraph(sample, { measure: 300 });
    expect(plan.solvedAs).toBe('strict');
    expect(plan.feasible).toBe(true);
    expect(errors(plan)).toEqual([]);
    expect(plan.lines[0]!.role).toBe('long');
    expect(plan.lines.at(-1)!.kind).toBe('last');
    expectStrictRhythm(plan);
  });

  it('starts short when asked', () => {
    const plan = solveParagraph(sample, { measure: 300, phase: 'short' });
    expect(plan.lines[0]!.role).toBe('short');
    expect(plan.feasible).toBe(true);
    expectStrictRhythm(plan);
  });

  it('picks the cheaper phase in auto mode', () => {
    const auto = solveParagraph(sample, { measure: 300, phase: 'auto' });
    const long = solveParagraph(sample, { measure: 300, phase: 'long' });
    const short = solveParagraph(sample, { measure: 300, phase: 'short' });
    expect(auto.cost).toBeCloseTo(Math.min(long.cost, short.cost));
  });

  it('flips the phase when the requested one is impossible', () => {
    // Measure 100, Z 30, b 10. The first line can be 65 wide (short band 60–70) but never 90–100.
    const items = words('aaaaaa bbbbbb cccccccc dddd eeee');
    const settings: FlatterSettings = { measure: 100, flatterzone: 30, band: 10 };
    const plan = solveParagraph(items, settings);
    expect(plan.phaseFlipped).toBe(true);
    expect(plan.startRole).toBe('short');
    expect(plan.feasible).toBe(true);
    expect(plan.violations[0]).toMatchObject({ kind: 'phase-flipped', severity: 'info' });
  });

  it('falls back to soft mode and reports violations when strict is impossible', () => {
    const items: Item[] = [...words('aaa'), { type: 'glue', width: 2.5 }, { type: 'box', width: 500, text: 'https://example.org/very/long' }];
    const plan = solveParagraph(items, { measure: 200 });
    expect(plan.solvedAs).toBe('soft');
    expect(plan.feasible).toBe(false);
    expect(plan.violations.some((v) => v.kind === 'overfull')).toBe(true);
    // Every item still appears exactly once.
    expect(plan.lines.at(-1)!.endItem).toBe(items.length);
  });

  it('gives the same result in soft mode when strict is possible', () => {
    const strict = solveParagraph(sample, { measure: 300 });
    const soft = solveParagraph(sample, { measure: 300, mode: 'soft' });
    expect(soft.solvedAs).toBe('soft');
    expect(errors(soft)).toEqual([]);
    expect(soft.lines.map((l) => l.breakAt)).toEqual(strict.lines.map((l) => l.breakAt));
  });

  it('handles empty and one-word paragraphs', () => {
    expect(solveParagraph([], { measure: 200 }).lines).toEqual([]);
    const one = solveParagraph(words('Ja.'), { measure: 200 });
    expect(one.lines).toHaveLength(1);
    expect(one.feasible).toBe(true);
  });
});

describe('hyphenation rules', () => {
  const settings: FlatterSettings = { measure: 300 };

  it('never uses class C points in Safe mode', () => {
    const items = buildParagraph(GERMAN_SAMPLE, { measure: mono, hyphenate: every3('C') });
    const plan = solveParagraph(items, settings);
    expect(plan.lines.some((l) => l.hyphenClass === 'C')).toBe(false);
  });

  it('lists class C hyphens for review in Normal mode', () => {
    const items = buildParagraph(GERMAN_SAMPLE, { measure: mono, hyphenate: every3('C') });
    const plan = solveParagraph(items, { ...settings, hyphenation: 'normal', mode: 'soft' });
    const used = plan.lines.filter((l) => l.hyphenClass === 'C').length;
    expect(plan.violations.filter((v) => v.kind === 'class-c-hyphen')).toHaveLength(used);
  });

  it('never uses vetoed points', () => {
    const items = buildParagraph(GERMAN_SAMPLE, { measure: mono, hyphenate: every3('X') });
    for (const mode of ['strict', 'soft'] as const) {
      const plan = solveParagraph(items, { ...settings, mode, hyphenation: 'normal' });
      expect(plan.lines.some((l) => l.endsWithHyphen)).toBe(false);
    }
  });

  it('keeps consecutive hyphenated lines within the limit, or reports every overrun', () => {
    for (const W of [180, 220, 300]) {
      for (const max of [1, 2, 3]) {
        for (const mode of ['strict', 'soft'] as const) {
          const plan = solveParagraph(sample, { measure: W, maxConsecutiveHyphens: max, mode });
          let run = 0;
          plan.lines.forEach((l, i) => {
            run = l.endsWithHyphen ? run + 1 : 0;
            if (run === max + 1) {
              expect(plan.feasible).toBe(false);
              expect(plan.violations.some((v) => v.kind === 'consecutive-hyphens' && v.line === i)).toBe(true);
            }
          });
          if (plan.feasible) expect(plan.violations.some((v) => v.kind === 'consecutive-hyphens')).toBe(false);
        }
      }
    }
  });

  it('prefers class A over class B points', () => {
    const a = solveParagraph(buildParagraph(GERMAN_SAMPLE, { measure: mono, hyphenate: every3('A') }), settings);
    const b = solveParagraph(sample, settings);
    expect(a.cost).toBeLessThan(b.cost);
  });
});

describe('Ausgangszeile', () => {
  it('never leaves only the end of a hyphenated word on the last line', () => {
    // Without the rule, "ccc|ddddd" would split with "ddddd" alone on the last line.
    const items = words('aaaaaaaaa bbbbbbbbb ccc|ddddd', { quality: 'A' });
    const ev = evaluateBreaks(items, { measure: 100, flatterzone: 30, band: 12 }, [3, 5]);
    expect(ev.violations.some((v) => v.kind === 'last-line-stub')).toBe(true);
    const plan = solveParagraph(items, { measure: 100, flatterzone: 30, band: 12, mode: 'soft' });
    expect(plan.violations.some((v) => v.kind === 'last-line-stub')).toBe(false);
  });

  it('never ends a paragraph on a single word shorter than four letters', () => {
    const items = buildParagraph('Ein ganz kurzer Absatz endet manchmal mit einem sehr kurzen Wort wie ja', { measure: mono });
    for (const W of [120, 140, 160, 180]) {
      const plan = solveParagraph(items, { measure: W, mode: 'soft' });
      const last = plan.lines.at(-1)!;
      expect(last.text).not.toBe('ja');
    }
  });

  it('warns when the last line reads as long after a long line', () => {
    const items = words('aaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbb');
    const ev = evaluateBreaks(items, { measure: 100, flatterzone: 30, band: 12 }, [1]);
    expect(ev.violations.some((v) => v.kind === 'last-line-too-long')).toBe(true);
  });
});

describe('geometry options', () => {
  it('measures the first line from its indent', () => {
    const plan = solveParagraph(sample, { measure: 300, firstLineIndent: 15 });
    expect(plan.lines[0]!.available).toBe(285);
    expect(plan.lines[0]!.indent).toBe(15);
    expect(plan.lines[1]!.available).toBe(300);
    expectStrictRhythm(plan);
  });

  it('respects forced line breaks and exempts those lines from the bands', () => {
    const items = buildParagraph('Kurz\nDanach folgt ein längerer Absatz mit vielen Wörtern, der sich gut setzen lässt.', {
      measure: mono,
      hyphenate: every3(),
    });
    const plan = solveParagraph(items, { measure: 150 });
    expect(plan.lines[0]).toMatchObject({ kind: 'forced', text: 'Kurz' });
    expect(plan.violations.filter((v) => v.line === 0 && v.kind === 'band')).toEqual([]);
  });

  it('enforces a contrast larger than Z − b', () => {
    const plan = solveParagraph(sample, { measure: 300, flatterzone: 60, band: 20, contrast: 50 });
    if (plan.feasible) expectStrictRhythm(plan);
    else expect(plan.violations.some((v) => v.kind === 'contrast' || v.kind === 'band')).toBe(true);
  });

  it('steers just above the planned width and below the next break', () => {
    const plan = solveParagraph(sample, { measure: 300 });
    for (const l of plan.lines.filter((x) => x.kind === 'band')) {
      expect(l.steerWidth).toBeGreaterThanOrEqual(l.inkWidth);
      expect(l.steerWidth).toBeLessThanOrEqual(l.inkWidth + plan.params.epsilon + 1e-9);
      expect(l.steerWidth).toBeLessThan(l.inkWidth + l.slack);
    }
  });
});

describe('variation', () => {
  it('keeps every target inside its band and is deterministic per seed', () => {
    const s: FlatterSettings = { measure: 300, variation: 1, variationSeed: 7 };
    const p1 = solveParagraph(sample, s);
    const p2 = solveParagraph(sample, s);
    expect(p1.lines).toEqual(p2.lines);
    const { flatterzone: Z, band: b } = p1.params;
    for (const l of p1.lines.filter((x) => x.kind === 'band')) {
      const lo = l.role === 'long' ? l.available - b : l.available - Z - b;
      const hi = l.role === 'long' ? l.available : l.available - Z;
      expect(l.targetWidth).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(l.targetWidth).toBeLessThanOrEqual(hi + 1e-9);
    }
    const p3 = solveParagraph(sample, { ...s, variationSeed: 8 });
    expect(p3.lines.map((l) => l.targetWidth)).not.toEqual(p1.lines.map((l) => l.targetWidth));
  });
});

describe('solveStory', () => {
  const paragraphs = [sample, sample, sample];

  it('restarts each paragraph with the chosen phase by default', () => {
    const plans = solveStory(paragraphs, { measure: 300 });
    expect(plans.map((p) => p.lines[0]!.role)).toEqual(['long', 'long', 'long']);
  });

  it('continues the rhythm across paragraphs when asked', () => {
    const plans = solveStory(paragraphs, { measure: 300, continuous: true });
    for (let i = 1; i < plans.length; i++) {
      const prevLast = plans[i - 1]!.lines.at(-1)!;
      expect(plans[i]!.lines[0]!.role).not.toBe(prevLast.role);
    }
  });
});

describe('performance', () => {
  it('solves a 40-line paragraph well inside the live-preview budget', () => {
    const long = buildParagraph(Array(4).fill(GERMAN_SAMPLE).join(' '), { measure: mono, hyphenate: every3() });
    for (let i = 0; i < 5; i++) solveParagraph(long, { measure: 300 });
    const t0 = performance.now();
    const plan = solveParagraph(long, { measure: 300 });
    const ms = performance.now() - t0;
    expect(plan.lines.length).toBeGreaterThanOrEqual(30);
    expect(ms).toBeLessThan(20);
  });
});

describe('forced line breaks after a space', () => {
  // "labore \n": the space before the forced break used to be a break candidate, so the solver could plan an empty
  // line there (exempt from the rhythm) and flip long/short for free; InDesign never sets such a line (2026-11-19).
  const measure = (s: string) => [...s].length * 5;
  const text = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua Ut enim ad minim veniam quis nostrud';
  it('plans no empty line and the same breaks as without the space', () => {
    const withSpace = solveParagraph(buildParagraph(text.replace('labore ', 'labore \n'), { measure }), { measure: 288 });
    const without = solveParagraph(buildParagraph(text.replace('labore ', 'labore\n'), { measure }), { measure: 288 });
    expect(withSpace.lines.every((l) => l.text.trim() !== '')).toBe(true);
    expect(withSpace.lines.map((l) => l.text.trim())).toEqual(without.lines.map((l) => l.text.trim()));
    expect(withSpace.lines.map((l) => l.width)).toEqual(without.lines.map((l) => l.width));
  });
});
