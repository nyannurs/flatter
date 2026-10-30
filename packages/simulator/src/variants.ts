/**
 * The variants Flatter weighs, for the playground's animation: plausible break sets for a paragraph (the greedy
 * first-fit set a plain composer would take, and random rags of varying looseness), each scored with the solver's
 * own costs (scoreBreaks), next to the plan the solver chose. The solver itself never lists variants: its dynamic
 * program finds the cheapest set among all of them at once.
 */
import { ParagraphMetrics, planStats, resolveParams, scoreBreaks, type FlatterSettings, type Item, type Plan } from '@flatter/core';

export interface Variant {
  plan: Plan;
  /** Break positions of every line but the last. */
  breaks: number[];
  cost: number;
  /** Rule breaks (error-level violations): ranked before cost, as the solver tries strict before soft. */
  errors: number;
  source: 'flatter' | 'greedy' | 'random';
}

/** Small deterministic random numbers (mulberry32), so the animation is the same on every run. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Worse first: more rule breaks, then higher cost. */
export function compareVariants(x: Variant, y: Variant): number {
  return y.errors - x.errors || y.cost - x.cost;
}

/**
 * Up to `count` variants of one paragraph, sorted worst to best, with Flatter's own plan last. `beatsFlatter`
 * counts variants that rank better than Flatter's plan (possible only when the paragraph fell back to soft mode,
 * where the solver keeps a beam of states).
 */
export function paragraphVariants(items: readonly Item[], settings: FlatterSettings, plan: Plan, count = 300, seed = 1): { variants: Variant[]; beatsFlatter: number } {
  if (!plan.lines.length) return { variants: [], beatsFlatter: 0 };
  const P = resolveParams(settings, items);
  const M = new ParagraphMetrics(items, P);
  const n = M.n;
  // Score the way the solver solved: with Laufweite when it may use it from the start, or when the plan used it.
  const precise = P.tracking.enabled && (P.tracking.mode === 'precise' || P.style === 'functional');
  const tracking = precise || plan.lines.some((l) => l.tracking !== 0 || l.wordSpace !== 0);
  const rand = random(seed);

  // Walk the paragraph: at each break, list the breaks whose line still fits, then let `pick` choose one.
  const walk = (pick: (fits: number[]) => number): number[] => {
    const breaks: number[] = [];
    let a = -1;
    for (;;) {
      const avail = P.measure - (a < 0 ? P.firstLineIndent : 0);
      const fits: number[] = [];
      for (const c of M.candidates) {
        if (c <= a) continue;
        if (fits.length && M.geometry(a, c).width > avail) break;
        fits.push(c);
        if (c === n || M.isForced(c)) break;
      }
      const b = pick(fits);
      if (b >= n) return breaks;
      breaks.push(b);
      a = b;
    }
  };

  const seen = new Set<string>();
  const out: Variant[] = [];
  const add = (breaks: number[], source: Variant['source']): void => {
    const key = breaks.join(',');
    if (seen.has(key)) return;
    seen.add(key);
    const s = source === 'flatter' ? undefined : scoreBreaks(items, settings, breaks, plan.startRole, tracking);
    if (source !== 'flatter' && !s) return;
    const own = source === 'flatter' ? scoreBreaks(items, settings, breaks, plan.startRole, tracking) : s;
    const shown: Plan = source === 'flatter' ? plan : { ...plan, lines: s!.lines, violations: s!.violations, feasible: s!.feasible, cost: s!.cost, phaseFlipped: false, stats: { ...planStats(s!.lines), states: 0 } };
    out.push({
      plan: shown,
      breaks,
      cost: own?.cost ?? plan.cost,
      errors: shown.violations.filter((v) => v.severity === 'error').length,
      source,
    });
  };

  add(plan.lines.slice(0, -1).map((l) => l.breakAt), 'flatter');
  add(walk((fits) => fits[fits.length - 1]!), 'greedy');
  for (let k = 0; out.length < count && k < count * 4; k++) {
    // Looseness: how many of the longest fitting breaks a line may choose from.
    const loose = 1 + Math.floor(rand() * 7);
    add(walk((fits) => fits[Math.max(0, fits.length - 1 - Math.floor(rand() * loose))]!), 'random');
  }

  const flatter = out[0]!;
  const others = out.slice(1).sort(compareVariants);
  const beatsFlatter = others.filter((v) => compareVariants(v, flatter) > 0).length;
  return { variants: [...others, flatter], beatsFlatter };
}
