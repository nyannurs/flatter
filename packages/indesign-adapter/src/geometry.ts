/**
 * Where to put the teeth. Pure: works on numbers read from InDesign, tested in Node.
 *
 * Every band line gets one tooth: a thin rectangle from (line start + steering
 * width) to just past the right edge of its column, half an x-height above the
 * line's baseline (spike S1). Lines are located on the page by their baseline
 * and the left edge of their column.
 */
import type { Plan, PlannedLine } from '@flatter/core';

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
}

export interface ToothSpec {
  page: number;
  /** [top, left, bottom, right] in page coordinates, as InDesign geometricBounds. */
  bounds: [number, number, number, number];
  /** Paragraph index in the story and line index in the paragraph, for labels. */
  paragraph: number;
  line: number;
}

/** Height of a tooth. Thin enough to touch one line at leading equal to the type size (S1). */
export const TOOTH_HEIGHT = 0.1;
/** x-height as a share of the type size, used only to centre the tooth vertically. */
export const X_HEIGHT_SHARE = 0.45;
/** How far a tooth reaches past the column edge (never more than half the gutter). */
export const TOOTH_OVERSHOOT = 2;

export function toothFor(line: PlannedLine, slot: LineSlot, paragraph: number, lineIndex: number): ToothSpec | undefined {
  if (line.kind !== 'band') return undefined;
  const cy = slot.baseline - (slot.size * X_HEIGHT_SHARE) / 2;
  const overshoot = Math.min(TOOTH_OVERSHOOT, Math.max(0, slot.gutter / 2 - 0.1));
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
  return {
    page: slot.page,
    bounds: [cy - TOOTH_HEIGHT / 2, left, cy + TOOTH_HEIGHT / 2, Math.max(right, left + 0.5)],
    paragraph,
    line: lineIndex,
  };
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
}

/**
 * The long and short bands behind a paragraph's visible lines: one pair per stretch of lines in the
 * same column. The right edge of the measure is each line's start plus its available width, so first-line
 * indents and paragraph indents come out right.
 */
export function bandsFor(plan: Plan, slots: readonly (LineSlot | undefined)[], leading: number): BandSpec[] {
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
    // Zone and band scale with the line's measure (threaded frames of different widths).
    const scale = (line.available + line.indent) / plan.params.measure;
    const Z = flatterzone * scale;
    const b = band * scale;
    const top = s.baseline - leading * 0.8;
    const bottom = slots[j - 1]!.baseline + leading * 0.2;
    if (plan.params.style === 'functional') {
      // Functional style: one zone in which every line ends.
      out.push({ page: s.page, bounds: [top, right - Z, bottom, right], kind: 'zone' });
      i = j;
      continue;
    }
    out.push(
      { page: s.page, bounds: [top, right - b, bottom, right], kind: 'long' },
      { page: s.page, bounds: [top, right - Z - b, bottom, right - Z], kind: 'short' },
    );
    i = j;
  }
  return out;
}
