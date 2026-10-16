/**
 * The apply loop (plan §3 "plan, then steer", §6.2): measure → hyphenation
 * points → solve → steer with teeth → read back → re-plan refused points and
 * move teeth that sit on the wrong line, until InDesign sets every line as planned.
 */
import { opposite, solveParagraph, type FlatterSettings, type HyphenClass, type Item, type Plan, type Role } from '@flatter/core';
import { createHyphenator, createSenseRule, type Hyphenator, type HyphenLanguage } from '@flatter/hyphenation';
import { slotsForPlan, toothFor, sameSlot, type LineSlot, type ToothSpec } from './geometry.ts';
import { itemsFromMeasured, mergePoints, type MeasuredParagraph } from './items.ts';
import type { ParagraphData, Port, ReadLine, TrackingSpan } from './port.ts';

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
}

export interface ParagraphResult {
  index: number;
  plan: Plan;
  /** Every planned line was set by InDesign exactly as planned. */
  steered: boolean;
  /** Hyphenation points InDesign refused during this run (word with hyphen). */
  refused: string[];
  unsupported: string[];
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
  private settings: ApplySettings = {};
  rounds = 0;

  constructor(port: Port) {
    this.port = port;
  }

  /** Measure every paragraph and find its hyphenation points. The expensive part; done once. */
  prepare(settings: ApplySettings = {}): void {
    this.settings = settings;
    this.work = [];
    for (const data of this.port.paragraphs()) {
      const lang = hyphenLanguage(data.language);
      const h = this.hyphenator(lang);
      const words = [...new Set(data.chars.join('').match(/\p{L}+/gu) ?? [])].filter((w) => w.length >= 5);
      const probed = this.port.probe(words, data);
      const sense = settings.sense ?? lang.startsWith('de');
      const measured = itemsFromMeasured(data.chars, data.advances, {
        hyphenWidth: data.hyphenWidth,
        points: (w) => mergePoints(h.points(w), probed ? (probed.get(w) ?? []) : undefined),
        ...(sense ? { breakCost: createSenseRule(lang) } : {}),
      });
      this.work.push({ data, measured, items: measured.items, plan: undefined as unknown as Plan, refused: [] });
    }
    this.current = this.port.readLines();
  }

  /** Solve every paragraph with these settings. Points InDesign refused earlier stay refused. */
  plan(settings: ApplySettings = this.settings): void {
    this.settings = settings;
    let nextRole: Role | undefined;
    for (const w of this.work) {
      w.plan = solve(w.items, w.data, settings, settings.continuous ? nextRole : undefined);
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
    for (const w of this.work) this.port.setTracking(w.data.index, trackingSpans(w));
    this.port.setTeeth(this.teeth);
  }

  /**
   * Read back and correct until every line is set as planned (or maxRounds).
   * Each round: read lines; re-plan points InDesign refused; if anything changed, steer again.
   */
  verify(maxRounds = this.settings.maxRounds ?? 6): ApplyResult {
    for (let round = 0; round < maxRounds; round++) {
      this.rounds++;
      this.current = this.port.readLines();
      let changed = false;
      for (const w of this.work) {
        const got = this.current.filter((l) => l.paragraph === w.data.index);
        const used = this.usedSlots.get(w.data.index) ?? [];
        const bad = firstMismatch(w, got);
        if (bad < 0) {
          if (got.some((l, i) => used[i] && !sameSlot(l.slot, used[i]!))) changed = true;
          continue;
        }
        const line = w.plan.lines[bad]!;
        const at = got[bad];
        if (line.endsWithHyphen && at && used[bad] && sameSlot(at.slot, used[bad]!)) {
          const pen = w.items[line.breakAt]!;
          if (pen.type === 'penalty') {
            const e = w.measured.charRange[line.endItem - 1]![1];
            w.refused.push((w.data.chars.slice(0, e).join('').split(/\s/).pop() ?? '') + '-');
            w.items = w.items.map((it, k) => (k === line.breakAt ? { ...pen, quality: 'X' as HyphenClass } : it));
            w.plan = solve(w.items, w.data, this.settings, w.plan.startRole);
          }
        }
        changed = true;
      }
      if (!changed) break;
      this.steer();
    }
    return this.result();
  }

  result(): ApplyResult {
    const current = this.current;
    const usedSlots = this.usedSlots;
    const results: ParagraphResult[] = this.work.map((w) => {
      const got = current.filter((l) => l.paragraph === w.data.index);
      const bad = firstMismatch(w, got);
      const r: ParagraphResult = { index: w.data.index, plan: w.plan, steered: bad < 0, refused: w.refused, unsupported: [...new Set(w.measured.unsupported)] };
      if (bad >= 0) {
        const line = w.plan.lines[bad]!;
        const g = got[bad];
        const textOf = (a: number, b: number) => w.data.chars.slice(Math.max(0, a), b + 1).join('');
        const lineStart = (k: number) => (k === 0 ? 0 : got[k - 1] ? got[k - 1]!.lastVisible + 1 : 0);
        const last = plannedLastVisible(w, line.endItem);
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
    return { paragraphs: results, rounds: this.rounds, linesPlanned, linesAsPlanned, teeth: this.teeth.length, trackedLines };
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
  return session.verify(settings.maxRounds ?? 6);
}

function solve(items: Item[], data: ParagraphData, settings: ApplySettings, startRole: Role | undefined): Plan {
  const lang = hyphenLanguage(data.language);
  const { continuous: _c, sense: _s, maxRounds: _m, zoneShare, bandShare, ...rest } = settings;
  const flatterzone = zoneShare !== undefined ? zoneShare * data.measure : rest.flatterzone;
  const band = bandShare !== undefined && flatterzone !== undefined ? bandShare * flatterzone : rest.band;
  return solveParagraph(items, {
    ...rest,
    ...(flatterzone !== undefined ? { flatterzone } : {}),
    ...(band !== undefined ? { band } : {}),
    measure: data.measure,
    firstLineIndent: data.firstLineIndent,
    language: lang.startsWith('de') ? 'de' : 'en',
    ...(startRole ? { startRole } : {}),
    ...(rest.tracking?.enabled ? { tracking: { ...rest.tracking, emSize: rest.tracking.emSize ?? data.size } } : {}),
  });
}

/** Character spans of the lines the plan tracks. */
function trackingSpans(w: Working): TrackingSpan[] {
  return w.plan.lines
    .filter((l) => l.tracking !== 0)
    .map((l) => ({ from: w.measured.charRange[l.startItem]![0], to: w.measured.charRange[l.endItem - 1]![1], units: l.tracking }));
}

function slotsOf(lines: readonly ReadLine[], paragraph: number): LineSlot[] {
  return lines.filter((l) => l.paragraph === paragraph).map((l) => l.slot);
}

function plannedLastVisible(w: Working, endItem: number): number {
  return w.measured.charRange[endItem - 1]![1] - 1;
}

function matches(w: Working, line: Plan['lines'][number], got: ReadLine | undefined): boolean {
  return !!got && got.lastVisible === plannedLastVisible(w, line.endItem) && got.hyphenated === (line.endsWithHyphen && w.items[line.breakAt]?.type === 'penalty' && (w.items[line.breakAt] as { width: number }).width > 0);
}

function firstMismatch(w: Working, got: readonly ReadLine[]): number {
  if (got.length !== w.plan.lines.length) {
    const i = w.plan.lines.findIndex((line, k) => !matches(w, line, got[k]));
    return i < 0 ? Math.min(got.length, w.plan.lines.length) : i;
  }
  return w.plan.lines.findIndex((line, k) => !matches(w, line, got[k]));
}
