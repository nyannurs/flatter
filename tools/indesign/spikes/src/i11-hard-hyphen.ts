// With hyphenation on, does InDesign break after a hyphen typed in the text (compound words)? For each
// compound: frame just wide enough for "x <first part>-", see where line 1 ends, hyphenation on and off.
import { asArray, inNewDocument, type Any } from './lib.ts';

const CASES: [string, string][] = [
  ['English: USA', 'master-builder'], ['English: USA', 'long-term'], ['English: USA', 'self-evident'], ['English: USA', 'well-known'],
  ['English: USA', 'twenty-five'], ['English: USA', 'mother-in-law'], ['English: USA', 'state-of-the-art'], ['English: USA', 'pre-eminent'],
  ['German: 2006 Reform', 'E-Mail-Adresse'], ['German: 2006 Reform', 'Max-Planck-Institut'], ['German: 2006 Reform', 'Hamburg-Altona'],
  ['German: 2006 Reform', 'Bundesverkehrsministerium-Sprecher'], ['German: 2006 Reform', 'Ost-West-Konflikt'], ['German: 2006 Reform', 'Schiller-Gedichte'],
];

inNewDocument((doc: Any) => {
  const rows: Any[] = [];
  for (const [lang, word] of CASES) {
    const f = doc.pages.item(0).textFrames.add({ geometricBounds: [40, 40, 200, 1000] });
    f.contents = `x ${word} y`;
    const story = f.parentStory;
    story.texts.item(0).properties = { appliedFont: 'Minion Pro\tRegular', pointSize: 12, appliedLanguage: lang, composer: 'Adobe Single-line Composer', hyphenation: true, hyphenationZone: 0, hyphenateBeforeLast: 2, hyphenateAfterFirst: 2, hyphenateWordsLongerThan: 3 };
    const xs = asArray(story.characters.everyItem().horizontalOffset).map(Number);
    const xe = asArray(story.characters.everyItem().endHorizontalOffset).map(Number);
    const res: Any = { lang, word };
    const hy = word.indexOf('-') + 2; // index of the first hyphen in "x word y"
    for (const extra of [0.2, 3]) {
      f.geometricBounds = [40, 40, 200, 40 + (xe[hy]! - xs[0]!) + extra];
      story.texts.item(0).hyphenation = true;
      const on = String(story.lines.item(0).contents);
      story.texts.item(0).hyphenation = false;
      const off = String(story.lines.item(0).contents);
      res[`+${extra}`] = { on, off };
    }
    rows.push(res);
    f.remove();
  }
  return { rows };
});
