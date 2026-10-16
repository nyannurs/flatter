import { describe, expect, it } from 'vitest';
import { createSenseRule } from '../src/index.ts';

const de = createSenseRule('de');
const en = createSenseRule('en-US');
const cost = (r: typeof de, a: string, b: string) => r(a, b)?.cost ?? 0;

describe('Sinneinheiten, German', () => {
  it('discourages line ends on articles, prepositions and one-letter words', () => {
    expect(cost(de, 'der', 'Hund')).toBeGreaterThan(0);
    expect(cost(de, 'mit', 'einem')).toBeGreaterThan(0);
    expect(cost(de, 'a', 'b')).toBeGreaterThan(0);
    expect(cost(de, 'Hund', 'bellt')).toBe(0);
  });

  it('does not penalise a word that ends a clause', () => {
    expect(cost(de, 'mit,', 'und')).toBe(0);
  });

  it('keeps numbers with units, dates and abbreviations together', () => {
    expect(cost(de, '10', 'kg')).toBeGreaterThanOrEqual(300);
    expect(cost(de, '5', '%')).toBeGreaterThanOrEqual(300);
    expect(cost(de, '12.', 'März')).toBeGreaterThan(100);
    expect(cost(de, 'z.', 'B.')).toBeGreaterThan(100);
    expect(cost(de, 'S.', '42')).toBeGreaterThan(100);
    expect(cost(de, 'J.', 'S.')).toBeGreaterThan(100);
  });

  it('ranks numbers and units above articles', () => {
    expect(cost(de, '10', 'kg')).toBeGreaterThan(cost(de, 'der', 'Hund'));
  });
});

describe('Sinneinheiten, English', () => {
  it('discourages articles, prepositions and pronouns at the line end', () => {
    expect(cost(en, 'the', 'house')).toBeGreaterThan(0);
    expect(cost(en, 'of', 'the')).toBeGreaterThan(0);
    expect(cost(en, 'I', 'think')).toBeGreaterThan(0);
    expect(cost(en, 'house', 'stands')).toBe(0);
  });

  it('keeps names, titles, list markers and units together (CMOS)', () => {
    expect(cost(en, 'Dr.', 'Watson')).toBeGreaterThan(100);
    expect(cost(en, 'King', 'Jr.')).toBeGreaterThan(100);
    expect(cost(en, 'J.', 'R.')).toBeGreaterThan(100);
    expect(cost(en, '(a)', 'first')).toBeGreaterThan(0);
    expect(cost(en, '12', 'pt')).toBeGreaterThanOrEqual(300);
    expect(cost(en, 'March', '12')).toBeGreaterThan(100);
  });
});
