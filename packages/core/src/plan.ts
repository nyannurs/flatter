import type { HyphenClass } from './items.ts';
import type { ResolvedParams, Role } from './params.ts';

/** band: must sit in its band. last: the Ausgangszeile. forced: ends at a forced line break. */
export type LineKind = 'band' | 'last' | 'forced';

export interface PlannedLine {
  index: number;
  /** Long or short by parity. The last line and forced lines keep their parity but are exempt from bands. */
  role: Role;
  kind: LineKind;
  /** Break position: index of the glue or penalty the line ends at, or items.length. */
  breakAt: number;
  /** First content item. */
  startItem: number;
  /** One past the last content item. */
  endItem: number;
  endsWithHyphen: boolean;
  hyphenClass?: HyphenClass;
  /** Line indent from the left edge of the measure (first-line indent). */
  indent: number;
  /** Available width for this line: measure minus indent. */
  available: number;
  /** Width used for band checks. Excludes a hanging hyphen. */
  width: number;
  /** Visible width including any hyphen. */
  inkWidth: number;
  /** available − width: how far the line falls short of the full measure. */
  gap: number;
  /** Width the solver aimed for. */
  targetWidth: number;
  /** Maximum width to impose on the composer (planned ink width + steering margin). */
  steerWidth: number;
  /** Extra width the composer would need to take one more fragment. Infinity on the last line. */
  slack: number;
  /** Tracking (Laufweite) applied to this line in 1/1000 em; 0 when untouched. */
  tracking: number;
  text: string;
}

export type ViolationKind =
  | 'band'
  | 'hole'
  | 'contrast'
  | 'overfull'
  | 'consecutive-hyphens'
  | 'last-line-stub'
  | 'last-line-short-word'
  | 'last-line-too-long'
  | 'last-line-too-short'
  | 'penultimate-hyphen'
  | 'hyphen-budget'
  | 'class-c-hyphen'
  | 'sense'
  | 'same-start'
  | 'same-end'
  | 'staircase'
  | 'mechanical-pattern'
  | 'phase-flipped'
  | 'tight-steering'
  | 'tracking'
  | 'tracking-limit';

/**
 * error: breaks a Strict-mode rule. warning: a typographic fault the designer
 * should look at. info: worth knowing, no action needed.
 */
export type Severity = 'error' | 'warning' | 'info';

export interface Violation {
  kind: ViolationKind;
  severity: Severity;
  /** Line index, or -1 for the paragraph as a whole. */
  line: number;
  message: string;
}

export interface PlanStats {
  lines: number;
  bandLines: number;
  hyphens: number;
  /** Spread of long-line right edges (standard deviation of gaps, pt). Band drift, plan §2A.4. */
  longGapSpread: number;
  shortGapSpread: number;
  /** Lines with tracking (Laufweite) applied. */
  trackedLines: number;
  /** Largest distance of a band line's end from its target, in points. */
  edgeMiss: number;
  /** Spread of the long lines' ends and of the short lines' ends (max − min of their gaps), in points. */
  longEdgeRange: number;
  shortEdgeRange: number;
  /** DP states explored, for performance tracking. */
  states: number;
}

export interface Plan {
  lines: PlannedLine[];
  violations: Violation[];
  cost: number;
  /** True when no error-level violation remains: strict alternation and all hard rules hold. */
  feasible: boolean;
  /** Constraint set that produced the plan. soft = strict was impossible or soft mode was chosen. */
  solvedAs: 'strict' | 'soft';
  startRole: Role;
  /** The requested phase was impossible and the other phase was used. */
  phaseFlipped: boolean;
  params: ResolvedParams;
  stats: PlanStats;
}
