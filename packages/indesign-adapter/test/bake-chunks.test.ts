import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bakeChunks, insertedLength, type BreakWrite, type TrackingWrite } from '../src/index.ts';

/** Insert the breaks chunk by chunk, as InDesign does, into a list of original character numbers (-1 = inserted). */
function applyBreaks(length: number, chunks: readonly (readonly BreakWrite[])[]): number[] {
  const text = Array.from({ length }, (_, k) => k);
  for (const chunk of chunks) for (const [at, hyphen] of chunk) text.splice(at, 0, ...(hyphen ? [-1, -1] : [-1]));
  return text;
}

describe('Set whole story in chunks', () => {
  it('writes breaks from the story end and moves tracking onto the same characters', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 400 }),
        fc.array(fc.tuple(fc.nat(), fc.boolean()), { maxLength: 60 }),
        fc.array(fc.tuple(fc.nat(), fc.nat({ max: 15 }), fc.integer({ min: -30, max: 30 })), { maxLength: 60 }),
        fc.integer({ min: 1, max: 7 }),
        (length, rawBreaks, rawTracking, size) => {
          const positions = [...new Set(rawBreaks.map(([k]) => 1 + (k % (length - 1))))];
          const breaks: BreakWrite[] = positions.map((at, i) => [at, rawBreaks[i]![1]]);
          const tracking: TrackingWrite[] = rawTracking.map(([a, n, v]) => {
            const from = a % length;
            return [from, Math.min(length - 1, from + n), v];
          });
          const chunks = bakeChunks(tracking, breaks, { breaks: size, tracking: size });
          // Every chunk at most `size` long, nothing lost, breaks in descending order.
          expect(chunks.breaks.every((c) => c.length <= size)).toBe(true);
          expect(chunks.breaks.flat()).toHaveLength(breaks.length);
          expect(chunks.tracking.flat()).toHaveLength(tracking.length);
          const order = chunks.breaks.flat().map((b) => b[0]);
          expect(order).toEqual([...order].sort((x, y) => y - x));
          const text = applyBreaks(length, chunks.breaks);
          expect(text.length).toBe(length + insertedLength(breaks));
          // A tracking range starts and ends on the characters it started and ended on before the breaks went in.
          chunks.tracking.flat().forEach(([a, e], i) => {
            expect(text[a]).toBe(tracking[i]![0]);
            expect(text[e]).toBe(tracking[i]![1]);
          });
        },
      ),
    );
  });
});
