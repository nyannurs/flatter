/**
 * Simulator CLI. Example:
 *   npm run sim -- --lang de --chars 60 --out packages/simulator/out/de.svg
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fontFromBytes, formatReport, renderSvg, simulate, type SimLanguage } from './index.ts';

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), '../../..');

const { values } = parseArgs({
  options: {
    text: { type: 'string' },
    lang: { type: 'string', default: 'de' },
    measure: { type: 'string' },
    chars: { type: 'string', default: '60' },
    size: { type: 'string', default: '10' },
    leading: { type: 'string' },
    z: { type: 'string' },
    band: { type: 'string' },
    variation: { type: 'string', default: '0' },
    phase: { type: 'string', default: 'long' },
    style: { type: 'string', default: 'aesthetic' },
    continuous: { type: 'boolean', default: false },
    mode: { type: 'string', default: 'strict' },
    hyphenation: { type: 'string', default: 'safe' },
    'max-hyphens': { type: 'string', default: '2' },
    'no-hyphenation': { type: 'boolean', default: false },
    sense: { type: 'boolean' },
    tracking: { type: 'string' },
    precise: { type: 'boolean' },
    'word-spaces': { type: 'string' },
    'no-sense': { type: 'boolean', default: false },
    font: { type: 'string' },
    out: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});

if (values.help) {
  console.log(`Flatter simulator: renders the solver's plan for a text to SVG and prints a report.

  --text <file>        text file, paragraphs separated by blank lines (default: test/fixtures/texts/<de|en>.txt)
  --lang <tag>         de | de-CH | en-US | en-GB (default de)
  --measure <pt>       measure in points (overrides --chars)
  --chars <n>          measure as average characters per line (default 60)
  --size <pt>          font size (default 10)
  --leading <pt>       leading (default 1.3 × size)
  --z <pt>             Flatterzone (default W/5, or W/7 for narrow columns)
  --band <pt>          band tolerance (default Z/2)
  --variation <0..1>   variation inside the bands (default 0)
  --phase <p>          long | short | auto (default long)
  --continuous         continue the rhythm across paragraphs
  --mode <m>           strict | soft (default strict)
  --hyphenation <h>    safe | normal (default safe)
  --max-hyphens <n>    consecutive hyphenated lines (default 2)
  --no-hyphenation     do not hyphenate at all
  --sense / --no-sense Sinneinheiten penalties (default: on for German, off for English)
  --tracking <max>     allow tracking (Laufweite) up to ±max/1000 em on lines that just miss their band (off by default)
  --style <s>          aesthetic (strict long/short, default) or functional (free rag, reading first)
  --precise            with --tracking: pull every line end onto its edge (ADR-013)
  --word-spaces <pct>  with --precise: also change word spaces by up to ±pct % (ADR-015)
  --font <file>        .woff/.ttf/.otf font (default Source Serif 4)
  --out <file.svg>     write the SVG here (default packages/simulator/out/<lang>.svg)`);
  process.exit(0);
}

const lang = values.lang as SimLanguage;
const textPath = values.text ?? resolve(repoRoot, `test/fixtures/texts/${lang.startsWith('de') ? 'de' : 'en'}.txt`);
const fontPath = values.font ?? require.resolve('@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff');
const font = fontFromBytes(new Uint8Array(readFileSync(fontPath)));
const size = Number(values.size);
const leading = values.leading ? Number(values.leading) : size * 1.3;
const num = (s: string | undefined) => (s === undefined ? undefined : Number(s));

const result = simulate(readFileSync(textPath, 'utf8'), {
  font,
  fontSize: size,
  language: lang,
  ...(values.measure ? { measure: Number(values.measure) } : { chars: Number(values.chars) }),
  ...(values.z ? { flatterzone: num(values.z)! } : {}),
  ...(values.band ? { band: num(values.band)! } : {}),
  variation: Number(values.variation),
  phase: values.phase as 'long' | 'short' | 'auto',
  style: values.style as 'aesthetic' | 'functional',
  continuous: values.continuous,
  mode: values.mode as 'strict' | 'soft',
  hyphenation: values.hyphenation as 'safe' | 'normal',
  maxConsecutiveHyphens: Number(values['max-hyphens']),
  noHyphenation: values['no-hyphenation'],
  ...(values['no-sense'] ? { sense: false } : values.sense ? { sense: true } : {}),
  ...(values.tracking !== undefined ? { tracking: { enabled: true, max: Number(values.tracking), ...(values.precise ? { mode: 'precise' as const } : {}) } } : {}),
  ...(values['word-spaces'] !== undefined ? { wordSpaceShare: Number(values['word-spaces']) / 100 } : {}),
});

const out = values.out ?? resolve(repoRoot, `packages/simulator/out/${lang}.svg`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, renderSvg(result.paragraphs.map((p) => p.plan), { font, fontSize: size, leading, measure: result.measure }));
console.log(formatReport(result));
console.log(`\nSVG written to ${out}`);
