/**
 * Where planned lines will sit (2026-11-18). Teeth used to go to the slots a paragraph's lines had before planning;
 * when an earlier paragraph gained or lost a line, every later line moved and its tooth sat one line off until the
 * next read-back. In a story through many columns that cost about one round per column, and a long story ran out of
 * rounds with half its lines off plan. Here the planned lines are poured into the columns in story order instead:
 * the same columns, first baselines and gaps between paragraphs as read back, the planned number of lines.
 * Pure: no InDesign APIs, tested in Node.
 */
import type { LineSlot } from './geometry.ts';
import type { ReadLine } from './port.ts';

export interface FlowParagraph {
  index: number;
  /** Lines the paragraph will have: planned, or as read back for paragraphs Flatter leaves alone. */
  lines: number;
  /** Fixed leading; undefined for a paragraph Flatter leaves alone (its read-back gaps are used). */
  leading?: number;
  size?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  leftIndent?: number;
  firstLineIndent?: number;
}

/** Narrow a column [left, right] by text wrap at a baseline (the port knows the wrap objects). */
export type Narrow = (page: number, baseline: number, size: number, left: number, right: number) => [number, number];

/** Share of the type size below the baseline, for whether a line fits above a frame's bottom. */
const DESCENT_SHARE = 0.3;
/** Share of the type size above the first baseline of a column, to move it when the top line's size differs. */
const ASCENT_SHARE = 0.72;

interface Column {
  id: number;
  template: LineSlot;
  firstBaseline: number;
  firstSize: number;
  /** Lowest baseline read back in the column (a planned line at or above it fits). */
  lowest: number;
  /** The text went on in the next column without a forced break: the column was full at `lowest`. */
  full?: boolean;
  /** Gap the line that went on to the next column needed: a line closer than that below `lowest` may still fit. */
  overflowGap?: number;
}

/**
 * Slots for every paragraph's lines, by paragraph index, or an empty map when the read-back carries no column ids.
 * Lines that would land beyond the columns read back get no slot (they show up in the next read-back).
 */
export function predictSlots(current: readonly ReadLine[], paragraphs: readonly FlowParagraph[], narrow?: Narrow): Map<number, LineSlot[]> {
  const out = new Map<number, LineSlot[]>();
  if (!current.length || current.some((l) => l.slot.column === undefined)) return out;

  const columns: Column[] = [];
  for (const l of current) {
    const last = columns[columns.length - 1];
    if (last && last.id === l.slot.column) {
      last.lowest = Math.max(last.lowest, l.slot.baseline);
      continue;
    }
    columns.push({ id: l.slot.column!, template: l.slot, firstBaseline: l.slot.baseline, firstSize: l.slot.size, lowest: l.slot.baseline });
  }
  // Read-back gaps: between lines of a paragraph, and from a paragraph's first line to the line before it.
  const byParagraph = new Map<number, ReadLine[]>();
  for (const l of current) {
    if (!byParagraph.has(l.paragraph)) byParagraph.set(l.paragraph, []);
    byParagraph.get(l.paragraph)!.push(l);
  }
  const data = new Map(paragraphs.map((p) => [p.index, p] as const));
  const boundaryGap = new Map<number, number>();
  const forcedStart = new Set<number>();
  current.forEach((l, k) => {
    const prev = current[k - 1];
    if (!prev) return;
    const sameColumn = prev.slot.column === l.slot.column;
    if (l.line === 0 && sameColumn) boundaryGap.set(l.paragraph, l.slot.baseline - prev.slot.baseline);
    if (!sameColumn) {
      const col = columns.find((c) => c.id === prev.slot.column);
      if (!col) return;
      // A paragraph that starts a column although the previous one had room for two more lines: a column or frame
      // break, "start in next column" or keep options. It keeps starting a column.
      if (l.line === 0 && col.template.limit !== undefined && prev.slot.baseline + 2 * l.slot.size * 1.2 + DESCENT_SHARE * l.slot.size < col.template.limit) {
        forcedStart.add(l.paragraph);
        return;
      }
      // Otherwise the column was full: InDesign's own rule for the last line that fits is stricter than a descent
      // estimate (a frame of 9/11.5 pt ended 19.5 pt above its bottom, 2026-11-18), so the read-back decides.
      col.full = true;
      const next = data.get(l.paragraph);
      const before = data.get(prev.paragraph);
      if (l.paragraph === prev.paragraph) col.overflowGap = next?.leading ?? gapWithin(byParagraph.get(l.paragraph)!);
      else if (next?.leading !== undefined) col.overflowGap = next.leading + (before?.spaceAfter ?? 0) + (next.spaceBefore ?? 0);
    }
  });

  let ci = 0;
  let baseline: number | undefined;
  let prevSpaceAfter = 0;
  for (const p of [...paragraphs].sort((a, b) => a.index - b.index)) {
    const seen = byParagraph.get(p.index) ?? [];
    const size = p.size ?? seen[0]?.slot.size ?? columns[0]!.firstSize;
    const lineGap = p.leading ?? gapWithin(seen) ?? size * 1.2;
    const firstGap = boundaryGap.get(p.index) ?? lineGap + prevSpaceAfter + (p.spaceBefore ?? 0);
    if (forcedStart.has(p.index) && baseline !== undefined) {
      ci++;
      baseline = undefined;
    }
    const slots: LineSlot[] = [];
    for (let i = 0; i < p.lines; i++) {
      let placed = false;
      while (!placed) {
        const col = columns[ci];
        if (!col) break;
        let b: number;
        if (baseline === undefined) b = col.firstBaseline + (size - col.firstSize) * ASCENT_SHARE;
        else b = baseline + (i === 0 ? firstGap : lineGap);
        if (baseline !== undefined && !fits(col, b, size)) {
          ci++;
          baseline = undefined;
          continue;
        }
        slots.push(slotAt(col.template, b, size, i === 0 ? (p.firstLineIndent ?? 0) : 0, p.leftIndent, narrow));
        baseline = b;
        placed = true;
      }
      if (!placed) break;
    }
    out.set(p.index, slots);
    prevSpaceAfter = p.spaceAfter ?? 0;
  }
  return out;
}

/** The leading read back inside a paragraph (its second line minus its first, in one column). */
function gapWithin(lines: readonly ReadLine[]): number | undefined {
  for (let k = 1; k < lines.length; k++) if (lines[k]!.slot.column === lines[k - 1]!.slot.column) return lines[k]!.slot.baseline - lines[k - 1]!.slot.baseline;
  return undefined;
}

function fits(col: Column, baseline: number, size: number): boolean {
  if (baseline <= col.lowest + 0.01) return true;
  const room = col.template.limit === undefined || baseline + DESCENT_SHARE * size <= col.template.limit + 0.01;
  // A full column holds lines below its lowest one only when they are closer than the line that did not fit.
  if (col.full) return col.overflowGap !== undefined && baseline < col.lowest + col.overflowGap - 0.01 && room;
  return room;
}

function slotAt(template: LineSlot, baseline: number, size: number, firstIndent: number, leftIndent: number | undefined, narrow?: Narrow): LineSlot {
  const [left, right] = template.columnBounds ?? [template.columnLeft ?? template.startX, template.columnRight];
  const [nl, nr] = narrow ? narrow(template.page, baseline, size, left, right) : [left, right];
  // Text starts at the column plus the paragraph's indent, or at a wrap object on the left.
  const indent = leftIndent ?? Math.max(0, template.startX - left);
  const startX = (nl > left + 0.01 ? nl : left + indent) + firstIndent;
  return { ...template, baseline, size, startX, columnLeft: nl, columnRight: nr };
}
