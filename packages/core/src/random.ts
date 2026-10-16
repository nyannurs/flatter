/**
 * Deterministic hash to [0, 1). Variation targets are seeded by the item index
 * where a line starts, so they stay attached to the text while sliders move.
 */
export function unitHash(seed: number, k: number): number {
  let h = Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(k | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
