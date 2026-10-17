// Why do some tracked lines come out wider than untracked advances + tracking? Compare per-character
// advances of the same text untracked and tracked (all but the last letter), Minion Pro 12 pt.
import { asArray, inNewDocument, type Any } from './lib.ts';

const SAMPLES = [
  'bekannt ist dieser: The quick brown',
  'um Schriften zu testen. Manchmal',
  'dog. Oft werden in Typoblindtexte',
  'in 86 der Texte zur Pflicht',
  'zu 245 € oder 368 $ bestraft.',
];

inNewDocument((doc: Any) => {
  const rows: Any[] = [];
  for (const text of SAMPLES) {
    const f = doc.pages.item(0).textFrames.add({ geometricBounds: [40, 40, 200, 1100] });
    f.contents = text;
    const all = f.parentStory.texts.item(0);
    all.properties = { appliedFont: 'Minion Pro\tRegular', pointSize: 12, leading: 14.4, appliedLanguage: 'English: USA', tracking: 0 };
    const chars = f.parentStory.characters;
    const n = Number(chars.length);
    const xs = (): number[] => asArray(chars.everyItem().horizontalOffset).map(Number);
    const end = (): number => Number(chars.item(n - 1).endHorizontalOffset);
    const x0 = xs();
    const e0 = end();
    chars.itemByRange(0, n - 2).tracking = 30;
    const x1 = xs();
    const e1 = end();
    const odd: Any[] = [];
    for (let k = 1; k < n; k++) {
      const d = x1[k]! - x1[k - 1]! - (x0[k]! - x0[k - 1]!) - 0.36;
      if (Math.abs(d) > 0.01) odd.push({ after: String(chars.item(k - 1).contents) + String(chars.item(k).contents), extra: Math.round(d * 1000) / 1000 });
    }
    const lig = asArray(chars.everyItem().ligatures);
    rows.push({ text, n, untracked: Math.round((e0 - x0[0]!) * 1000) / 1000, tracked: Math.round((e1 - x1[0]!) * 1000) / 1000,
      model: Math.round((e0 - x0[0]! + (n - 1) * 0.36) * 1000) / 1000, odd, ligaturesOn: lig[0] });
    f.remove();
  }
  return { rows };
});
