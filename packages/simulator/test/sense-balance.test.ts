import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { senseMultiplier } from '@flatter/core';
import { describe, expect, it } from 'vitest';
import { fontFromBytes, simulate, type SimulateOptions } from '../src/index.ts';

const require = createRequire(import.meta.url);
const font = fontFromBytes(new Uint8Array(readFileSync(require.resolve('@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff'))));
const de = readFileSync(resolve(__dirname, '../../../test/fixtures/texts/de.txt'), 'utf8');
const senseBreaks = (opts: Partial<SimulateOptions>) =>
  simulate(de, { font, fontSize: 10, language: 'de', chars: 60, ...opts }).paragraphs.reduce((s, p) => s + p.plan.violations.filter((v) => v.kind === 'sense').length, 0);
const PRECISE = { tracking: { enabled: true, mode: 'precise' as const, max: 5 }, wordSpaceShare: 0.25 };

describe('Shape ↔ Sense (ADR-025)', () => {
  it('scales the Sinneinheiten weight from none to sixteen times', () => {
    expect(senseMultiplier(0)).toBe(0);
    expect(senseMultiplier(0.5)).toBe(1);
    expect(senseMultiplier(1)).toBe(16);
  });

  it('never breaks a unit of meaning at Sense first, in any style', () => {
    for (const extra of [{}, PRECISE, { style: 'functional' as const }]) {
      for (const chars of [45, 60]) expect(senseBreaks({ ...extra, chars, senseBalance: 1 })).toBe(0);
    }
  });

  it('breaks units of meaning more often towards Shape and less often towards Sense', () => {
    for (const extra of [PRECISE, { style: 'functional' as const }]) {
      const shape = senseBreaks({ ...extra, senseBalance: 0 });
      const middle = senseBreaks({ ...extra, senseBalance: 0.5 });
      const sense = senseBreaks({ ...extra, senseBalance: 0.9 });
      expect(shape).toBeGreaterThanOrEqual(middle);
      expect(middle).toBeGreaterThanOrEqual(sense);
      expect(shape).toBeGreaterThan(sense);
    }
  });
});
