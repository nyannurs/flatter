// S2: how much wider than the frame may a line be before InDesign breaks it? (fitting tolerance)
import { asArray, inNewDocument, textFrame, type Any } from './lib.ts';

inNewDocument((doc: Any) => {
  const samples = [
    'at once, while a machine has to be told, and even then it may need a second',
    'Ein guter Flattersatz entsteht nicht von selbst. Wer Texte',
    'and every word division has to be correct, or',
  ];
  const results: Any[] = [];
  let y = 20;
  for (const s of samples) {
    const wide = textFrame(doc, [y, 20, y + 30, 9020], s, { hyphenation: false });
    y += 40;
    const xs: number[] = asArray(wide.parentStory.characters.everyItem().horizontalOffset).map(Number);
    const xe: number[] = asArray(wide.parentStory.characters.everyItem().endHorizontalOffset).map(Number);
    const natural = xe[xs.length - 1]! - xs[0]!;
    const rows: Any[] = [];
    for (let d = -0.4; d <= 0.051; d += 0.01) {
      const w = natural + d;
      const f = textFrame(doc, [y, 20, y + 40, 20 + w], s, { hyphenation: false });
      y += 45;
      const lines = f.parentStory.lines.length;
      rows.push({ shortfall: +(-d).toFixed(3), fitsOnOneLine: lines === 1 });
    }
    const fit = rows.filter((r) => r.fitsOnOneLine).map((r) => r.shortfall);
    results.push({ text: s.slice(0, 30), natural: +natural.toFixed(3), largestShortfallThatStillFits: Math.max(...fit), relative: +(Math.max(...fit) / natural * 100).toFixed(4) + ' %' });
  }
  return { results };
});
