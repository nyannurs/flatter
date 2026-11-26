/**
 * Set whole story in chunks (2026-11-26, ADR-036). The panel cannot redraw while InDesign runs a script, so a progress
 * bar needs the writes split into several script calls. Breaks go first, from the end of the story backwards (earlier
 * positions stay valid), then the tracking at positions moved by the inserted characters, exactly as the single script
 * did before. Pure: no InDesign APIs, tested in Node.
 */

/** A forced line break at a story position; true when a hyphen goes in front of it. */
export type BreakWrite = [at: number, hyphen: boolean];
/** Tracking for the story characters from..to (inclusive). */
export type TrackingWrite = [from: number, to: number, value: number];

export interface BakeChunks {
  /** Break chunks in writing order (story end first). */
  breaks: BreakWrite[][];
  /** Tracking chunks with positions after all breaks are in. */
  tracking: TrackingWrite[][];
}

/** Items per chunk: one chunk is a few hundred milliseconds of writing (ExtendScript, 2026-11-26). */
export const CHUNK_SIZE = { breaks: 200, tracking: 600 } as const;

/** Characters a break inserts: "\n", or "-\n" with a hyphen. */
export const breakLength = (b: BreakWrite): number => (b[1] ? 2 : 1);

/**
 * Split the writes into chunks. `tracking` holds positions in the text before any break is inserted; the result's
 * tracking positions are moved by the characters inserted before them.
 */
export function bakeChunks(tracking: readonly TrackingWrite[], breaks: readonly BreakWrite[], size: { breaks: number; tracking: number } = CHUNK_SIZE): BakeChunks {
  const desc = [...breaks].sort((a, b) => b[0] - a[0]);
  const asc = [...desc].reverse();
  // before[i]: characters inserted by the first i breaks in story order.
  const before = [0];
  for (const b of asc) before.push(before[before.length - 1]! + breakLength(b));
  // A break at position k inserts in front of the character at k, so that character moves too.
  const shift = (k: number): number => {
    let lo = 0;
    let hi = asc.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (asc[mid]![0] <= k) lo = mid + 1;
      else hi = mid;
    }
    return k + before[lo]!;
  };
  const moved = tracking.map(([a, e, v]): TrackingWrite => [shift(a), shift(e), v]);
  return { breaks: split(desc, Math.max(1, size.breaks)), tracking: split(moved, Math.max(1, size.tracking)) };
}

function split<T>(list: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/** Characters the breaks insert in total. */
export const insertedLength = (breaks: readonly BreakWrite[]): number => breaks.reduce((s, b) => s + breakLength(b), 0);
