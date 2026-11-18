import { createHyphenator } from '@flatter/hyphenation';
import { describe, expect, it } from 'vitest';
import { applyToPort, predictSlots, type LineSlot, type ReadLine } from '../src/index.ts';
import { FakeInDesign } from './fake-indesign.ts';

const de = createHyphenator({ language: 'de' });
const ourSafe = (w: string) => de.classify(w).filter((p) => p.quality === 'A' || p.quality === 'B').map((p) => p.index);
const DE = [
  'Ein guter Flattersatz entsteht nicht von selbst. Wer Texte linksbündig setzt, überlässt den rechten Rand scheinbar dem Zufall, doch gerade dieser Rand bestimmt, ob eine Seite ruhig oder unruhig wirkt.',
  'In der Wachstube des alten Rathauses lagen die Druckerzeugnisse der vergangenen Woche auf einem Stapel: Flugblätter, Programmhefte und ein dünnes Verzeichnis der Ausstellungen im Staubecken der ehemaligen Mühle.',
  'Die Rechtschreibreform von 2006 hat das Trennen in einigen Punkten vereinfacht. Das ck bleibt zusammen, das st darf getrennt werden, und bei Zusammensetzungen wie Schifffahrt bleiben alle drei Konsonanten erhalten.',
];

/** Read-back lines: paragraph line counts, columns of `perColumn` lines at leading 13. */
function readBack(counts: number[], perColumn: number): ReadLine[] {
  const out: ReadLine[] = [];
  let k = 0;
  counts.forEach((n, paragraph) => {
    for (let line = 0; line < n; line++, k++) {
      const column = Math.floor(k / perColumn);
      const x = column * 110;
      const slot: LineSlot = { page: 0, baseline: 13 * ((k % perColumn) + 1), startX: x, columnLeft: x, columnRight: x + 100, gutter: 10, size: 10, limit: 13 * perColumn + 3, column, columnBounds: [x, x + 100] };
      out.push({ paragraph, line, lastVisible: 0, hyphenated: false, slot });
    }
  });
  return out;
}

describe('predicting where planned lines land', () => {
  it('moves every later line when an earlier paragraph gains a line', () => {
    // Now 3 + 3 + 3 lines in columns of 4; planned 4 + 3 + 3.
    const slots = predictSlots(readBack([3, 3, 3], 4), [0, 1, 2].map((index) => ({ index, lines: index === 0 ? 4 : 3, leading: 13, size: 10 })));
    const where = (p: number) => slots.get(p)!.map((s) => `${s.column}:${s.baseline}`);
    expect(where(0)).toEqual(['0:13', '0:26', '0:39', '0:52']);
    expect(where(1)).toEqual(['1:13', '1:26', '1:39']);
    expect(where(2)).toEqual(['1:52', '2:13', '2:26']);
  });

  it('gives no slot beyond the columns read back', () => {
    const slots = predictSlots(readBack([4, 4], 4), [{ index: 0, lines: 5, leading: 13, size: 10 }, { index: 1, lines: 4, leading: 13, size: 10 }]);
    expect(slots.get(0)!.length).toBe(5);
    expect(slots.get(1)!.length).toBe(3);
  });

  it('returns nothing without column ids (the old placement is used)', () => {
    const lines = readBack([3, 3], 4).map((l) => ({ ...l, slot: { ...l.slot, column: undefined } }));
    expect(predictSlots(lines, [{ index: 0, lines: 4 }, { index: 1, lines: 3 }]).size).toBe(0);
  });
});

describe('long stories through many columns', () => {
  const story = Array.from({ length: 36 }, (_, k) => DE[k % DE.length]!);
  for (const spaceBefore of [0, 6]) {
    it(`settles in a few rounds with every line as planned (space before ${spaceBefore})`, () => {
      const settings = { zoneShare: 0.2, bandShare: 0.5 };
      const old = applyToPort(new FakeInDesign(story, { measure: 230, accepts: ourSafe, columnLines: 14, spaceBefore, hideColumns: true }), settings);
      const fake = new FakeInDesign(story, { measure: 230, accepts: ourSafe, columnLines: 14, spaceBefore });
      const r = applyToPort(fake, settings);
      expect(r.linesAsPlanned).toBe(r.linesPlanned);
      expect(r.rounds).toBeLessThanOrEqual(3);
      // Without the prediction the same story needs far more rounds (one per column boundary) or ends off plan.
      expect(old.rounds > r.rounds || old.linesAsPlanned < old.linesPlanned).toBe(true);
    });
  }
});

describe('hyphens at the end of a column', () => {
  it('plans no hyphen on a line that will end a column when InDesign does not hyphenate there', () => {
    const story = Array.from({ length: 60 }, (_, k) => DE[k % DE.length]!);
    const fake = new FakeInDesign(story, { measure: 200, accepts: ourSafe, columnLines: 11, hyphenateAcrossColumns: false });
    const r = applyToPort(fake, { zoneShare: 0.2, bandShare: 0.5 });
    expect(r.linesAsPlanned).toBe(r.linesPlanned);
    expect(r.rounds).toBeLessThanOrEqual(3);
    expect(r.paragraphs.flatMap((p) => p.refused)).toEqual([]);
    // No planned hyphen sits on the last line of a column.
    const lines = fake.readLines();
    lines.forEach((l, k) => {
      const next = lines[k + 1];
      if (next && next.slot.column !== l.slot.column) expect(l.hyphenated, `¶${l.paragraph} line ${l.line}`).toBe(false);
    });
  });
});

