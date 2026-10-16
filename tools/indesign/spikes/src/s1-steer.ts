/**
 * S1: do per-line wrap teeth make InDesign break exactly where the solver planned?
 * Pass: 100 % of lines in 3 German + 3 English paragraphs, at tight, normal and loose leading (plan §8).
 * Variant A: no hyphenation. Variant B: hyphenation from @flatter/hyphenation (Safe), InDesign with Duden / Hunspell.
 * Extended over several measures, two fonts and two sizes.
 */
import { solveParagraph, type Plan } from '@flatter/core';
import { createHyphenator } from '@flatter/hyphenation';
import { DE_TEXT, EN_TEXT, inNewDocument, readLines, textFrame, type Any, type LineInfo } from './lib.ts';
import { measureParagraph } from './measure.ts';
import { tooth } from './teeth.ts';

const EPSILON = 0.05;
declare const SPIKE_HYPHENATION: boolean | undefined;
const HYPHENATE = typeof SPIKE_HYPHENATION !== 'undefined' && SPIKE_HYPHENATION;
const CONFIGS: { font: string; size: number; measures: number[] }[] = [
  { font: 'Minion Pro\tRegular', size: 10, measures: [220, 260, 300, 340] },
  { font: 'Georgia\tRegular', size: 9, measures: [240, 300] },
  { font: 'Minion Pro\tRegular', size: 12, measures: [320] },
];

inNewDocument((doc: Any) => {
  const summary: Any[] = [];
  const mismatches: Any[] = [];
  let total = 0;
  let matched = 0;
  let hyphenLines = 0;
  let strictParagraphs = 0;
  let paragraphs = 0;
  let tightLines = 0;
  let replans = 0;
  let maxRounds = 0;
  const refused: string[] = [];
  const t0 = Date.now();
  for (const cfg of CONFIGS) {
    for (const [lang, texts] of [['German: 2006 Reform', DE_TEXT], ['English: USA', EN_TEXT]] as const) {
      const german = lang.startsWith('German');
      const hy = HYPHENATE ? createHyphenator({ language: german ? 'de' : 'en-US' }) : undefined;
      for (const [pi, text] of texts.entries()) {
        const setup = { language: lang, capitalized: german, size: cfg.size, font: cfg.font };
        const meas = measureParagraph(doc, 1500, text, setup, hy?.points);
        doc.pages.item(0).textFrames.everyItem().remove();
        for (const measure of cfg.measures) {
          paragraphs++;
          if (solveParagraph(meas.items, { measure, language: german ? 'de' : 'en', epsilon: EPSILON }).feasible) strictParagraphs++;
          for (const factor of [1.0, 1.2, 1.5]) {
            const leading = cfg.size * factor;
            const y = 20;
            const x = 20;
            // Plan, steer, read back; if InDesign refuses a planned hyphenation point, mark it
            // unavailable and re-plan (plan §3 step 4). Items are copied so refusals stay per trial.
            let items = meas.items.map((it) => ({ ...it }));
            let plan: Plan = solveParagraph(items, { measure, language: german ? 'de' : 'en', epsilon: EPSILON });
            let frame: Any;
            let teeth: Any[] = [];
            let lines: LineInfo[] = [];
            let rounds = 0;
            let firstBad = -1;
            for (;;) {
              rounds++;
              const height = leading * (plan.lines.length + 3);
              frame = textFrame(doc, [y, x, y + height, x + measure], text, { ...setup, leading, hyphenation: HYPHENATE });
              teeth = [];
              plan.lines.forEach((line, i) => {
                if (line.kind !== 'band') return;
                const baseline = y + leading * (i + 1);
                teeth.push(tooth(doc, baseline - meas.xHeight / 2, x + line.steerWidth, x + measure + 20));
                if (line.slack < EPSILON + 0.4) tightLines++;
              });
              lines = readLines(frame.parentStory);
              firstBad = plan.lines.findIndex((line, i) => {
                const got = lines[i];
                const plannedLast = meas.charRange[line.endItem - 1]![1] - 1;
                let k = got ? got.last : -1;
                while (got && k > got.first && /^\s$/.test(text[k] ?? '')) k--;
                return !(got && k === plannedLast && got.hyphenated === line.endsWithHyphen);
              });
              const bad = firstBad >= 0 ? plan.lines[firstBad]! : undefined;
              if (!bad || !bad.endsWithHyphen || rounds >= 6) break;
              // InDesign did not break at the planned hyphenation point: it refuses that point.
              const pen = items[bad.breakAt]!;
              if (pen.type !== 'penalty') break;
              refused.push(text.slice(meas.charRange[bad.startItem]![0], meas.charRange[bad.endItem - 1]![1]).split(/\s/).pop() + '-');
              items = items.map((it, k) => (k === bad.breakAt ? { ...pen, quality: 'X' as const } : it));
              plan = solveParagraph(items, { measure, language: german ? 'de' : 'en', epsilon: EPSILON });
              for (const t of teeth) t.remove();
              frame.remove();
            }
            maxRounds = Math.max(maxRounds, rounds);
            replans += rounds - 1;
            let ok = 0;
            plan.lines.forEach((line, i) => {
              total++;
              if (line.endsWithHyphen) hyphenLines++;
              const got = lines[i];
              const plannedLast = meas.charRange[line.endItem - 1]![1] - 1;
              let k = got ? got.last : -1;
              while (got && k > got.first && /^\s$/.test(text[k] ?? '')) k--;
              if (got && k === plannedLast && got.hyphenated === line.endsWithHyphen) {
                ok++;
                matched++;
              } else if (mismatches.length < 30) {
                mismatches.push({
                  font: cfg.font.split('\t')[0], size: cfg.size, measure, lang: lang.slice(0, 7), paragraph: pi + 1, leading: factor, line: i + 1, role: line.role,
                  planned: text.slice(meas.charRange[line.startItem]![0], plannedLast + 1).slice(-28) + (line.endsWithHyphen ? '-' : ''),
                  got: got ? got.text.trim().slice(-28) + (got.hyphenated ? '-' : '') : '(missing)',
                  steer: +line.steerWidth.toFixed(2), planned_w: +line.inkWidth.toFixed(2), got_w: got ? +(got.inkEnd - got.start).toFixed(2) : null, slack: +line.slack.toFixed(2),
                });
              }
            });
            summary.push({ font: cfg.font.split('\t')[0], size: cfg.size, measure, lang: lang.slice(0, 7), paragraph: pi + 1, leading: factor, lines: plan.lines.length, hyphens: plan.stats.hyphens, matched: ok });
            for (const t of teeth) t.remove();
            frame.remove();
          }
        }
      }
    }
  }
  return {
    variant: HYPHENATE ? 'B: with hyphenation' : 'A: no hyphenation',
    pass: matched === total,
    matched,
    total,
    hyphenatedLines: hyphenLines,
    strictParagraphs: `${strictParagraphs}/${paragraphs}`,
    tightLines,
    replans,
    maxRounds,
    refusedByInDesign: [...new Set(refused)],
    composeMs: Date.now() - t0,
    failedTrials: summary.filter((s) => s.matched !== s.lines),
    mismatches,
  };
});
