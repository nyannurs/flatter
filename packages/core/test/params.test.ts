import { describe, expect, it } from 'vitest';
import { defaultFlatterzone, modeLabel, resolveParams } from '../src/index.ts';

describe('defaults from plan §2', () => {
  it('uses W/5 for wide columns and W/7 for narrow ones', () => {
    expect(defaultFlatterzone(300, 65)).toBeCloseTo(60);
    expect(defaultFlatterzone(210, 35)).toBeCloseTo(30);
    expect(defaultFlatterzone(300)).toBeCloseTo(60);
  });

  it('clamps the slider to W/12 … W/4', () => {
  });

  it('labels small Flatterzones as Rauhsatz', () => {
    expect(modeLabel(20, 300)).toBe('Rauhsatz');
    expect(modeLabel(30, 300)).toBe('Flattersatz');
  });
});

describe('resolveParams', () => {
  it('derives band and contrast from the Flatterzone', () => {
    const p = resolveParams({ measure: 300, flatterzone: 60 });
    expect(p.band).toBeCloseTo(30);
    expect(p.contrast).toBeCloseTo(30);
  });

  it('applies the designer defaults', () => {
    const p = resolveParams({ measure: 300 });
    expect(p.mode).toBe('strict');
    expect(p.hyphenation).toBe('safe');
    expect(p.phase).toBe('long');
    expect(p.maxConsecutiveHyphens).toBe(2);
    expect(p.hyphenCountsTowardWidth).toBe(true);
    expect(p.variation).toBe(0);
  });

  it('makes English hyphenate less than German', () => {
    const de = resolveParams({ measure: 300, language: 'de' });
    const en = resolveParams({ measure: 300, language: 'en' });
    expect(en.weights.hyphenB).toBeGreaterThan(de.weights.hyphenB);
    expect(en.weights.hyphenBudget).toBeLessThan(de.weights.hyphenBudget);
  });

  it('rejects overlapping bands and bad input', () => {
    expect(() => resolveParams({ measure: 300, flatterzone: 20, band: 20 })).toThrow(RangeError);
    expect(() => resolveParams({ measure: 0 })).toThrow(RangeError);
    expect(() => resolveParams({ measure: 300, variation: 2 })).toThrow(RangeError);
    expect(() => resolveParams({ measure: 100, flatterzone: 90, band: 20 })).toThrow(RangeError);
  });
});
