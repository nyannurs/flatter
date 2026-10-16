// S3/S7: how many points does each Duden hyphenation style allow on the reference words, and which of ours?
import { createHyphenator, render } from '@flatter/hyphenation';
import { asArray, DE_TEXT, inNewDocument, textFrame, type Any } from './lib.ts';

const TOLERANCE = 0.4;
function probe(frame: Any, word: string): number[] {
  const story = frame.parentStory;
  story.texts.item(0).contents = 'x ' + word;
  frame.geometricBounds = [20, 20, 120, 2020];
  const xs: number[] = asArray(story.characters.everyItem().horizontalOffset).map(Number);
  const xe: number[] = asArray(story.characters.everyItem().endHorizontalOffset).map(Number);
  const x0 = xs[0]!;
  const lead = xs[2]! - x0;
  const points: number[] = [];
  let limit = xe[word.length + 1]! - x0 - TOLERANCE - 0.05;
  while (limit > lead) {
    frame.geometricBounds = [20, 20, 120, 20 + limit];
    const n = String(story.lines.item(0).contents).length - 2;
    if (n <= 0 || n >= word.length) break;
    points.unshift(n);
    limit = xs[n + 2]! - x0 - TOLERANCE - 0.05;
  }
  return points;
}

inNewDocument((doc: Any) => {
  const words = [...new Set([...DE_TEXT.join(' ').match(/\p{L}{6,}/gu)!, 'Wachstube', 'Staubecken', 'Urinstinkt', 'Druckerzeugnis', 'beinhalten', 'Analphabet', 'Bauchinhalt', 'Feierabend', 'Biomüll', 'gegenüber', 'Programmheft', 'Instinkt'])];
  const h = createHyphenator({ language: 'de' });
  const out: Any = {};
  for (const style of ['HYPH_ALL', 'HYPH_ALL_BUT_UNAESTHETIC', 'HYPH_PREFERRED_AESTHETIC', 'HYPH_AESTHETIC']) {
    const frame = textFrame(doc, [20, 20, 120, 2020], 'x', { language: 'German: 2006 Reform', dudenStyle: style });
    let points = 0;
    let shared = 0;
    let wordsWithPoint = 0;
    const sample: string[] = [];
    for (const w of words) {
      const p = probe(frame, w);
      points += p.length;
      if (p.length) wordsWithPoint++;
      const safe = h.classify(w).filter((c) => c.quality === 'A' || c.quality === 'B').map((c) => c.index);
      shared += safe.filter((i) => p.includes(i)).length;
      if (/Ausstellungen|Feierabend|Zusammensetzungen|Druckerzeugnisse|Urinstinkt|beinhalten|Wachstube|Rechtschreibreform|Programmhefte/.test(w)) sample.push(render(w, p));
    }
    out[style] = { words: words.length, points, wordsWithPoint, pointsSharedWithOurSafe: shared, sample };
    frame.remove();
  }
  return out;
});
