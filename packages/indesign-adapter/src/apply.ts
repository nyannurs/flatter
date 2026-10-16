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

export function applyToPort(port: Port, settings: ApplySettings = {}): ApplyResult {
  const maxRounds = settings.maxRounds ?? 6;
  const hyphenators = new Map<HyphenLanguage, Hyphenator>();
  const hyphenator = (lang: HyphenLanguage) => {
    let h = hyphenators.get(lang);
    if (!h) hyphenators.set(lang, (h = createHyphenator({ language: lang })));
    return h;
  };

  // Measure and plan every paragraph.
  const work: Working[] = [];
  let nextRole: Role | undefined;
  for (const data of port.paragraphs()) {
    const lang = hyphenLanguage(data.language);
    const h = hyphenator(lang);
    const words = [...new Set(data.chars.join('').match(/\p{L}+/gu) ?? [])].filter((w) => w.length >= 5);
    const probed = port.probe(words, data);
    const sense = settings.sense ?? lang.startsWith('de');
    const measured = itemsFromMeasured(data.chars, data.advances, {
      hyphenWidth: data.hyphenWidth,
      points: (w) => mergePoints(h.points(w), probed ? (probed.get(w) ?? []) : undefined),
      ...(sense ? { breakCost: createSenseRule(lang) } : {}),
    });
    const plan = solve(measured.items, data, settings, nextRole);
    if (settings.continuous) nextRole = plan.lines.length ? opposite(plan.lines[plan.lines.length - 1]!.role) : nextRole;
    work.push({ data, measured, items: measured.items, plan, refused: [] });
  }

  let rounds = 0;
  let current = port.readLines();
  let teeth: ToothSpec[] = [];
  let usedSlots = new Map<number, LineSlot[]>();
  for (;;) {
    rounds++;
    // Teeth for the planned lines at the positions InDesign currently gives those lines.
    teeth = [];
    usedSlots = new Map();
    for (const w of work) {
      const slots = slotsForPlan(w.plan.lines.length, slotsOf(current, w.data.index), w.data.leading);
      usedSlots.set(w.data.index, slots);
      w.plan.lines.forEach((line, i) => {
        const slot = slots[i];
        const t = slot && toothFor(line, slot, w.data.index, i);
        if (t) teeth.push(t);
      });
    }
    for (const w of work) port.setTracking(w.data.index, trackingSpans(w));
    port.setTeeth(teeth);
    current = port.readLines();
    if (rounds >= maxRounds) break;

    let changed = false;
    for (const w of work) {
      const got = current.filter((l) => l.paragraph === w.data.index);
      const used = usedSlots.get(w.data.index)!;
      const bad = firstMismatch(w, got);
      if (bad < 0) {
        // Breaks are right; are the teeth on the lines they belong to?
        if (got.some((l, i) => used[i] && !sameSlot(l.slot, used[i]!))) changed = true;
        continue;
      }
      const line = w.plan.lines[bad]!;
      const at = got[bad];
      // A planned hyphenation point InDesign did not use, while the line's slot was right: it refuses that point.
      if (line.endsWithHyphen && at && sameSlot(at.slot, used[bad]!)) {
        const pen = w.items[line.breakAt]!;
        if (pen.type === 'penalty') {
          const [s, e] = w.measured.charRange[line.endItem - 1]!;
          const word = w.data.chars.slice(0, e).join('').split(/\s/).pop() ?? '';
          w.refused.push(word + '-');
          void s;
          w.items = w.items.map((it, k) => (k === line.breakAt ? { ...pen, quality: 'X' as HyphenClass } : it));
          w.plan = solve(w.items, w.data, settings, w.plan.startRole);
        }
      }
      changed = true;
    }
    if (!changed) break;
  }

  const results: ParagraphResult[] = work.map((w) => {
    const got = current.filter((l) => l.paragraph === w.data.index);
    const bad = firstMismatch(w, got);
    const r: ParagraphResult = { index: w.data.index, plan: w.plan, steered: bad < 0, refused: w.refused, unsupported: [...new Set(w.measured.unsupported)] };
    if (bad >= 0) {
      const line = w.plan.lines[bad]!;
      const g = got[bad];
      const textOf = (a: number, b: number) => w.data.chars.slice(Math.max(0, a), b + 1).join('');
      const lineStart = (k: number) => (k === 0 ? 0 : (got[k - 1] ? got[k - 1]!.lastVisible + 1 : 0));
      r.mismatch = {
        line: bad,
        planned: { lastVisible: plannedLastVisible(w, line.endItem), hyphen: line.endsWithHyphen, steerWidth: line.steerWidth, text: textOf(plannedLastVisible(w, line.endItem) - 20, plannedLastVisible(w, line.endItem)) },
        ...(g ? { got: { lastVisible: g.lastVisible, hyphenated: g.hyphenated, width: w.data.advances.slice(lineStart(bad), g.lastVisible + 1).reduce((s2, x) => s2 + x, 0), text: textOf(g.lastVisible - 20, g.lastVisible) } } : {}),
        ...(usedSlots.get(w.data.index)?.[bad] ? { slotUsed: usedSlots.get(w.data.index)![bad]! } : {}),
        ...(g ? { slotGot: g.slot } : {}),
      };
    }
    return r;
  });
  const linesPlanned = work.reduce((s, w) => s + w.plan.lines.length, 0);
  const linesAsPlanned = work.reduce((s, w) => {
    const got = current.filter((l) => l.paragraph === w.data.index);
    return s + w.plan.lines.filter((line, i) => matches(w, line, got[i])).length;
  }, 0);
  const trackedLines = work.reduce((s, w) => s + w.plan.stats.trackedLines, 0);
  return { paragraphs: results, rounds, linesPlanned, linesAsPlanned, teeth: teeth.length, trackedLines };
}

function solve(items: Item[], data: ParagraphData, settings: ApplySettings, startRole: Role | undefined): Plan {
  const lang = hyphenLanguage(data.language);
  const { continuous: _c, sense: _s, maxRounds: _m, ...rest } = settings;
  return solveParagraph(items, {
    ...rest,
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
