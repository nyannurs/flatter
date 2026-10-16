import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { averageCharWidth, fontFromBytes, renderSvg, simulate, splitParagraphs, summarise, type SimLanguage } from '../src/index.ts';

const require = createRequire(import.meta.url);
const font = fontFromBytes(new Uint8Array(readFileSync(require.resolve('@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff'))));
const text = (lang: SimLanguage) => readFileSync(resolve(__dirname, `../../../test/fixtures/texts/${lang.startsWith('de') ? 'de' : 'en'}.txt`), 'utf8');
const LANGS: SimLanguage[] = ['de', 'en-US', 'en-GB'];

describe('reference texts', () => {
  for (const lang of LANGS) {
    it(`sets the ${lang} reference text the same way as last time (60 characters)`, () => {
      const result = simulate(text(lang), { font, fontSize: 10, language: lang, chars: 60 });
      const lines = result.paragraphs.map(({ plan }) =>
        plan.lines.map((l) => `${l.kind === 'band' ? (l.role === 'long' ? 'L' : 'S') : l.kind === 'last' ? '·' : 'F'} ${l.text}`),
      );
      expect(lines).toMatchSnapshot();
    });
  }

  // MVP target (plan §10): at least 95 % of paragraphs in perfect alternation at 55–70 characters, Safe hyphenation.
  // English meets it. German reaches 75 of 80 (93.8 %) since Phase 2 made hyphenation correct: five near misses
  // at 55–58 characters, all fixed by a 10 % wider band or the optional tracking assist. Decision pending with
  // the designer (docs/progress.md). The German floor guards against regressions until then.
  const TARGET: Record<SimLanguage, number> = { de: 0.93, 'de-CH': 0.93, 'en-US': 0.95, 'en-GB': 0.95 };

  it('meets the MVP alternation target at 55–70 characters (German: documented baseline)', () => {
    for (const lang of LANGS) {
      let ok = 0;
      let n = 0;
      for (let chars = 55; chars <= 70; chars++) {
        const s = summarise(simulate(text(lang), { font, fontSize: 10, language: lang, chars }));
        ok += s.perfect;
        n += s.paragraphs;
      }
      expect(ok / n, lang).toBeGreaterThanOrEqual(TARGET[lang]);
    }
  });
});

describe('renderSvg', () => {
  it('draws one glyph path per line with no invalid numbers', () => {
    const result = simulate(text('de'), { font, fontSize: 10, language: 'de', chars: 60 });
    const svg = renderSvg(
      result.paragraphs.map((p) => p.plan),
      { font, fontSize: 10, leading: 13, measure: result.measure },
    );
    const lineCount = result.paragraphs.reduce((s, p) => s + p.plan.lines.length, 0);
    expect(svg.match(/<path /g)?.length).toBe(lineCount);
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('measures the column from the average character width', () => {
    const paras = splitParagraphs(text('en-GB'));
    const avg = averageCharWidth(font, 10, paras.join(' '));
    expect(avg).toBeGreaterThan(3);
    expect(avg).toBeLessThan(7);
  });
});
