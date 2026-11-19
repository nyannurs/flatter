/**
 * Finding paragraphs again after the story was edited (2026-11-19). Flatter keeps each paragraph's original settings
 * and base tracking for Remove under the paragraph's number. A paragraph added or deleted after Apply shifted every
 * later number, and Remove gave paragraphs their neighbours' originals. Now Flatter also keeps a fingerprint of every
 * paragraph (the start of its text) and maps the stored numbers to today's by lining up the two lists of
 * fingerprints. A paragraph whose start was rewritten is not found: its originals are left out rather than guessed.
 * Pure: no InDesign APIs, tested in Node.
 */

/** Characters of a paragraph's start kept in its fingerprint. */
const PRINT_LENGTH = 48;
/** How far ahead the lists are searched for the next match (paragraphs added or deleted in one place). */
const RESYNC_WINDOW = 200;

/**
 * A paragraph's fingerprint: the start of its text without line breaks, hyphens and soft hyphens (Freeze and Set
 * whole story insert those) and with runs of spaces as one.
 */
export function paragraphPrint(text: string): string {
  return text
    .replace(/[\n\u2028\r\u00ad-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PRINT_LENGTH);
}

/**
 * Stored paragraph number → current paragraph number, for every stored paragraph found again. Walks both lists in
 * order; where they differ it resumes at the nearest pair of equal fingerprints (fewest paragraphs skipped).
 */
export function alignPrints(stored: readonly string[], current: readonly string[]): Map<number, number> {
  const out = new Map<number, number>();
  let i = 0;
  let j = 0;
  while (i < stored.length && j < current.length) {
    if (stored[i] === current[j]) {
      out.set(i++, j++);
      continue;
    }
    let found = false;
    for (let d = 1; d <= RESYNC_WINDOW && !found; d++) {
      for (let a = 0; a <= d; a++) {
        const b = d - a;
        if (i + a < stored.length && j + b < current.length && stored[i + a] === current[j + b]) {
          i += a;
          j += b;
          found = true;
          break;
        }
      }
    }
    if (!found) {
      i++;
      j++;
    }
  }
  return out;
}

/** Re-key a per-paragraph record by the mapping; entries of paragraphs not found are dropped and counted. */
export function remapByParagraph<T>(record: Record<string, T> | undefined, map: ReadonlyMap<number, number>): { record: Record<string, T>; lost: number } {
  const out: Record<string, T> = {};
  let lost = 0;
  for (const [k, v] of Object.entries(record ?? {})) {
    const to = map.get(Number(k));
    if (to === undefined) lost++;
    else out[String(to)] = v;
  }
  return { record: out, lost };
}

/** The paragraph a story character belongs to, given every paragraph's start index in ascending order (binary search). */
export function paragraphAt(starts: readonly number[], index: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= index) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}
