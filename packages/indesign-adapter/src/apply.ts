/**
 * The apply loop (plan §3 "plan, then steer", §6.2): measure → hyphenation
 * points → solve → steer with teeth → read back → re-plan refused points and
 * move teeth that sit on the wrong line, until InDesign sets every line as planned.
 */
import { opposite, solveParagraph, type FlatterSettings, type HyphenClass, type Item, type Plan, type Role } from '@flatter/core';
import { createHyphenator, createSenseRule, type Hyphenator, type HyphenLanguage } from '@flatter/hyphenation';
import { bandsFor, slotsForPlan, toothFor, sameSlot, type BandSpec, type LineSlot, type ToothSpec } from './geometry.ts';
import { itemsFromMeasured, mergePoints, type MeasuredParagraph } from './items.ts';
import type { ParagraphData, Port, ReadLine, TrackingSpan } from './port.ts';

/** Read-back rounds after steering (see FlatterSession.verify). */
export const DEFAULT_MAX_ROUNDS = 12;

export interface ApplySettings extends Omit<FlatterSettings, 'measure' | 'language' | 'firstLineIndent' | 'startRole'> {
  /** Flatterzone as a share of each paragraph's measure (panel slider). Overrides flatterzone. */
  zoneShare?: number;
  /** Band as a share of the Flatterzone (panel slider). Overrides band. */
  bandShare?: number;
  /** Continue the long/short rhythm across paragraphs. */
  continuous?: boolean;
  /** Sinneinheiten penalties; default on for German, off for English. */
  sense?: boolean;
  /** Read-back rounds before giving up. */
  maxRounds?: number;
  /**
   * Precise tracking: largest change of a word space, as a share of the paragraph's space width
   * (panel slider, e.g. 0.3 = ±30 %). Converted per paragraph into tracking.wordSpaceMax (ADR-015).
   */
  wordSpaceShare?: number;
  /** Show the Flatterzone and band behind the text (panel switch). */
  showBands?: boolean;
  /**
   * Draft while a slider moves: word spaces are left out (letter tracking only), because writing every
   * word space costs about 0.3 ms each (1,700 per tick in a 100-line story). The panel applies the full
   * settings once the slider stops.
   */
  draft?: boolean;
}

export interface ParagraphResult {
  index: number;
  plan: Plan;
  /** Every planned line was set by InDesign exactly as planned. */
  steered: boolean;
  /** Hyphenation points InDesign refused during this run (word with hyphen). */
  refused: string[];
  unsupported: string[];
  /** Lines of the plan that are visible in a frame; the rest are overset. */
  visibleLines: number;
  /** Visible lines InDesign set as planned. */
  linesAsPlanned: number;
  /** The first line InDesign did not set as planned, for diagnosis. */
  mismatch?: {
    line: number;
    planned: { lastVisible: number; hyphen: boolean; steerWidth: number; text: string };
    got?: { lastVisible: number; hyphenated: boolean; width: number; text: string };
    slotUsed?: LineSlot;
    slotGot?: LineSlot;
  };
}

export interface ApplyResult {
  paragraphs: ParagraphResult[];
  rounds: number;
  linesPlanned: number;
  linesAsPlanned: number;
  teeth: number;
  /** Lines given tracking (Laufweite) by the rescue. */
  trackedLines: number;
  /** Lines whose word spaces were tracked (ADR-015). */
  spacedLines: number;
  /** Planned lines that fall outside the frames (overset); they cannot be steered. */
  oversetLines: number;
  /**
   * Long lower-case words with safe points of our own, and how many of them InDesign gave no point at
   * all. Almost all empty means probing broke (it did once: Hyphenate Last Word, 2026-10-17).
   */
  probeCheck: { checked: number; empty: number };
}

/**
 * Signs that InDesign behaved in a way Flatter does not expect, for the panel's compatibility alarm.
 * Normal results never trigger them: in every test so far all visible lines were set as planned and
 * InDesign found points in most long words.
 */
export function compatibilityAlarms(r: ApplyResult): string[] {
  const out: string[] = [];
  if (steeringFailed(r)) {
    const { planned, asPlanned } = supportedLines(r);
    out.push(`InDesign did not follow Flatter's line steering: only ${asPlanned} of ${planned} visible lines were set as planned (normally all of them). If the text or its formatting was just edited, press Recompute and see whether this goes away.`);
  }
  const { checked, empty } = r.probeCheck;
  if (checked >= 10 && empty / checked >= 0.8) {
    out.push(`InDesign returned no hyphenation points for ${empty} of ${checked} long words that normally have them.`);
  }
  return out;
}

/**
 * Visible lines of the paragraphs without unsupported content (tabs, anchored objects…), and how many of them were set
 * as planned. One paragraph with a tab used to switch the check off for the whole story (2026-10-30).
 */
function supportedLines(r: ApplyResult): { planned: number; asPlanned: number } {
  const ok = r.paragraphs.filter((p) => !p.unsupported.length);
  return { planned: ok.reduce((s, p) => s + p.visibleLines, 0), asPlanned: ok.reduce((s, p) => s + Math.min(p.linesAsPlanned, p.visibleLines), 0) };
}

/** Most visible lines not set as steered (at least 10, unsupported content left out): stale measurements or a broken InDesign. */
export function steeringFailed(r: ApplyResult): boolean {
  const { planned, asPlanned } = supportedLines(r);
  return planned >= 10 && asPlanned / planned < 0.7;
}

/** Map an InDesign language name to the hyphenation module's language. */
export function hyphenLanguage(name: string): HyphenLanguage {
  if (/German|Deutsch/i.test(name)) return /Swiss|Schweiz/i.test(name) ? 'de-CH' : 'de';
  if (/UK|British/i.test(name)) return 'en-GB';
  return 'en-US';
}

interface Working {
  data: ParagraphData;
  measured: MeasuredParagraph;
  items: Item[];
  plan: Plan;
  refused: string[];
  /** Per-line measures the plan was made with (frames of different widths), or undefined. */
  widths?: number[] | undefined;
}

/**
 * A Flatter session on one story, as the panel uses it (plan §6.3):
 * prepare() measures and probes once; plan() re-solves in milliseconds on every
 * slider tick; steer() moves the teeth without reading back; verify() reads
 * back, re-plans refused points and moves misplaced teeth until InDesign sets
 * every line as planned.
 */
export class FlatterSession {
  private readonly port: Port;
  private readonly hyphenators = new Map<HyphenLanguage, Hyphenator>();
  private work: Working[] = [];
  private current: ReadLine[] = [];
  private teeth: ToothSpec[] = [];
  private usedSlots = new Map<number, LineSlot[]>();
  private probeCheck = { checked: 0, empty: 0 };
  private settings: ApplySettings = {};
  private overset = false;
  rounds = 0;

  constructor(port: Port) {
    this.port = port;
  }

  /** Measure every paragraph and find its hyphenation points. The expensive part; done once. */
  prepare(settings: ApplySettings = {}): void {
    this.settings = settings;
    this.work = [];
    this.probeCheck = { checked: 0, empty: 0 };
    for (const data of this.port.paragraphs()) {
      // Only spaces or line breaks: nothing to rag (and no line to compare).
      if (!/\S/u.test(data.chars.join(''))) continue;
      const lang = hyphenLanguage(data.language);
      const h = this.hyphenator(lang);
      const text = data.chars.join('');
      const words = [...new Set(text.match(/\p{L}+/gu) ?? [])].filter((w) => w.length >= 5);
      // Compounds with typed hyphens: InDesign decides per word whether it breaks after the hyphen.
      const compounds = [...new Set(text.match(/\p{L}+(?:-\p{L}+)+/gu) ?? [])];
      const probed = this.port.probe([...words, ...compounds], data);
      if (probed && data.hyphenation !== false) {
        const sure = words.filter((w) => w.length >= 8 && w === w.toLowerCase() && h.points(w).some((p) => p.quality === 'A' || p.quality === 'B'));
        this.probeCheck.checked += sure.length;
        this.probeCheck.empty += sure.filter((w) => !(probed.get(w)?.length)).length;
      }
      const sense = settings.sense ?? lang.startsWith('de');
      const measured = itemsFromMeasured(data.chars, data.advances, {
        hyphenWidth: data.hyphenWidth,
        ...(data.trackedAdvances?.length === data.advances.length ? { trackedAdvances: data.trackedAdvances } : {}),
        points: (w) => mergePoints(h.points(w), probed ? (probed.get(w) ?? []) : undefined),
        hardBreaks: (c) => probed?.get(c),
        ...(sense ? { breakCost: createSenseRule(lang) } : {}),
      });
      this.work.push({ data, measured, items: measured.items, plan: undefined as unknown as Plan, refused: [] });
    }
    this.current = this.port.readLines();
    this.overset = this.port.overset();
  }

  /** Solve every paragraph with these settings. Points InDesign refused earlier stay refused. */
  plan(settings: ApplySettings = this.settings): void {
    this.settings = settings;
    let nextRole: Role | undefined;
    for (const w of this.work) {
      w.widths = lineMeasuresFor(w.data, slotsOf(this.current, w.data.index));
      w.plan = solve(w.items, w.data, settings, settings.continuous ? nextRole : undefined, w.widths);
      if (settings.continuous) nextRole = w.plan.lines.length ? opposite(w.plan.lines[w.plan.lines.length - 1]!.role) : nextRole;
    }
  }

  /** Place teeth for the current plans at the line positions last read from InDesign. */
  steer(): void {
    this.teeth = [];
    this.usedSlots = new Map();
    for (const w of this.work) {
      const slots = slotsForPlan(w.plan.lines.length, slotsOf(this.current, w.data.index), w.data.leading);
      this.usedSlots.set(w.data.index, slots);
      w.plan.lines.forEach((line, i) => {
        const slot = slots[i];
        const t = slot && toothFor(line, slot, w.data.index, i);
        if (t) this.teeth.push(t);
      });
    }
    // Overset lines get neither teeth nor tracking: they are not visible, and writing their tracking
    // took most of a slider tick in a long overset story (2026-10-17).
    // Teeth first: moving a wrap object after the text changed made InDesign recompose on every move.
    this.port.setTeeth(this.teeth);
    for (const w of this.work) this.port.setTracking(w.data.index, trackingSpans(w, this.usedSlots.get(w.data.index) ?? []));
    if (this.port.setBands) {
      const bands: BandSpec[] = this.settings.showBands
        ? this.work.flatMap((w) => bandsFor(w.plan, this.usedSlots.get(w.data.index) ?? [], w.data.leading))
        : [];
      this.port.setBands(bands);
    }
  }

  /**
   * Read back and correct until every line is set as planned (or maxRounds).
   * Each round: read lines; re-plan points InDesign refused; if anything changed, steer again.
   * Long stories in several columns settle a column boundary at a time, so up to 12 rounds, but stop when three
   * rounds in a row bring no improvement (2026-10-30).
   */
  verify(maxRounds = this.settings.maxRounds ?? DEFAULT_MAX_ROUNDS): ApplyResult {
    let best = Infinity;
    let stale = 0;
    for (let round = 0; round < maxRounds; round++) {
      this.rounds++;
      this.current = this.port.readLines();
      let changed = false;
      let open = 0;
      let learned = false;
      for (const w of this.work) {
        const got = this.current.filter((l) => l.paragraph === w.data.index);
        // The paragraph's lines sit in frames of other widths than planned for: plan again.
        const widths = lineMeasuresFor(w.data, got.map((l) => l.slot));
        if (!sameWidths(widths, w.widths)) {
          w.widths = widths;
          w.plan = solve(w.items, w.data, this.settings, w.plan.startRole, widths);
          changed = true;
          open++;
          continue;
        }
        const used = this.usedSlots.get(w.data.index) ?? [];
        const bad = firstMismatch(w, got, this.overset);
        if (bad < 0) {
          if (got.some((l, i) => used[i] && !sameSlot(l.slot, used[i]!))) changed = true;
          continue;
        }
        this.port.forgetTracking?.(w.data.index);
        const line = w.plan.lines[bad];
        const at = got[bad];
        if (line?.endsWithHyphen && at && used[bad] && sameSlot(at.slot, used[bad]!)) {
          const pen = w.items[line.breakAt]!;
          if (pen.type === 'penalty') {
            const e = w.measured.charRange[line.endItem - 1]![1];
            w.refused.push((w.data.chars.slice(0, e).join('').split(/\s/).pop() ?? '') + (pen.width > 0 ? '-' : ''));
            learned = true;
            // InDesign decides per word: refuse the same point in every occurrence of the word, so a
            // repeated word costs one round, not one round per occurrence (2026-10-17).
            const same = new Set(sameWordPoints(w.items, line.breakAt));
            w.items = w.items.map((it, k) => (same.has(k) && it.type === 'penalty' ? { ...it, quality: 'X' as HyphenClass } : it));
            w.plan = solve(w.items, w.data, this.settings, w.plan.startRole, w.widths);
          }
        }
        changed = true;
        open++;
      }
      if (!changed) break;
      // Progress: fewer paragraphs off their plan, or a hyphenation point InDesign refused is now known.
      if (open < best || learned) {
        best = Math.min(best, open);
        stale = 0;
      } else if (++stale >= 3) break;
      this.steer();
    }
    return this.result();
  }

  result(): ApplyResult {
    const current = this.current;
    const usedSlots = this.usedSlots;
    const results: ParagraphResult[] = this.work.map((w) => {
      const got = current.filter((l) => l.paragraph === w.data.index);
      const bad = firstMismatch(w, got, this.overset);
      const visibleLines = this.overset ? Math.min(got.length, w.plan.lines.length) : w.plan.lines.length;
      const linesAsPlanned = w.plan.lines.filter((line, i) => matches(w, line, got[i])).length;
      const r: ParagraphResult = { index: w.data.index, plan: w.plan, steered: bad < 0, refused: w.refused, unsupported: [...new Set([...w.measured.unsupported, ...(w.data.unsupported ?? [])])], visibleLines, linesAsPlanned };
      // InDesign may set more lines than planned: the first extra line then has no plan to compare with.
      const planned = w.plan.lines[Math.min(bad, w.plan.lines.length - 1)];
      if (bad >= 0 && planned) {
        const line = planned;
        const g = got[bad];
        const textOf = (a: number, b: number) => w.data.chars.slice(Math.max(0, a), b + 1).join('');
        const lineStart = (k: number) => (k === 0 ? 0 : got[k - 1] ? got[k - 1]!.lastVisible + 1 : 0);
        const last = plannedLastVisible(w, line);
        r.mismatch = {
          line: bad,
          planned: { lastVisible: last, hyphen: line.endsWithHyphen, steerWidth: line.steerWidth, text: textOf(last - 20, last) },
          ...(g ? { got: { lastVisible: g.lastVisible, hyphenated: g.hyphenated, width: w.data.advances.slice(lineStart(bad), g.lastVisible + 1).reduce((s2, x) => s2 + x, 0), text: textOf(g.lastVisible - 20, g.lastVisible) } } : {}),
          ...(usedSlots.get(w.data.index)?.[bad] ? { slotUsed: usedSlots.get(w.data.index)![bad]! } : {}),
          ...(g ? { slotGot: g.slot } : {}),
        };
      }
      return r;
    });
    const linesPlanned = this.work.reduce((s, w) => s + w.plan.lines.length, 0);
    const linesAsPlanned = this.work.reduce((s, w) => {
      const got = current.filter((l) => l.paragraph === w.data.index);
      return s + w.plan.lines.filter((line, i) => matches(w, line, got[i])).length;
    }, 0);
    const trackedLines = this.work.reduce((s, w) => s + w.plan.stats.trackedLines, 0);
    const spacedLines = this.work.reduce((s, w) => s + w.plan.stats.spacedLines, 0);
    const oversetLines = this.overset ? this.work.reduce((s, w) => s + Math.max(0, w.plan.lines.length - visibleCount(this.current, w.data.index)), 0) : 0;
    return { paragraphs: results, rounds: this.rounds, linesPlanned: linesPlanned - oversetLines, linesAsPlanned, teeth: this.teeth.length, trackedLines, spacedLines, oversetLines, probeCheck: { ...this.probeCheck } };
  }

  private hyphenator(lang: HyphenLanguage): Hyphenator {
    let h = this.hyphenators.get(lang);
    if (!h) this.hyphenators.set(lang, (h = createHyphenator({ language: lang })));
    return h;
  }
}

/** One-shot: prepare, plan, steer and verify. */
export function applyToPort(port: Port, settings: ApplySettings = {}): ApplyResult {
  const session = new FlatterSession(port);
  session.prepare(settings);
  session.plan(settings);
  session.steer();
  return session.verify(settings.maxRounds ?? DEFAULT_MAX_ROUNDS);
}

/**
 * Each line's measure from the column it sits in: the paragraph's measure plus the difference between
 * that column's width and the column the measure was taken from. Undefined when every line has the
 * paragraph's measure.
 */
export function lineMeasuresFor(data: ParagraphData, slots: readonly LineSlot[]): number[] | undefined {
  if (data.columnWidth === undefined || !slots.length) return undefined;
  const out = slots.map((s) => (s.columnLeft === undefined ? data.measure : data.measure + (s.columnRight - s.columnLeft - data.columnWidth!)));
  return out.every((m) => Math.abs(m - data.measure) < 0.01) ? undefined : out;
}

function sameWidths(a: readonly number[] | undefined, b: readonly number[] | undefined): boolean {
  if (!a || !b) return a === b;
  // Lines beyond the list take its last entry, so compare over the longer list.
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (Math.abs(a[Math.min(i, a.length - 1)]! - b[Math.min(i, b.length - 1)]!) > 0.01) return false;
  return true;
}

function solve(items: Item[], data: ParagraphData, settings: ApplySettings, startRole: Role | undefined, widths?: readonly number[]): Plan {
  const lang = hyphenLanguage(data.language);
  const { continuous: _c, sense: _s, maxRounds: _m, zoneShare, bandShare, wordSpaceShare, showBands: _b, draft, ...rest } = settings;
  const flatterzone = zoneShare !== undefined ? zoneShare * data.measure : rest.flatterzone;
  const band = bandShare !== undefined && flatterzone !== undefined ? bandShare * flatterzone : rest.band;
  return solveParagraph(items, {
    ...rest,
    ...(flatterzone !== undefined ? { flatterzone } : {}),
    ...(band !== undefined ? { band } : {}),
    measure: data.measure,
    ...(widths ? { lineMeasures: widths } : {}),
    firstLineIndent: data.firstLineIndent,
    language: lang.startsWith('de') ? 'de' : 'en',
    ...(startRole ? { startRole } : {}),
    ...(rest.tracking?.enabled
      ? {
          tracking: {
            ...rest.tracking,
            emSize: rest.tracking.emSize ?? data.size,
            ...(wordSpaceShare !== undefined && rest.tracking.mode === 'precise' && !draft
              ? { wordSpaceMax: (wordSpaceShare * spaceWidthOf(data) * 1000) / data.size }
              : {}),
          },
        }
      : {}),
  });
}

/** The paragraph's word-space width: the most common advance of its plain spaces (a quarter em if none). */
export function spaceWidthOf(data: ParagraphData): number {
  const counts = new Map<number, number>();
  data.chars.forEach((c, i) => {
    if (c !== ' ') return;
    const w = Math.round(data.advances[i]! * 1000) / 1000;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  });
  let best = 0.25 * data.size;
  let most = 0;
  for (const [w, n] of counts) if (n > most && w > 0) [best, most] = [w, n];
  return best;
}

/**
 * Character spans of the lines the plan tracks: every character but the line's last (see trackedChars),
 * then the first character of each word space inside the line with the line's word-space tracking on top
 * (ADR-015). Later spans override earlier ones.
 */
function trackingSpans(w: Working, slots: readonly (LineSlot | undefined)[]): TrackingSpan[] {
  const spans: TrackingSpan[] = [];
  w.plan.lines.forEach((l, i) => {
    if (slots[i] === undefined || (l.tracking === 0 && l.wordSpace === 0) || l.endItem <= l.startItem) return;
    const from = w.measured.charRange[l.startItem]![0];
    const to = w.measured.charRange[l.endItem - 1]![1] - 1;
    if (l.tracking !== 0 && to > from) spans.push({ from, to, units: l.tracking });
    if (l.wordSpace === 0) return;
    for (let k = l.startItem; k < l.endItem; k++) {
      if (w.items[k]!.type !== 'glue') continue;
      const c = w.measured.charRange[k]![0];
      spans.push({ from: c, to: c + 1, units: l.tracking + l.wordSpace });
    }
  });
  return spans;
}

/**
 * Penalties at the same place in the same word as the penalty at index k: same word (wordKey) and the
 * same text of the word before the point.
 */
export function sameWordPoints(items: readonly Item[], k: number): number[] {
  const where = (p: number): string | undefined => {
    let prefix = '';
    let key: string | undefined;
    for (let j = p - 1; j >= 0; j--) {
      const it = items[j]!;
      if (it.type === 'glue') return undefined;
      if (it.type !== 'box') continue;
      prefix = (it.text ?? '') + prefix;
      key = it.wordKey;
      if (it.wordStart) return key === undefined ? undefined : `${key}\u0000${prefix}`;
    }
    return undefined;
  };
  const target = where(k);
  if (target === undefined) return [k];
  const out: number[] = [];
  items.forEach((it, p) => {
    if (it.type === 'penalty' && !it.forced && where(p) === target) out.push(p);
  });
  return out.length ? out : [k];
}

function slotsOf(lines: readonly ReadLine[], paragraph: number): LineSlot[] {
  return lines.filter((l) => l.paragraph === paragraph).map((l) => l.slot);
}

/**
 * The paragraph-relative index of a planned line's last visible character. A line without one (a forced line
 * break at the start of a paragraph or right after another) counts its first character, as the read-back does.
 */
function plannedLastVisible(w: Working, line: Plan['lines'][number]): number {
  const range = line.endItem > line.startItem ? w.measured.charRange[line.endItem - 1] : undefined;
  if (range) return range[1] - 1;
  return w.measured.charRange[line.startItem]?.[0] ?? 0;
}

function matches(w: Working, line: Plan['lines'][number], got: ReadLine | undefined): boolean {
  return !!got && got.lastVisible === plannedLastVisible(w, line) && got.hyphenated === (line.endsWithHyphen && w.items[line.breakAt]?.type === 'penalty' && (w.items[line.breakAt] as { width: number }).width > 0);
}

function visibleCount(lines: readonly ReadLine[], paragraph: number): number {
  return lines.filter((l) => l.paragraph === paragraph).length;
}

function firstMismatch(w: Working, got: readonly ReadLine[], overset = false): number {
  // In an overset story the lines after the last visible one cannot be compared (or steered).
  const n = overset ? Math.min(got.length, w.plan.lines.length) : w.plan.lines.length;
  if (overset) {
    for (let k = 0; k < n; k++) if (!matches(w, w.plan.lines[k]!, got[k])) return k;
    return -1;
  }
  if (got.length !== w.plan.lines.length) {
    const i = w.plan.lines.findIndex((line, k) => !matches(w, line, got[k]));
    return i < 0 ? Math.min(got.length, w.plan.lines.length) : i;
  }
  return w.plan.lines.findIndex((line, k) => !matches(w, line, got[k]));
}
