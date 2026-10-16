/**
 * The strict alternating rag solver (plan §4).
 *
 * Dynamic programming over lines. A state is one line (start break a, end
 * break b) plus its role, the current run of consecutive hyphenated lines and
 * the hyphen count so far. Keeping the whole line in the state makes
 * pairwise rules between neighbouring lines (contrast, same word) exact.
 */
import type { Item } from './items.ts';
import { ParagraphMetrics } from './metrics.ts';
import { opposite, resolveParams, type FlatterSettings, type ResolvedParams, type Role } from './params.ts';
import type { Plan, PlannedLine } from './plan.ts';
import { unitHash } from './random.ts';
import { checkPlan, planStats } from './check.ts';

const TOL = 1e-6;

/** Cost tiers for Soft mode, ordered by the priority list in plan §7.4. */
export const SOFT_COST = {
  overfull: 1e9,
  band: 1e7,
  contrast: 1e7,
  consecutiveHyphens: 1e7,
  bandSlope: 1e6,
  lastLineRule: 1e6,
} as const;

interface Node {
  cost: number;
  prev: Node | null;
  a: number;
  b: number;
  role: Role;
  /** Last line, forced line or the virtual paragraph start: no band, no contrast. */
  exempt: boolean;
  virtual: boolean;
  gap: number;
  consec: number;
  hyphens: number;
  flagged: boolean;
  startWord: string | undefined;
  endWord: string | undefined;
  startRun: number;
}

interface DPResult {
  node: Node;
  states: number;
}

function hyphenCost(P: ResolvedParams, quality: string): number {
  const w = P.weights;
  switch (quality) {
    case 'A':
      return w.hyphenA * P.widthFactor;
    case 'B':
      return w.hyphenB * P.widthFactor * P.widthFactor;
    case 'C':
      return w.hyphenC;
    default:
      return Infinity;
  }
}

/** Target gap (distance from the full measure) of a band line. */
export function targetGap(P: ResolvedParams, role: Role, startItem: number): number {
  const lo = role === 'long' ? 0 : P.flatterzone;
  if (P.variation === 0) return lo;
  return lo + P.variation * P.band * unitHash(P.variationSeed, startItem);
}

function runDP(M: ParagraphMetrics, P: ResolvedParams, startRole: Role, hard: boolean): DPResult | null {
  const { items, n, candidates } = M;
  const Z = P.flatterzone;
  const band = P.band;
  const W = P.weights;
  const hyphenCap = W.hyphenBudget + 6;
  const buckets = new Map<number, Map<string, Node>>();
  let states = 0;

  const add = (node: Node): void => {
    const key = `${node.a}|${node.role}|${node.consec}|${Math.min(node.hyphens, hyphenCap)}`;
    let bucket = buckets.get(node.b);
    if (!bucket) {
      bucket = new Map();
      buckets.set(node.b, bucket);
    }
    const old = bucket.get(key);
    if (!old || node.cost < old.cost) {
      if (!old) states++;
      bucket.set(key, node);
    }
  };

  const extend = (node: Node, fromIdx: number): void => {
    const a = node.b;
    const first = a < 0;
    const indent = first ? P.firstLineIndent : 0;
    const avail = P.measure - indent;
    const role = opposite(node.role);

    /**
     * Evaluate the line from a to candidates[i] and add it as a state.
     * stop: no later candidate can fit. next: try the next candidate.
     * short: skipped as hopelessly short (Soft mode only); added: a state was added.
     */
    const consider = (i: number, allowSkip: boolean): 'stop' | 'next' | 'short' | 'added' => {
      const b = candidates[i]!;
      const g = M.geometry(a, b);
      const content = M.contentWidth(g.start, g.end);
      const final = b === n;
      const forced = !final && M.isForced(b);
      let overfull = 0;
      if (content > avail + TOL || g.width > avail + TOL) {
        // Too wide. Soft mode may keep the shortest possible line when nothing fits.
        if (hard || i !== fromIdx) return content > avail + TOL ? 'stop' : 'next';
        overfull = g.width - avail;
      }

      const exempt = final || forced;
      const gap = avail - g.width;
      let cost = node.cost;
      if (overfull > 0) cost += SOFT_COST.overfull * (1 + overfull);

      if (!exempt) {
        const lo = role === 'long' ? 0 : Z;
        const hi = lo + band;
        const dist = gap < lo ? lo - gap : gap > hi ? gap - hi : 0;
        if (dist > TOL) {
          if (hard) return 'next';
          // A line far shorter than any band is only worth keeping when nothing longer fits.
          if (allowSkip && gap > hi + Z) return 'short';
          cost += SOFT_COST.band + SOFT_COST.bandSlope * (dist / band) ** 2;
        }
        const target = targetGap(P, role, g.start);
        cost += W.centring * ((gap - target) / band) ** 2;
        if (!node.exempt) {
          // Short gap minus long gap: how much shorter the short neighbour is.
          const diff = role === 'short' ? gap - node.gap : node.gap - gap;
          if (diff < P.contrast - TOL) {
            if (hard) return 'next';
            cost += SOFT_COST.contrast + SOFT_COST.bandSlope * ((P.contrast - diff) / band) ** 2;
          }
        }
      }

      // Cost of the break itself.
      let consec = 0;
      let hyphens = node.hyphens;
      let flagged = false;
      if (!final && !forced) {
        const it = items[b]!;
        if (it.type === 'glue') {
          cost += (it.breakCost ?? 0) * W.sense;
        } else if (it.type === 'penalty') {
          cost += it.cost ?? 0;
          if (it.flagged) {
            flagged = true;
            consec = node.consec + 1;
            if (consec > P.maxConsecutiveHyphens) {
              if (hard) return 'next';
              cost += SOFT_COST.consecutiveHyphens;
            }
          }
          if (it.quality) {
            cost += hyphenCost(P, it.quality);
            hyphens = node.hyphens + 1;
            const over = hyphens - W.hyphenBudget;
            if (over > 0) cost += W.overBudget * (2 * over - 1);
          }
        }
      }

      if (final && !first) {
        if (node.flagged) cost += W.penultimateHyphen;
        const singleWord = M.glueCount(g.start, g.end) === 0;
        if (singleWord && P.lastLine.forbidStub && node.flagged) {
          if (hard) return 'next';
          cost += SOFT_COST.lastLineRule;
        }
        const letters = M.letters(g.start, g.end);
        if (singleWord && letters > 0 && letters < P.lastLine.minLetters) {
          if (hard) return 'next';
          cost += SOFT_COST.lastLineRule;
        }
        if (P.lastLine.shortAfterLong && !node.exempt && node.role === 'long' && gap < Z - TOL) {
          cost += W.lastLineTooLong * (1 + ((Z - gap) / band) ** 2);
        }
        if (P.lastLine.minWidth > 0 && g.width < P.lastLine.minWidth) cost += W.lastLineTooShort;
      }

      // Same word at the start or end of neighbouring lines.
      const firstBox = items[g.start];
      const lastBox = items[g.end - 1];
      const startWord = firstBox?.type === 'box' && firstBox.wordStart ? firstBox.wordKey : undefined;
      const endWord = lastBox?.type === 'box' && lastBox.wordEnd && !flagged ? lastBox.wordKey : undefined;
      let startRun = 1;
      if (!node.virtual && startWord !== undefined && startWord === node.startWord) {
        startRun = node.startRun + 1;
        cost += W.sameStart * (startRun >= 3 ? 10 : 1);
      }
      if (!node.virtual && endWord !== undefined && endWord === node.endWord) cost += W.sameEnd;

      add({
        cost,
        prev: node,
        a,
        b,
        role,
        exempt,
        virtual: false,
        gap,
        consec,
        hyphens,
        flagged,
        startWord,
        endWord,
        startRun,
      });

      return forced ? 'stop' : 'added';
    };

    let pendingShort = -1;
    for (let i = fromIdx; i < candidates.length; i++) {
      const r = consider(i, !hard);
      if (r === 'short') pendingShort = i;
      else if (r === 'added' || M.isForced(candidates[i]!)) pendingShort = -1;
      // Never run past a forced break: the line must end there.
      if (r === 'stop' || M.isForced(candidates[i]!)) break;
    }
    // Nothing longer than the skipped short line could be set: keep it after all.
    if (pendingShort >= 0) consider(pendingShort, false);
  };

  const start: Node = {
    cost: 0,
    prev: null,
    a: -2,
    b: -1,
    role: opposite(startRole),
    exempt: true,
    virtual: true,
    gap: 0,
    consec: 0,
    hyphens: 0,
    flagged: false,
    startWord: undefined,
    endWord: undefined,
    startRun: 0,
  };
  extend(start, 0);
  for (let ci = 0; ci < candidates.length - 1; ci++) {
    const bucket = buckets.get(candidates[ci]!);
    if (!bucket) continue;
    let nodes = [...bucket.values()];
    if (!hard && nodes.length > P.softBeam) {
      // Soft mode explores far more lines; keep only the cheapest states per break.
      nodes.sort((x, y) => x.cost - y.cost);
      nodes = nodes.slice(0, P.softBeam);
    }
    for (const node of nodes) extend(node, ci + 1);
    buckets.delete(candidates[ci]!);
  }
  const finals = buckets.get(n);
  if (!finals || finals.size === 0) return null;
  let best: Node | null = null;
  for (const node of finals.values()) if (!best || node.cost < best.cost) best = node;
  return best ? { node: best, states } : null;
}

interface LineSpec {
  a: number;
  b: number;
  role: Role;
}

function buildLines(M: ParagraphMetrics, P: ResolvedParams, specs: readonly LineSpec[]): PlannedLine[] {
  return specs.map((spec, index) => {
    const g = M.geometry(spec.a, spec.b);
    const first = spec.a < 0;
    const indent = first ? P.firstLineIndent : 0;
    const available = P.measure - indent;
    const final = spec.b === M.n;
    const kind = final ? 'last' : M.isForced(spec.b) ? 'forced' : 'band';
    const pen = final ? undefined : M.penaltyAt(spec.b);
    const endsWithHyphen = pen?.flagged === true;
    const slack = M.nextInk(spec.a, spec.b) - g.ink;
    const steerWidth =
      kind === 'band'
        ? Math.max(g.ink, Math.min(g.ink + Math.min(P.epsilon, slack / 2), Math.max(available, g.ink)))
        : available;
    const targetWidth = kind === 'band' ? available - targetGap(P, spec.role, g.start) : g.width;
    const line: PlannedLine = {
      index,
      role: spec.role,
      kind,
      breakAt: spec.b,
      startItem: g.start,
      endItem: g.end,
      endsWithHyphen,
      indent,
      available,
      width: g.width,
      inkWidth: g.ink,
      gap: available - g.width,
      targetWidth,
      steerWidth,
      slack,
      text: M.text(g.start, g.end, spec.b),
    };
    if (pen?.quality) line.hyphenClass = pen.quality;
    return line;
  });
}

function specsFromNode(last: Node): LineSpec[] {
  const chain: LineSpec[] = [];
  for (let node: Node | null = last; node && !node.virtual; node = node.prev) {
    chain.push({ a: node.a, b: node.b, role: node.role });
  }
  return chain.reverse();
}

export interface Evaluation {
  lines: PlannedLine[];
  violations: ReturnType<typeof checkPlan>;
  feasible: boolean;
}

/**
 * Evaluate given break positions, for example the line ends InDesign actually
 * composed (plan §6.2 read back). `breaks` lists the break position of every
 * line except the last; the paragraph end is added automatically.
 */
export function evaluateBreaks(
  items: readonly Item[],
  settings: FlatterSettings,
  breaks: readonly number[],
  startRole: Role = 'long',
): Evaluation {
  const P = resolveParams(settings, items);
  const M = new ParagraphMetrics(items, P);
  const ends = [...breaks.filter((b) => b >= 0 && b < M.n), M.n];
  const specs: LineSpec[] = [];
  let a = -1;
  let role = startRole;
  for (const b of ends) {
    if (b <= a) throw new RangeError(`breaks must be strictly ascending, got ${b} after ${a}`);
    specs.push({ a, b, role });
    a = b;
    role = opposite(role);
  }
  const lines = buildLines(M, P, specs);
  const violations = checkPlan(lines, items, P);
  return { lines, violations, feasible: !violations.some((v) => v.severity === 'error') };
}

/** Solve one paragraph. Never throws for difficult text: it reports violations instead. */
export function solveParagraph(items: readonly Item[], settings: FlatterSettings): Plan {
  const P = resolveParams(settings, items);
  const M = new ParagraphMetrics(items, P);
  if (!items.some((it) => it.type === 'box')) {
    const startRole = P.startRole ?? (P.phase === 'short' ? 'short' : 'long');
    return {
      lines: [],
      violations: [],
      cost: 0,
      feasible: true,
      solvedAs: P.mode,
      startRole,
      phaseFlipped: false,
      params: P,
      stats: { ...planStats([]), states: 0 },
    };
  }
  const requested: Role[] = P.startRole
    ? [P.startRole]
    : P.phase === 'auto'
      ? ['long', 'short']
      : [P.phase];

  const pick = (roles: Role[], hard: boolean): { res: DPResult; role: Role } | null => {
    let best: { res: DPResult; role: Role } | null = null;
    for (const role of roles) {
      const res = runDP(M, P, role, hard);
      if (res && (!best || res.node.cost < best.res.node.cost)) best = { res, role };
    }
    return best;
  };

  let solvedAs: 'strict' | 'soft' = 'strict';
  let phaseFlipped = false;
  let found = P.mode === 'strict' ? pick(requested, true) : null;
  if (!found && P.mode === 'strict' && requested.length === 1) {
    // Plan §4.3 step 1: try the other phase.
    found = pick([opposite(requested[0]!)], true);
    phaseFlipped = found !== null;
  }
  if (!found) {
    solvedAs = 'soft';
    found = pick(requested, false);
  }
  if (!found) throw new Error('solver found no path; this is a bug (soft mode always has one)');

  const lines = buildLines(M, P, specsFromNode(found.res.node));
  const violations = checkPlan(lines, items, P);
  if (phaseFlipped) {
    violations.unshift({
      kind: 'phase-flipped',
      severity: 'info',
      line: -1,
      message: `Starting ${requested[0]} is impossible here; the paragraph starts ${found.role} instead.`,
    });
  }
  return {
    lines,
    violations,
    cost: found.res.node.cost,
    feasible: !violations.some((v) => v.severity === 'error'),
    solvedAs,
    startRole: found.role,
    phaseFlipped,
    params: P,
    stats: { ...planStats(lines), states: found.res.states },
  };
}

export interface StorySettings extends FlatterSettings {
  /** Continue the long/short rhythm across paragraph breaks instead of applying `phase` to each paragraph. */
  continuous?: boolean;
}

/** Solve consecutive paragraphs. With `continuous`, each paragraph picks up the rhythm where the previous one ended. */
export function solveStory(paragraphs: readonly (readonly Item[])[], settings: StorySettings): Plan[] {
  const plans: Plan[] = [];
  let nextRole: Role | undefined;
  for (const items of paragraphs) {
    const s: FlatterSettings = settings.continuous && nextRole ? { ...settings, startRole: nextRole } : settings;
    const plan = solveParagraph(items, s);
    plans.push(plan);
    const lastLine = plan.lines[plan.lines.length - 1];
    nextRole = lastLine ? opposite(lastLine.role) : nextRole;
  }
  return plans;
}
