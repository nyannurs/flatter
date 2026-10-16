/**
 * Where to put the teeth. Pure: works on numbers read from InDesign, tested in Node.
 *
 * Every band line gets one tooth: a thin rectangle from (line start + steering
 * width) to just past the right edge of its column, half an x-height above the
 * line's baseline (spike S1). Lines are located on the page by their baseline
 * and the left edge of their column.
 */
import type { PlannedLine } from '@flatter/core';

export interface LineSlot {
  /** Page the line sits on (index into document pages). */
  page: number;
  /** Baseline y in page coordinates. */
  baseline: number;
  /** x where the line's text starts (column left + indents) in page coordinates. */
  startX: number;
  /** Right edge of the column the line sits in. */
  columnRight: number;
  /** Space to the next column or object on the right; the tooth must not reach into it. */
  gutter: number;
  /** Font size of the line, for the x-height estimate. */
  size: number;
  /** Lowest baseline that still fits in this frame or column; lines are never extrapolated past it. */
  limit?: number;
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
  const left = slot.startX + line.steerWidth;
  const right = slot.columnRight + Math.min(TOOTH_OVERSHOOT, Math.max(0, slot.gutter / 2 - 0.1));
  // A long line steered to the full measure needs no tooth.
  if (left >= slot.columnRight - 1e-6) return undefined;
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
