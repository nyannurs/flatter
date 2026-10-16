/**
 * Text in, plans out: the simulator pipeline (plan §4.6).
 */
import { buildParagraph, solveStory, type Item, type Plan, type StorySettings } from '@flatter/core';
import type { SimFont } from './font.ts';
import { coreLanguage, patternHyphenator, type SimLanguage } from './hyphenator.ts';

export interface SimulateOptions extends Omit<StorySettings, 'measure' | 'language'> {
  font: SimFont;
  fontSize: number;
  language: SimLanguage;
  /** Measure in points. Takes precedence over chars. */
  measure?: number;
  /** Measure as average characters per line (default 60). */
  chars?: number;
  /** Turn hyphenation off entirely. */
  noHyphenation?: boolean;
}

export interface SimParagraph {
  text: string;
  items: Item[];
  plan: Plan;
}

export interface SimResult {
  paragraphs: SimParagraph[];
  measure: number;
  /** Solve time for all paragraphs, excluding text building. */
  solveMs: number;
  /** Text building (measuring and hyphenating) time. */
  buildMs: number;
}

/** Paragraphs are separated by blank lines; single newlines inside a paragraph are spaces. */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter((p) => p.length > 0);
}

export function averageCharWidth(font: SimFont, size: number, sample: string): number {
  const s = sample.slice(0, 4000) || 'abcdefghijklmnopqrstuvwxyz';
  return font.measure(s, size) / [...s].length;
}

export function simulate(text: string, opts: SimulateOptions): SimResult {
  const paragraphs = splitParagraphs(text);
  const size = opts.fontSize;
  const measure = opts.measure ?? (opts.chars ?? 60) * averageCharWidth(opts.font, size, paragraphs.join(' '));
  const t0 = performance.now();
  const hyphenate = opts.noHyphenation ? undefined : patternHyphenator(opts.language);
  const language = coreLanguage(opts.language);
  const itemsList = paragraphs.map((p) =>
    buildParagraph(p, {
      measure: (s) => opts.font.measure(s, size),
      ...(hyphenate ? { hyphenate } : {}),
      language,
    }),
  );
  const t1 = performance.now();
  const { font: _f, fontSize: _s, language: _l, measure: _m, chars: _c, noHyphenation: _n, ...settings } = opts;
  const plans = solveStory(itemsList, { ...settings, measure, language });
  const t2 = performance.now();
  return {
    paragraphs: paragraphs.map((text, i) => ({ text, items: itemsList[i]!, plan: plans[i]! })),
    measure,
    buildMs: t1 - t0,
    solveMs: t2 - t1,
  };
}

export interface Summary {
  paragraphs: number;
  perfect: number;
  lines: number;
  bandLines: number;
  inRhythm: number;
  hyphens: number;
  errors: number;
  warnings: number;
}

export function summarise(result: SimResult): Summary {
  const s: Summary = { paragraphs: 0, perfect: 0, lines: 0, bandLines: 0, inRhythm: 0, hyphens: 0, errors: 0, warnings: 0 };
  for (const { plan } of result.paragraphs) {
    s.paragraphs++;
    if (plan.feasible) s.perfect++;
    s.lines += plan.lines.length;
    s.bandLines += plan.stats.bandLines;
    s.hyphens += plan.stats.hyphens;
    const broken = new Set(plan.violations.filter((v) => v.kind === 'band' || v.kind === 'contrast').map((v) => v.line));
    s.inRhythm += plan.lines.filter((l) => l.kind === 'band' && !broken.has(l.index)).length;
    s.errors += plan.violations.filter((v) => v.severity === 'error').length;
    s.warnings += plan.violations.filter((v) => v.severity === 'warning').length;
  }
  return s;
}

export function formatReport(result: SimResult): string {
  const s = summarise(result);
  const out: string[] = [];
  out.push(
    `${s.perfect}/${s.paragraphs} paragraphs in perfect alternation, ${s.inRhythm}/${s.bandLines} lines in rhythm, ${s.hyphens} hyphens, ` +
      `${s.errors} errors, ${s.warnings} warnings. Measure ${result.measure.toFixed(1)} pt. Solve ${result.solveMs.toFixed(1)} ms.`,
  );
  result.paragraphs.forEach(({ plan }, pi) => {
    const P = plan.params;
    out.push('');
    out.push(
      `¶${pi + 1}  ${plan.feasible ? 'ok' : 'NOT strict'} (${plan.solvedAs}${plan.phaseFlipped ? ', phase flipped' : ''})  ` +
        `Z=${P.flatterzone.toFixed(1)} b=${P.band.toFixed(1)}  spread long ${plan.stats.longGapSpread.toFixed(1)} short ${plan.stats.shortGapSpread.toFixed(1)}`,
    );
    for (const l of plan.lines) {
      const tag = l.kind === 'band' ? (l.role === 'long' ? 'L' : 'S') : l.kind === 'last' ? '·' : 'F';
      out.push(`  ${tag} ${l.width.toFixed(1).padStart(6)} ${l.hyphenClass ?? ' '} ${l.text}`);
    }
    for (const v of plan.violations) out.push(`    ${v.severity.padEnd(7)} ${v.kind}${v.line >= 0 ? ` (line ${v.line + 1})` : ''}: ${v.message}`);
  });
  return out.join('\n');
}
