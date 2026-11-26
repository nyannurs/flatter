/**
 * Independent plan checker. It re-derives every rule from the finished lines
 * rather than trusting the solver, so it also works on lines read back from
 * InDesign (plan §6.2 "verify").
 */
import type { Item } from './items.ts';
import type { ResolvedParams } from './params.ts';
import type { PlannedLine, PlanStats, Violation } from './plan.ts';

const TOL = 1e-6;
/** Steps smaller than this do not count as a staircase. */
const STAIR_STEP = 0.5;

const fmt = (x: number): string => (Math.round(x * 100) / 100).toString();
const LETTER = /\p{L}/gu;

function wordAt(items: readonly Item[], k: number, edge: 'start' | 'end'): string | undefined {
  const it = items[k];
  if (it?.type !== 'box') return undefined;
  if (edge === 'start' ? !it.wordStart : !it.wordEnd) return undefined;
  return it.wordKey;
}

export function checkPlan(lines: readonly PlannedLine[], items: readonly Item[], P: ResolvedParams): Violation[] {
  const out: Violation[] = [];
  let consec = 0;
  let hyphens = 0;
  let startRun = 0;
  let prevStart: string | undefined;
  let prevEnd: string | undefined;

  lines.forEach((line, i) => {
    const prev = lines[i - 1];
    if (line.width > line.available + TOL) {
      out.push({
        kind: 'overfull',
        severity: 'error',
        line: i,
        message: `Line is ${fmt(line.width - line.available)} pt wider than the measure.`,
      });
    }

    if (line.kind === 'band' && P.style === 'functional') {
      // Functional style: one zone, no order. A line ending outside it is the only rhythm error.
      const Zf = (P.flatterzone * (line.available + line.indent)) / P.measure;
      if (line.gap < -TOL || line.gap > Zf + TOL) {
        const off = line.gap < 0 ? -line.gap : line.gap - Zf;
        out.push({
          kind: 'band',
          severity: 'error',
          line: i,
          message: `Line ends ${fmt(off)} pt outside the rag zone (${line.gap < 0 ? 'too long' : 'too short: a hole in the rag'}).`,
        });
      }
    } else if (line.kind === 'band') {
      // Flatterzone, band and contrast scale with the line's measure (lineMeasures).
      const scale = (line.available + line.indent) / P.measure;
      const Z = P.flatterzone * scale;
      const b = P.band * scale;
      const contrast = P.contrast * scale;
      const lo = line.role === 'long' ? 0 : Z;
      const hi = lo + b;
      if (line.gap < lo - TOL || line.gap > hi + TOL) {
        const off = line.gap < lo ? lo - line.gap : line.gap - hi;
        out.push({
          kind: 'band',
          severity: 'error',
          line: i,
          message: `${line.role === 'long' ? 'Long' : 'Short'} line misses its band by ${fmt(off)} pt (${line.gap < lo ? 'too long' : 'too short'}).`,
        });
      }
      if (line.gap > Z + b + TOL) {
        out.push({ kind: 'hole', severity: 'warning', line: i, message: 'Line is shorter than the short band: a hole in the rag.' });
      }
      if (prev?.kind === 'band') {
        const diff = line.role === 'short' ? line.gap - prev.gap : prev.gap - line.gap;
        if (diff < contrast - TOL) {
          out.push({
            kind: 'contrast',
            severity: 'error',
            line: i,
            message: `Long/short contrast with the previous line is ${fmt(diff)} pt, below the minimum ${fmt(contrast)} pt.`,
          });
        }
      }
    }

    consec = line.endsWithHyphen ? consec + 1 : 0;
    if (consec === P.maxConsecutiveHyphens + 1) {
      out.push({
        kind: 'consecutive-hyphens',
        severity: 'error',
        line: i,
        message: `More than ${P.maxConsecutiveHyphens} hyphenated lines in a row.`,
      });
    }
    if (line.hyphenClass) {
      hyphens++;
      if (line.hyphenClass === 'X') {
        out.push({ kind: 'class-c-hyphen', severity: 'error', line: i, message: 'Vetoed hyphenation point used. This is a bug.' });
      } else if (line.hyphenClass === 'C') {
        out.push({
          kind: 'class-c-hyphen',
          severity: 'warning',
          line: i,
          message: `Uncertain hyphenation "${line.text.trim().split(/\s/).pop()}": only one source accepts it. Review it.`,
        });
      }
    }

    const brk = items[line.breakAt];
    if (line.kind === 'band' && brk) {
      const cost = brk.type === 'glue' ? brk.breakCost : brk.type === 'penalty' ? brk.cost : undefined;
      const reason = brk.type === 'glue' ? brk.breakReason : brk.type === 'penalty' ? brk.reason : undefined;
      if (cost && cost > 0) {
        out.push({ kind: 'sense', severity: 'info', line: i, message: reason ?? 'Line break splits a unit of meaning.' });
      }
    }

    const startWord = prev?.endsWithHyphen ? undefined : wordAt(items, line.startItem, 'start');
    const endWord = line.endsWithHyphen ? undefined : wordAt(items, line.endItem - 1, 'end');
    startRun = startWord !== undefined && startWord === prevStart ? startRun + 1 : 1;
    if (startRun === 3) {
      out.push({ kind: 'same-start', severity: 'warning', line: i, message: `Three lines in a row start with "${startWord}".` });
    }
    if (endWord !== undefined && endWord === prevEnd) {
      out.push({ kind: 'same-end', severity: 'info', line: i, message: `Two lines in a row end with "${endWord}".` });
    }
    prevStart = startWord;
    prevEnd = endWord;

    if (line.tracking !== 0) {
      // The functional zone rescue works like precise mode: fractional values, word spaces allowed.
      const precise = P.tracking.mode === 'precise' || P.style === 'functional';
      const allowed = P.tracking.enabled && Math.abs(line.tracking) <= P.tracking.max + 1e-9 && (precise || Number.isInteger(line.tracking));
      if (allowed && precise) {
        // Every line is tracked in precise mode; the paragraph summary reports it instead.
      } else out.push(
        allowed
          ? {
              kind: 'tracking',
              severity: 'info',
              line: i,
              message: `Tracking ${line.tracking > 0 ? '+' : ''}${line.tracking}/1000 em (Laufweite) brings this line into its band.`,
            }
          : {
              kind: 'tracking-limit',
              severity: 'error',
              line: i,
              message: `Tracking ${line.tracking}/1000 em is outside the allowed ±${P.tracking.enabled ? P.tracking.max : 0}.`,
            },
      );
    }

    if (line.wordSpace !== 0) {
      const ok = P.tracking.enabled && (P.tracking.mode === 'precise' || P.style === 'functional') && Math.abs(line.wordSpace) <= P.tracking.wordSpaceMax + 1e-9;
      if (!ok) {
        out.push({
          kind: 'tracking-limit',
          severity: 'error',
          line: i,
          message: `Word spaces tracked ${line.wordSpace}/1000 em, outside the allowed ±${P.tracking.mode === 'precise' ? P.tracking.wordSpaceMax : 0}.`,
        });
      }
    }

    if (line.kind === 'band' && Number.isFinite(line.slack) && line.slack < 2 * P.epsilon) {
      out.push({
        kind: 'tight-steering',
        severity: 'info',
        line: i,
        message: `Only ${fmt(line.slack)} pt separate this break from the next one; steering may be fragile.`,
      });
    }
  });

  const last = lines[lines.length - 1];
  const prev = lines[lines.length - 2];
  if (last?.kind === 'last' && prev) {
    let glueCount = 0;
    let letters = 0;
    for (let k = last.startItem; k < last.endItem; k++) {
      const it = items[k]!;
      if (it.type === 'glue') glueCount++;
      else if (it.type === 'box' && it.text) letters += it.text.match(LETTER)?.length ?? 0;
    }
    const singleWord = glueCount === 0;
    if (singleWord && P.lastLine.forbidStub && prev.endsWithHyphen) {
      out.push({
        kind: 'last-line-stub',
        severity: 'error',
        line: last.index,
        message: 'The last line is only the end of a hyphenated word.',
      });
    }
    // After a forced line break the last line cannot be longer: the rule does not apply (same as the solver).
    if (singleWord && letters > 0 && letters < P.lastLine.minLetters && prev.kind !== 'forced') {
      out.push({
        kind: 'last-line-short-word',
        severity: 'error',
        line: last.index,
        message: `The last line is a single word of fewer than ${P.lastLine.minLetters} letters.`,
      });
    }
    if (P.style !== 'functional' && P.lastLine.shortAfterLong && prev.kind === 'band' && prev.role === 'long' && last.gap < (P.flatterzone * (last.available + last.indent)) / P.measure - TOL) {
      out.push({
        kind: 'last-line-too-long',
        severity: 'warning',
        line: last.index,
        message: 'The last line follows a long line but reaches past the short target, so it reads as long.',
      });
    }
    if (P.lastLine.minWidth > 0 && last.width < P.lastLine.minWidth) {
      out.push({ kind: 'last-line-too-short', severity: 'warning', line: last.index, message: 'The last line is shorter than the minimum.' });
    }
    if (prev.endsWithHyphen) {
      out.push({ kind: 'penultimate-hyphen', severity: 'warning', line: prev.index, message: 'Hyphen on the line before the last line.' });
    }
  }

  if (hyphens > P.weights.hyphenBudget) {
    out.push({
      kind: 'hyphen-budget',
      severity: 'info',
      line: -1,
      message: `${hyphens} hyphens; the budget for this paragraph is ${P.weights.hyphenBudget}.`,
    });
  }

  out.push(...analysePattern(lines));
  return out;
}

/**
 * Staircases (plan §2A.3). The mechanical-sawtooth warning (§2A.4) was removed on 2026-10-17:
 * the designer wants long and short line ends as exact as possible (ADR-013), so even edges are the goal.
 */
export function analysePattern(lines: readonly PlannedLine[]): Violation[] {
  const out: Violation[] = [];
  // Line ends measured from each line's own measure, so a change of frame width is not a staircase.
  const edges = lines.map((l) => -l.gap);
  for (let i = 2; i < lines.length; i++) {
    // Only lines that take part in the rhythm, as in the solver: a forced or last line is no step of a staircase.
    if (lines[i]!.kind !== 'band' || lines[i - 1]!.kind !== 'band' || lines[i - 2]!.kind !== 'band') continue;
    const d1 = edges[i - 1]! - edges[i - 2]!;
    const d2 = edges[i]! - edges[i - 1]!;
    if ((d1 > STAIR_STEP && d2 > STAIR_STEP) || (d1 < -STAIR_STEP && d2 < -STAIR_STEP)) {
      out.push({ kind: 'staircase', severity: 'warning', line: i, message: 'Three lines in a row get progressively longer or shorter (Treppe).' });
    }
  }
  return out;
}

function spread(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
}

export function planStats(lines: readonly PlannedLine[]): Omit<PlanStats, 'states'> {
  const band = lines.filter((l) => l.kind === 'band');
  const miss = band.map((l) => Math.abs(l.available - l.targetWidth - l.gap));
  const range = (xs: number[]) => (xs.length ? Math.max(...xs) - Math.min(...xs) : 0);
  return {
    edgeMiss: miss.length ? Math.max(...miss) : 0,
    longEdgeRange: range(band.filter((l) => l.role === 'long').map((l) => l.gap)),
    shortEdgeRange: range(band.filter((l) => l.role === 'short').map((l) => l.gap)),
    lines: lines.length,
    bandLines: band.length,
    hyphens: lines.filter((l) => l.hyphenClass !== undefined).length,
    trackedLines: lines.filter((l) => l.tracking !== 0).length,
    spacedLines: lines.filter((l) => l.wordSpace !== 0).length,
    longGapSpread: spread(band.filter((l) => l.role === 'long').map((l) => l.gap)),
    shortGapSpread: spread(band.filter((l) => l.role === 'short').map((l) => l.gap)),
  };
}
