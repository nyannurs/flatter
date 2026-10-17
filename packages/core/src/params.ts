/**
 * Solver settings, defaults and the derived helpers from plan §2 and §2A.
 */
import type { Item } from './items.ts';

export type Role = 'long' | 'short';
export type Phase = 'long' | 'short' | 'auto';
export type Mode = 'strict' | 'soft';
export type HyphenationMode = 'safe' | 'normal';
export type Language = 'de' | 'en';

export interface Weights {
  /** Quadratic cost of a line's distance from its target, per band width. */
  centring: number;
  /** Base cost of a hyphenated line end per quality class. */
  hyphenA: number;
  hyphenB: number;
  hyphenC: number;
  /** Hyphens per paragraph before the budget penalty starts. */
  hyphenBudget: number;
  /** Cost growth for each hyphen beyond the budget (quadratic in the excess). */
  overBudget: number;
  /** Hyphen on the line before the Ausgangszeile. */
  penultimateHyphen: number;
  /** Multiplier on break costs carried by items (Sinneinheiten). */
  sense: number;
  /** Two consecutive lines starting with the same word. */
  sameStart: number;
  /** Two consecutive lines ending with the same word. */
  sameEnd: number;
  /** Ausgangszeile reads as long after a long line. */
  lastLineTooLong: number;
  /** Ausgangszeile shorter than lastLine.minWidth. */
  lastLineTooShort: number;
  /** Fixed cost of tracking a line (only used when tracking is enabled). */
  trackingBase: number;
  /** Extra cost growing with the square of the tracking, at the maximum. */
  trackingSlope: number;
  /**
   * Precise mode: cost of a line end missing its target, per (miss / band)². High on purpose (ADR-013):
   * a whole band's miss costs as much as a hyphen before the last line, so edge precision ranks above
   * the hyphen budget and Sinneinheiten, below correct hyphenation, alternation and the last-line rules.
   */
  edge: number;
  /** Precise mode: cost of tracking, per (tracking / max)²: prefer the least tracking that hits the edge. */
  trackingPrecise: number;
}

/**
 * Tracking (Laufweite). Off by default (ADR-002).
 * - rescue (ADR-010): whole units, only for lines that miss their band, only when the paragraph
 *   cannot be set strictly without it.
 * - precise (ADR-013, the designer's intent): every long and short line gets the tracking that puts
 *   its end on its target (long: the full measure, short: the Flatterzone), within ±max, in steps of
 *   0.01 unit. The solver chooses breaks knowing tracking will close the remaining gap.
 */
export interface TrackingRules {
  enabled: boolean;
  mode: 'rescue' | 'precise';
  /** Largest tracking on one line, in 1/1000 em, tighter or looser. */
  max: number;
  /** The em in points (the font size). Needed to turn units into width. */
  emSize: number;
  /**
   * Precise mode: no line is tracked closer than this to the measure, in points (default 0.1 em).
   * InDesign sets some tracked lines up to about 1 pt wider than measured (kerning next to tracking,
   * user's text 2026-10-17); a line planned exactly at the measure then loses its last word.
   */
  safety: number;
  /**
   * Precise mode: largest tracking added to the word spaces inside a line, in 1/1000 em per space,
   * wider or narrower (ADR-015). 0 = word spaces stay as set.
   */
  wordSpaceMax: number;
}

/** Suggested maximum when tracking is enabled (ADR-010). */
export const DEFAULT_TRACKING_MAX = 3;

export interface LastLineRules {
  /** Never a single word with fewer letters than this (Bringhurst §2.4.2). */
  minLetters: number;
  /** Never only the remainder of a hyphenated word. */
  forbidStub: boolean;
  /** After a long line, the last line must not reach past the short target. */
  shortAfterLong: boolean;
  /** Minimum width in points. 0 disables. */
  minWidth: number;
}

export interface FlatterSettings {
  /** W: full line width in points, after left and right indents. */
  measure: number;
  /** Z: distance of the short-line target from W. Default from defaultFlatterzone(). */
  flatterzone?: number;
  /** b: how far a line may fall short of its target. Default Z / 2 (see ADR-006). */
  band?: number;
  /** c: minimum width difference between neighbouring long and short lines. Default Z − b. */
  contrast?: number;
  /** Extra left indent of the first line. Its bands are measured from the indent. */
  firstLineIndent?: number;
  /**
   * The measure of each line when it differs from line to line, for example in threaded frames of
   * different widths: lineMeasures[i] is line i's measure, lines beyond the list take the last entry.
   * Flatterzone, band and contrast scale with each line's measure (they are set relative to `measure`),
   * so a percentage setting means the same in a wide frame as in a narrow one.
   */
  lineMeasures?: readonly number[];
  /** ε: steering margin added to the planned width (plan §3). */
  epsilon?: number;
  phase?: Phase;
  /** Overrides phase. Used when the rhythm continues across paragraphs. */
  startRole?: Role;
  mode?: Mode;
  hyphenation?: HyphenationMode;
  maxConsecutiveHyphens?: number;
  /** false = hanging hyphens: the hyphen does not count towards line length. */
  hyphenCountsTowardWidth?: boolean;
  /** 0…1: share of the band used for seeded per-line target variation. */
  variation?: number;
  variationSeed?: number;
  language?: Language;
  /** Average characters per line. Estimated from the items when omitted. */
  charsPerLine?: number;
  lastLine?: Partial<LastLineRules>;
  weights?: Partial<Weights>;
  /** Advanced: states kept per break in Soft mode (default 48). Strict mode is always exact. */
  softBeam?: number;
  /** Tracking assist (Laufweite). Off unless enabled. */
  tracking?: Partial<TrackingRules>;
}

export interface ResolvedParams {
  measure: number;
  flatterzone: number;
  band: number;
  contrast: number;
  firstLineIndent: number;
  /** Per-line measures (see FlatterSettings.lineMeasures); undefined when every line has `measure`. */
  lineMeasures: readonly number[] | undefined;
  epsilon: number;
  phase: Phase;
  startRole: Role | undefined;
  mode: Mode;
  hyphenation: HyphenationMode;
  maxConsecutiveHyphens: number;
  hyphenCountsTowardWidth: boolean;
  variation: number;
  variationSeed: number;
  language: Language;
  charsPerLine: number;
  /** Multiplier on hyphen costs: wider measures hyphenate less (plan §2A.5). */
  widthFactor: number;
  lastLine: LastLineRules;
  weights: Weights;
  softBeam: number;
  tracking: TrackingRules;
}

const LANGUAGE_WEIGHTS: Record<Language, Weights> = {
  de: {
    centring: 1,
    hyphenA: 40,
    hyphenB: 120,
    hyphenC: 1500,
    hyphenBudget: 3,
    overBudget: 150,
    penultimateHyphen: 400,
    sense: 1,
    sameStart: 15,
    sameEnd: 15,
    lastLineTooLong: 1e5,
    lastLineTooShort: 1e4,
    trackingBase: 400,
    trackingSlope: 600,
    edge: 400,
    trackingPrecise: 20,
  },
  // English hyphenates less (Hochuli, plan §2A.5).
  en: {
    centring: 1,
    hyphenA: 80,
    hyphenB: 240,
    hyphenC: 3000,
    hyphenBudget: 1,
    overBudget: 300,
    penultimateHyphen: 600,
    sense: 1,
    sameStart: 15,
    sameEnd: 15,
    lastLineTooLong: 1e5,
    lastLineTooShort: 1e4,
    trackingBase: 400,
    trackingSlope: 600,
    edge: 400,
    trackingPrecise: 20,
  },
};

export const DEFAULT_LAST_LINE: LastLineRules = {
  minLetters: 4,
  forbidStub: true,
  shortAfterLong: true,
  minWidth: 0,
};

/** Below this many characters per line a column counts as narrow. */
export const NARROW_COLUMN_CHARS = 45;

/** Default Flatterzone: W/5 for wide columns, W/7 for narrow ones (ZHdK, plan §2). */
export function defaultFlatterzone(measure: number, charsPerLine?: number): number {
  const narrow = charsPerLine !== undefined && charsPerLine < NARROW_COLUMN_CHARS;
  return measure / (narrow ? 7 : 5);
}

/** Slider range for the Flatterzone: roughly W/12 … W/4. */
export function flatterzoneRange(measure: number): { min: number; max: number } {
  return { min: measure / 12, max: measure / 4 };
}

/** Below W/10 the result belongs to the Rauhsatz tradition, not Flattersatz (plan §2A.2). */
export function modeLabel(flatterzone: number, measure: number): 'Flattersatz' | 'Rauhsatz' {
  return flatterzone < measure / 10 ? 'Rauhsatz' : 'Flattersatz';
}

/** Estimate characters per line from the text carried by the items. */
export function estimateCharsPerLine(items: readonly Item[], measure: number): number | undefined {
  let chars = 0;
  let width = 0;
  for (const it of items) {
    if (it.type === 'box' && it.text) {
      chars += [...it.text].length;
      width += it.width;
    } else if (it.type === 'glue') {
      chars += 1;
      width += it.width;
    }
  }
  if (chars === 0 || width <= 0) return undefined;
  return measure / (width / chars);
}

export function resolveParams(settings: FlatterSettings, items: readonly Item[] = []): ResolvedParams {
  const { measure } = settings;
  if (!(measure > 0)) throw new RangeError(`measure must be positive, got ${measure}`);
  const language = settings.language ?? 'de';
  const charsPerLine = settings.charsPerLine ?? estimateCharsPerLine(items, measure) ?? 60;
  const flatterzone = settings.flatterzone ?? defaultFlatterzone(measure, charsPerLine);
  const band = settings.band ?? flatterzone / 2;
  if (!(band > 0)) throw new RangeError(`band must be positive, got ${band}`);
  if (!(flatterzone > band)) {
    throw new RangeError(`flatterzone (${flatterzone}) must be larger than band (${band}) so the bands do not overlap`);
  }
  if (flatterzone + band > measure) {
    throw new RangeError(`flatterzone + band (${flatterzone + band}) exceeds the measure (${measure})`);
  }
  const contrast = settings.contrast ?? flatterzone - band;
  const variation = settings.variation ?? 0;
  if (variation < 0 || variation > 1) throw new RangeError(`variation must be within 0…1, got ${variation}`);
  const widthFactor = Math.min(2, Math.max(0.6, charsPerLine / 60));
  const tracking: TrackingRules = {
    enabled: settings.tracking?.enabled ?? false,
    mode: settings.tracking?.mode ?? 'rescue',
    max: settings.tracking?.max ?? DEFAULT_TRACKING_MAX,
    emSize: settings.tracking?.emSize ?? 0,
    safety: settings.tracking?.safety ?? 0.1 * (settings.tracking?.emSize ?? 0),
    wordSpaceMax: settings.tracking?.wordSpaceMax ?? 0,
  };
  if (tracking.enabled && !(tracking.emSize > 0)) throw new RangeError('tracking.emSize (the font size in points) is required when tracking is enabled');
  if (!(tracking.wordSpaceMax >= 0)) throw new RangeError(`tracking.wordSpaceMax must be zero or more, got ${tracking.wordSpaceMax}`);
  if (!(tracking.max >= 0)) throw new RangeError(`tracking.max must be zero or more, got ${tracking.max}`);
  return {
    measure,
    flatterzone,
    band,
    contrast,
    firstLineIndent: settings.firstLineIndent ?? 0,
    lineMeasures: lineMeasuresOf(settings.lineMeasures, measure),
    epsilon: settings.epsilon ?? 0.15,
    phase: settings.phase ?? 'long',
    startRole: settings.startRole,
    mode: settings.mode ?? 'strict',
    hyphenation: settings.hyphenation ?? 'safe',
    maxConsecutiveHyphens: settings.maxConsecutiveHyphens ?? 2,
    hyphenCountsTowardWidth: settings.hyphenCountsTowardWidth ?? true,
    variation,
    variationSeed: settings.variationSeed ?? 1,
    language,
    charsPerLine,
    widthFactor,
    lastLine: { ...DEFAULT_LAST_LINE, ...settings.lastLine },
    weights: { ...LANGUAGE_WEIGHTS[language], ...settings.weights },
    softBeam: settings.softBeam ?? 48,
    tracking,
  };
}

export const opposite = (r: Role): Role => (r === 'long' ? 'short' : 'long');

function lineMeasuresOf(list: readonly number[] | undefined, measure: number): readonly number[] | undefined {
  if (!list?.length) return undefined;
  for (const m of list) if (!(m > 0)) throw new RangeError(`lineMeasures must be positive, got ${m}`);
  return list.every((m) => Math.abs(m - measure) < 1e-6) ? undefined : [...list];
}

/** The measure of line i (before its indent). */
export function lineMeasure(P: ResolvedParams, line: number): number {
  const list = P.lineMeasures;
  if (!list) return P.measure;
  return list[Math.min(Math.max(0, line), list.length - 1)]!;
}

/** How Flatterzone, band and contrast scale on line i: its measure over the paragraph's measure. */
export function lineScale(P: ResolvedParams, line: number): number {
  return P.lineMeasures ? lineMeasure(P, line) / P.measure : 1;
}
