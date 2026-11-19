import { describe, expect, it } from 'vitest';
import { alignPrints, paragraphAt, paragraphPrint, remapByParagraph } from '../src/index.ts';

const P = Array.from({ length: 30 }, (_, k) => `Absatz ${k}: Ein guter Flattersatz entsteht nicht von selbst, Nummer ${k}.`);

describe('finding paragraphs again after edits', () => {
  it('ignores the line breaks and hyphens that freezing inserts', () => {
    const plain = 'Ein guter Flattersatz entsteht nicht von selbst. Wer Texte linksbündig setzt';
    const frozen = 'Ein guter Flatter-\nsatz entsteht nicht \nvon selbst. Wer Texte links-\nbündig setzt';
    expect(paragraphPrint(frozen)).toBe(paragraphPrint(plain));
  });

  it('maps every paragraph to itself when nothing changed', () => {
    const prints = P.map(paragraphPrint);
    const map = alignPrints(prints, prints);
    expect([...map]).toEqual(prints.map((_, k) => [k, k]));
  });

  it('follows paragraphs added and deleted in several places', () => {
    const stored = P.map(paragraphPrint);
    // A new paragraph at the start, paragraph 10 deleted, two added after 20.
    const now = ['Neuer Anfang.', ...P.slice(0, 10), ...P.slice(11, 21), 'Neu A.', 'Neu B.', ...P.slice(21)].map(paragraphPrint);
    const map = alignPrints(stored, now);
    expect(map.get(0)).toBe(1);
    expect(map.get(9)).toBe(10);
    expect(map.has(10)).toBe(false);
    expect(map.get(11)).toBe(11);
    expect(map.get(20)).toBe(20);
    expect(map.get(21)).toBe(23);
    expect(map.get(29)).toBe(31);
  });

  it('leaves out a paragraph whose start was rewritten', () => {
    const stored = P.map(paragraphPrint);
    const now = P.map((t, k) => (k === 5 ? `Ganz anders: ${t}` : t)).map(paragraphPrint);
    const map = alignPrints(stored, now);
    expect(map.has(5)).toBe(false);
    expect(map.get(6)).toBe(6);
    const { record, lost } = remapByParagraph({ 4: 'a', 5: 'b', 6: 'c' }, map);
    expect(record).toEqual({ 4: 'a', 6: 'c' });
    expect(lost).toBe(1);
  });

  it('keeps identical paragraphs apart when one is added in front', () => {
    const same = Array.from({ length: 6 }, () => paragraphPrint('Immer derselbe Absatz.'));
    const stored = ['Kopf', ...same, 'Ende'].map(paragraphPrint);
    const now = ['Kopf', 'Eingefügt', ...same, 'Ende'].map(paragraphPrint);
    const map = alignPrints(stored, now);
    expect(map.get(1)).toBe(2);
    expect(map.get(6)).toBe(7);
    expect(map.get(7)).toBe(8);
  });
});

describe('paragraphAt', () => {
  it('finds the paragraph of every character', () => {
    const starts = [0, 5, 6, 20];
    const linear = (k: number) => {
      let p = 0;
      while (p + 1 < starts.length && starts[p + 1]! <= k) p++;
      return p;
    };
    for (let k = 0; k < 30; k++) expect(paragraphAt(starts, k)).toBe(linear(k));
  });
  it('copes with one paragraph and an empty list', () => {
    expect(paragraphAt([0], 12)).toBe(0);
    expect(paragraphAt([], 3)).toBe(0);
  });
});
