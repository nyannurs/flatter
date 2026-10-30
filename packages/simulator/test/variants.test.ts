import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { scoreBreaks } from '@flatter/core';
import { describe, expect, it } from 'vitest';
import { fontFromBytes, paragraphVariants, simulate, type SimLanguage } from '../src/index.ts';

const require = createRequire(import.meta.url);
const font = fontFromBytes(new Uint8Array(readFileSync(require.resolve('@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff'))));
const text = (lang: SimLanguage) => readFileSync(resolve(__dirname, `../../../test/fixtures/texts/${lang.startsWith('de') ? 'de' : 'en'}.txt`), 'utf8');

const SETTINGS = {
  plain: {},
  precise: { tracking: { enabled: true, mode: 'precise' as const, max: 5 }, wordSpaceShare: 0.25 },
  functional: { style: 'functional' as const },
};

describe('variants for the playground animation', () => {
  for (const [name, extra] of Object.entries(SETTINGS)) {
    for (const lang of ['de', 'en-US'] as SimLanguage[]) {
      it(`scores Flatter's own breaks at the solver's cost and ranks its plan first (${lang}, ${name})`, () => {
        const result = simulate(text(lang), { font, fontSize: 10, language: lang, chars: 60, ...extra });
        for (const p of result.paragraphs) {
          const breaks = p.plan.lines.slice(0, -1).map((l) => l.breakAt);
          const precise = name !== 'plain';
          const s = scoreBreaks(p.items, p.settings, breaks, p.plan.startRole, precise || p.plan.lines.some((l) => l.tracking !== 0 || l.wordSpace !== 0));
          expect(s!.lines.map((l) => l.breakAt)).toEqual(p.plan.lines.map((l) => l.breakAt));
          if (p.plan.solvedAs === 'strict') expect(s!.cost).toBeCloseTo(p.plan.cost, 6);
          const { variants, beatsFlatter } = paragraphVariants(p.items, p.settings, p.plan, 120);
          expect(variants.at(-1)!.source).toBe('flatter');
          expect(variants.length).toBeGreaterThan(20);
          if (p.plan.solvedAs === 'strict') expect(beatsFlatter).toBe(0);
        }
      });
    }
  }
});
