// Width of one tracked line in InDesign versus Flatter's model: untracked advances (ligatures on) +
// letter tracking on every character but the last + word-space tracking on interior spaces + ligature extra.
import { asArray, inNewDocument, type Any } from './lib.ts';

const TEXT = 'a complete account of the system, and expound the actual teachings of the great explorer of the truth, the master-';
const T = -12.23;
const W = -7.36;

inNewDocument((doc: Any) => {
  const f = doc.pages.item(0).textFrames.add({ geometricBounds: [40, 40, 200, 1100] });
  f.contents = TEXT;
  const story = f.parentStory;
  story.texts.item(0).properties = { appliedFont: 'Minion Pro\tRegular', pointSize: 12, leading: 14.4, appliedLanguage: 'English: USA', composer: 'Adobe Single-line Composer', tracking: 0 };
  const chars = story.characters;
  const n = Number(chars.length);
  const end = () => Number(chars.item(n - 1).endHorizontalOffset) - Number(chars.item(0).horizontalOffset);
  const untracked = end();
  story.texts.item(0).ligatures = false;
  const noLig = end();
  story.texts.item(0).ligatures = true;
  const text = [...TEXT];
  chars.itemByRange(0, n - 2).tracking = T;
  const spaces: number[] = [];
  text.forEach((c, i) => { if (c === ' ' && i < n - 1) { chars.item(i).tracking = T + W; spaces.push(i); } });
  const tracked = end();
  const model = untracked + (T * 12 / 1000) * (n - 1) + (W * 12 / 1000) * spaces.length + (noLig - untracked);
  // Does it fit in 523.3 pt? Set the frame to that width and see where InDesign breaks.
  f.geometricBounds = [40, 40, 200, 40 + 523.2755905509999];
  const firstLine = String(story.lines.item(0).contents);
  // The same with the rest of the compound and sentence after it, as in the story.
  const g = doc.pages.item(0).textFrames.add({ geometricBounds: [300, 40, 500, 40 + 523.2755905509999] });
  g.contents = TEXT + 'builder of human happiness. No one rejects';
  const s2 = g.parentStory;
  s2.texts.item(0).properties = { appliedFont: 'Minion Pro\tRegular', pointSize: 12, leading: 14.4, appliedLanguage: 'English: USA', composer: 'Adobe Single-line Composer', tracking: 0, hyphenation: true, hyphenateBeforeLast: 3, hyphenateCapitalizedWords: false, hyphenationZone: 0, hyphenateLastWord: false };
  const c2 = s2.characters;
  c2.itemByRange(0, n - 2).tracking = T;
  spaces.forEach((i) => { c2.item(i).tracking = T + W; });
  const withRest = String(s2.lines.item(0).contents).slice(-25);
  // And with hyphenation off: does the break after the hard hyphen work then?
  s2.texts.item(0).hyphenation = false;
  const withRestNoHyph = String(s2.lines.item(0).contents).slice(-25);
  s2.texts.item(0).hyphenation = true;
  // Wider by 0.5 pt steps: from what width does InDesign take "master-"?
  const widths: Any[] = [];
  for (const extra of [0, 0.5, 1, 2, 3, 5]) {
    g.geometricBounds = [300, 40, 500, 40 + 523.2755905509999 + extra];
    widths.push([extra, String(s2.lines.item(0).contents).slice(-12)]);
  }
  return { withRest, withRestNoHyph, widths, n, spaces: spaces.length, untracked, noLig, ligExtra: noLig - untracked, tracked, model, error: tracked - model, firstLineEnd: firstLine.slice(-25) };
});
