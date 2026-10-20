/**
 * Text in, plans out: the simulator pipeline (plan §4.6).
 */
import { buildParagraph, solveStory, type Item, type Plan, type StorySettings } from '@flatter/core';
import type { SimFont } from './font.ts';
import { createHyphenator, createSenseRule } from '@flatter/hyphenation';
import { coreLanguage, type SimLanguage } from './hyphenator.ts';

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
  /** Sinneinheiten penalties (plan §2A.6). Default: on for German, off for English. */
  sense?: boolean;
  /** Precise tracking: largest word-space change as a share of the space width (ADR-015). */
  wordSpaceShare?: number;
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
  const hyphenator = opts.noHyphenation ? undefined : createHyphenator({ language: opts.language });
  const language = coreLanguage(opts.language);
  const sense = opts.sense ?? language === 'de';
  const breakCost = sense ? createSenseRule(opts.language) : undefined;
  const itemsList = paragraphs.map((p) =>
    buildParagraph(p, {
      measure: (s) => opts.font.measure(s, size),
      ...(hyphenator ? { hyphenate: hyphenator.points } : {}),
      ...(breakCost ? { breakCost } : {}),
      language,
    }),
  );
  const t1 = performance.now();
  const { font: _f, fontSize: _s, language: _l, measure: _m, chars: _c, noHyphenation: _n, sense: _se, wordSpaceShare, ...settings } = opts;
  // Tracking units are 1/1000 em: the em is the font size.
  const wordSpaceMax = wordSpaceShare !== undefined ? (wordSpaceShare * opts.font.measure(' ', size) * 1000) / size : undefined;
  const tracking = settings.tracking?.enabled
    ? { ...settings.tracking, emSize: settings.tracking.emSize ?? size, ...(wordSpaceMax !== undefined ? { wordSpaceMax } : {}) }
    : settings.tracking;
  const plans = solveStory(itemsList, { ...settings, ...(tracking ? { tracking } : {}), measure, language });
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
  /** Lines with tracking (Laufweite) applied. */
  tracked: number;
  /** Lines with adjusted word spaces. */
  spaced: number;
  errors: number;
  warnings: number;
}

export function summarise(result: SimResult): Summary {
  const s: Summary = { paragraphs: 0, perfect: 0, lines: 0, bandLines: 0, inRhythm: 0, hyphens: 0, tracked: 0, spaced: 0, errors: 0, warnings: 0 };
  for (const { plan } of result.paragraphs) {
    s.paragraphs++;
    if (plan.feasible) s.perfect++;
    s.lines += plan.lines.length;
    s.bandLines += plan.stats.bandLines;
    s.hyphens += plan.stats.hyphens;
    s.tracked += plan.stats.trackedLines;
    s.spaced += plan.stats.spacedLines;
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
  const functional = result.paragraphs[0]?.plan.params.style === 'functional';
  const band = result.paragraphs.flatMap(({ plan }) => plan.lines.filter((l) => l.kind === 'band'));
  const miss = band.map((l) => Math.abs(l.available - l.targetWidth - l.gap));
  const onEdge = miss.filter((m) => m <= 0.5).length;
  out.push(
    `${s.perfect}/${s.paragraphs} paragraphs ${functional ? 'strict' : 'in perfect alternation'}, ${s.inRhythm}/${s.bandLines} lines ${functional ? 'inside the Flatterzone' : 'in rhythm'}, ${s.hyphens} hyphens, ${s.tracked} tracked lines, ` +
      `${s.spaced} with adjusted word spaces, ${s.errors} errors, ${s.warnings} warnings. Measure ${result.measure.toFixed(1)} pt. Solve ${result.solveMs.toFixed(1)} ms.`,
    `Edges: ${onEdge}/${band.length} band lines within 0.5 pt of their edge, worst ${Math.max(0, ...miss).toFixed(1)} pt off.`,
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
      const tr =
        (l.tracking ? `  [tracking ${l.tracking > 0 ? '+' : ''}${l.tracking}]` : '') +
        (l.wordSpace ? `  [word spaces ${l.wordSpace > 0 ? '+' : ''}${l.wordSpace}]` : '');
      out.push(`  ${tag} ${l.width.toFixed(1).padStart(6)} ${l.hyphenClass ?? ' '} ${l.text}${tr}`);
    }
    for (const v of plan.violations) out.push(`    ${v.severity.padEnd(7)} ${v.kind}${v.line >= 0 ? ` (line ${v.line + 1})` : ''}: ${v.message}`);
  });
  return out.join('\n');
}
