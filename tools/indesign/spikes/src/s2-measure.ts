/**
 * S2: can we predict composed line widths from bulk character measurements?
 * Pass: predicted vs actual line widths within 0.05 pt (plan §8).
 */
import { asArray, DE_TEXT, EN_TEXT, inNewDocument, readLines, textFrame, type Any } from './lib.ts';

inNewDocument((doc: Any) => {
  const report: Any[] = [];
  let worst = 0;
  let worstHyphen = 0;
  const hyphenGaps: number[] = [];
  const spaceGaps: number[] = [];
  let y = 20;
  const t0 = Date.now();
  let readMs = 0;
  for (const [lang, texts] of [['German: 2006 Reform', DE_TEXT], ['English: USA', EN_TEXT]] as const) {
    for (const text of texts) {
      // One very wide line: every character's advance, with kerning, in context.
      const wide = textFrame(doc, [y, 20, y + 30, 20 + 9000], text, { language: lang, capitalized: lang.startsWith('German') });
      y += 40;
      const ws = wide.parentStory;
      const tr = Date.now();
      const wStart: number[] = asArray(ws.characters.everyItem().horizontalOffset).map(Number);
      const wEnd: number[] = asArray(ws.characters.everyItem().endHorizontalOffset).map(Number);
      readMs += Date.now() - tr;
      // The same text at a normal measure.
      const narrow = textFrame(doc, [y, 20, y + 400, 20 + 300], text, { language: lang, capitalized: lang.startsWith('German') });
      y += 420;
      const tr2 = Date.now();
      const lines = readLines(narrow.parentStory);
      readMs += Date.now() - tr2;
      const rows = lines.map((l, i) => {
        let k = l.last;
        while (k > l.first && /^\s$/.test(text[k] ?? '')) k--;
        const predicted = wEnd[k]! - wStart[l.first]!;
        const actual = l.inkEnd - l.start;
        const diff = actual - predicted;
        if (i < lines.length - 1) {
          if (l.hyphenated) {
            worstHyphen = Math.max(worstHyphen, Math.abs(diff));
            hyphenGaps.push(l.lineEnd - l.inkEnd);
          } else {
            worst = Math.max(worst, Math.abs(diff));
            spaceGaps.push(l.lineEnd - l.inkEnd);
          }
        }
        return { line: i + 1, hyphenated: l.hyphenated, predicted: +predicted.toFixed(3), actual: +actual.toFixed(3), diff: +diff.toFixed(4), text: l.text.trim().slice(-24) };
      });
      report.push({ lang, rows });
    }
  }
  // Width of the hyphen glyph in Minion Pro 10 pt, measured as a character.
  const hy = textFrame(doc, [y, 20, y + 30, 1000], 'x-x');
  const hs: number[] = asArray(hy.parentStory.characters.everyItem().horizontalOffset).map(Number);
  const hyphenWidth = hs[2]! - hs[1]!;
  return {
    pass: worst <= 0.05,
    worstDiffUnhyphenated: +worst.toFixed(4),
    worstDiffHyphenatedLines: +worstHyphen.toFixed(4),
    hyphenGlyphWidth: +hyphenWidth.toFixed(4),
    lineEndMinusInkEnd: {
      hyphenatedLines: hyphenGaps.map((x) => +x.toFixed(3)),
      otherLines: [...new Set(spaceGaps.map((x) => +x.toFixed(3)))].slice(0, 6),
    },
    bulkReadMs: readMs,
    totalMs: Date.now() - t0,
    report,
  };
});
