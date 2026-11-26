/**
 * Where to put the teeth. Pure: works on numbers read from InDesign, tested in Node.
 *
 * Every band line gets one tooth: a thin rectangle from (line start + steering
 * width) to just past the right edge of its column, half an x-height above the
 * line's baseline (spike S1). Lines are located on the page by their baseline
 * and the left edge of their column.
 */
import type { Plan, PlannedLine } from '@flatter/core';
import { ragOnLeft } from './settings.ts';

export interface LineSlot {
  /** Page the line sits on (index into document pages). */
  page: number;
  /** Baseline y in page coordinates. */
  baseline: number;
  /** x where the line's text starts (column left + indents) in page coordinates. */
  startX: number;
  /** Right edge of the column the line sits in. */
  columnRight: number;
  /** Left edge of that column (frames of different widths give lines different measures). */
  columnLeft?: number;
  /** Space to the next column or object on the right; the tooth must not reach into it. */
  gutter: number;
  /** Font size of the line, for the x-height estimate. */
  size: number;
  /** Lowest baseline that still fits in this frame or column; lines are never extrapolated past it. */
  limit?: number;
  /** The column's place in the story's flow (frame by frame, column by column), for predicting where lines go. */
  column?: number;
  /** The column's [left, right] before text wrap narrowed it. */
  columnBounds?: [number, number];
  /** The line's page is a right-hand or single-sided page (decides where text aligned to the spine is ragged). */
  rightHand?: boolean;
}

export interface ToothSpec {
  page: number;
  /** [top, left, bottom, right] in page coordinates, as InDesign geometricBounds. */
  bounds: [number, number, number, number];
  /** Paragraph index in the story and line index in the paragraph, for labels. */
  paragraph: number;
  line: number;
  /** A tooth for right-aligned text: the text goes on its right side (the default is its left side). */
  textOnRight?: boolean;
}

/** Height of a tooth. Thin enough to touch one line at leading equal to the type size (S1). */
export const TOOTH_HEIGHT = 0.1;
/** x-height as a share of the type size, used only to centre the tooth vertically. */
export const X_HEIGHT_SHARE = 0.45;
/** How far a tooth reaches past the column edge (never more than half the gutter). */
export const TOOTH_OVERSHOOT = 2;

export function toothFor(line: PlannedLine, slot: LineSlot, paragraph: number, lineIndex: number, side: ToothSide = {}): ToothSpec | undefined {
  if (line.kind !== 'band') return undefined;
  const cy = slot.baseline - (slot.size * X_HEIGHT_SHARE) / 2;
  const overshoot = Math.min(TOOTH_OVERSHOOT, Math.max(0, slot.gutter / 2 - 0.1));
  const bounds = (left: number, right: number): ToothSpec => ({ page: slot.page, bounds: [cy - TOOTH_HEIGHT / 2, left, cy + TOOTH_HEIGHT / 2, right], paragraph, line: lineIndex });
  if (side.ragLeft) {
    // Right-aligned text (ADR-037): the tooth comes in from the left. The measure ends at the line's start plus its
    // available width; text starts right of the tooth (plus the indents when InDesign honours them next to a wrap).
    const columnLeft = slot.columnLeft ?? slot.startX;
    const outside = columnLeft - overshoot;
    let right = slot.startX + line.available - line.steerWidth - (side.indentAfterWrap ?? 0);
    if (right <= columnLeft + 1e-6) {
      if (overshoot < 0.2) return undefined;
      right = columnLeft - overshoot / 2;
    }
    return { ...bounds(Math.min(outside, right - 0.5), right), textOnRight: true };
  }
  const right = slot.columnRight + overshoot;
  let left = slot.startX + line.steerWidth;
  // A long line steered to the full measure needs no limit: its tooth waits just outside the column,
  // where it touches no text. Every band line keeping a tooth keeps the count per page stable, so a
  // slider drag only moves teeth (creating one costs far more, 2026-10-17).
  if (left >= slot.columnRight - 1e-6) {
    // Columns that touch leave no room outside: then no tooth, as before.
    if (overshoot < 0.2) return undefined;
    left = slot.columnRight + overshoot / 2;
  }
  return bounds(left, Math.max(right, left + 0.5));
}

/** A paragraph's indents and InDesign's "honour text indents with text wrap" (textPreferences). */
export interface Indents {
  left: number;
  right: number;
  first: number;
  /** honourTextIndentsWithTextWrap: the left indent also applies next to a wrap object on the left. */
  atWrap: boolean;
}

/**
 * Where a line's text may go, [left, right], in a column [left, right] narrowed by text wrap (`i49-indent-wrap`,
 * 2026-11-26): next to a wrap object on the left, InDesign adds the first-line indent, and the left indent only when it
 * honours indents with text wrap; next to one on the right it drops the right indent. Away from wrap objects both
 * indents apply.
 */
export function textArea(column: readonly [number, number], narrowed: readonly [number, number], ind: Indents, firstLine: boolean): [number, number] {
  const [cl, cr] = column;
  const [nl, nr] = narrowed;
  const left = (nl > cl + 0.01 ? nl + (ind.atWrap ? ind.left : 0) : cl + ind.left) + (firstLine ? ind.first : 0);
  const right = nr < cr - 0.01 ? nr : cr - ind.right;
  return [left, right];
}

/** Where a line's rag is: on the left for right-aligned text, and how far InDesign indents text next to a wrap. */
export interface ToothSide {
  ragLeft?: boolean;
  /** Left indent (plus the first-line indent on a first line) when InDesign honours indents next to text wrap. */
  indentAfterWrap?: number;
}

/**
 * Slots for the planned lines of a paragraph, given where its lines sit now.
 * Lines beyond the current composition continue below the last known line by
 * the leading, in the same column (the apply loop corrects this after reading back).
 */
export function slotsForPlan(planned: number, current: readonly LineSlot[], leading: number): LineSlot[] {
  if (current.length === 0) return [];
  const out: LineSlot[] = [];
  for (let i = 0; i < planned; i++) {
    const known = current[i];
    if (known) out.push(known);
    else {
      const prev = out[i - 1]!;
      const baseline = prev.baseline + leading;
      // Do not place teeth below the frame: they would hit other text (and overset lines have no position).
      if (prev.limit !== undefined && baseline > prev.limit + 1e-6) break;
      out.push({ ...prev, baseline, startX: current[current.length - 1]!.startX });
    }
  }
  return out;
}

/** Same position within a tolerance: used to decide whether teeth need moving. */
export function sameSlot(a: LineSlot, b: LineSlot, tol = 0.01): boolean {
  return a.page === b.page && Math.abs(a.baseline - b.baseline) < tol && Math.abs(a.startX - b.startX) < tol && Math.abs(a.columnRight - b.columnRight) < tol;
}

/** A tinted strip showing where long or short lines should end (the playground's band view). */
export interface BandSpec {
  page: number;
  /** [top, left, bottom, right] in page coordinates. */
  bounds: [number, number, number, number];
  kind: 'long' | 'short' | 'zone';
  /** The column's place in the story's flow (LineSlot.column): strips of one column are merged (mergeBands). */
  column?: number;
}

/**
 * The long and short bands behind a paragraph's visible lines: one pair per stretch of lines in the
 * same column. The right edge of the measure is each line's start plus its available width, so first-line
 * indents and paragraph indents come out right.
 */
const col = (s: LineSlot): { column?: number } => (s.column === undefined ? {} : { column: s.column });

export function bandsFor(plan: Plan, slots: readonly (LineSlot | undefined)[], leading: number, alignment?: string): BandSpec[] {
  const { band, flatterzone } = plan.params;
  const out: BandSpec[] = [];
  const n = Math.min(plan.lines.length, slots.length);
  let i = 0;
  while (i < n) {
    const s = slots[i];
    if (!s) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < n) {
      const t = slots[j];
      const prev = slots[j - 1]!;
      if (!t || t.page !== s.page || Math.abs(t.columnRight - s.columnRight) > 0.5 || t.baseline <= prev.baseline) break;
      j++;
    }
    const line = plan.lines[i]!;
    const right = s.startX + line.available;
    // Right-aligned text is ragged on the left: the strips start at the measure's left edge and point right.
    const left = right - line.available - line.indent;
    const mirrored = ragOnLeft(alignment, s.rightHand ?? true);
    // Zone and band scale with the line's measure (threaded frames of different widths).
    const scale = (line.available + line.indent) / plan.params.measure;
    const Z = flatterzone * scale;
    const b = band * scale;
    const top = s.baseline - leading * 0.8;
    const bottom = slots[j - 1]!.baseline + leading * 0.2;
    if (plan.params.style === 'functional') {
      // Functional style: one zone in which every line ends.
      out.push({ page: s.page, bounds: mirrored ? [top, left, bottom, left + Z] : [top, right - Z, bottom, right], kind: 'zone', ...col(s) });
      i = j;
      continue;
    }
    out.push(
      mirrored ? { page: s.page, bounds: [top, left, bottom, left + b], kind: 'long', ...col(s) } : { page: s.page, bounds: [top, right - b, bottom, right], kind: 'long', ...col(s) },
      mirrored ? { page: s.page, bounds: [top, left + Z, bottom, left + Z + b], kind: 'short', ...col(s) } : { page: s.page, bounds: [top, right - Z - b, bottom, right - Z], kind: 'short', ...col(s) },
    );
    i = j;
  }
  return out;
}

/**
 * One strip per column instead of one per paragraph (2026-11-26): strips of the same kind in the same column whose
 * edges match are joined from the first one's top to the last one's bottom. On 8 pages of three columns that is about
 * 48 strips instead of 380, and they only move when the zone or band changes. Strips without a known column, or with
 * other edges (an indent, a text wrap), stay apart.
 */
export function mergeBands(bands: readonly BandSpec[]): BandSpec[] {
  const out: BandSpec[] = [];
  const last = new Map<string, BandSpec>();
  for (const b of bands) {
    if (b.column === undefined) {
      out.push({ ...b, bounds: [...b.bounds] });
      continue;
    }
    const key = `${b.page}|${b.column}|${b.kind}`;
    const prev = last.get(key);
    if (prev && Math.abs(prev.bounds[1] - b.bounds[1]) < 0.5 && Math.abs(prev.bounds[3] - b.bounds[3]) < 0.5) {
      prev.bounds[0] = Math.min(prev.bounds[0], b.bounds[0]);
      prev.bounds[2] = Math.max(prev.bounds[2], b.bounds[2]);
      continue;
    }
    const copy: BandSpec = { ...b, bounds: [...b.bounds] };
    out.push(copy);
    last.set(key, copy);
  }
  return out;
}
