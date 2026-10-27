// With tracking, which OpenType features does InDesign turn off, and how do widths change? Avara Bold 14 pt
// (contextual alternates and ligatures) versus Minion Pro, for sample text with letters tracked t and spaces t + w.
import { asArray, inNewDocument, type Any } from './lib.ts';

const SAMPLE = 'da sind und wie sie aussehen. Manchmal benutzt man Worte wie Hamburgefonts';
const T = 5;
const W = 80;

inNewDocument((doc: Any) => {
  const rows: Any[] = [];
  for (const font of ['Avara\tBold', 'Minion Pro\tRegular']) {
    const width = (props: Any, tracked: boolean): number => {
      const f = doc.pages.item(0).textFrames.add({ geometricBounds: [40, 40, 200, 1100] });
      f.contents = SAMPLE;
      const s = f.parentStory;
      s.texts.item(0).properties = { appliedFont: font, pointSize: 14, tracking: 0, ...props };
      const chars = s.characters;
      const n = Number(chars.length);
      if (tracked) {
        chars.itemByRange(0, n - 2).tracking = T;
        [...SAMPLE].forEach((c, i) => { if (c === ' ') chars.item(i).tracking = T + W; });
      }
      const x0 = Number(chars.item(0).horizontalOffset);
      const w = Number(chars.item(n - 1).endHorizontalOffset) - x0;
      f.remove();
      return Math.round(w * 1000) / 1000;
    };
    const spaces = [...SAMPLE].filter((c, i) => c === ' ' && i < SAMPLE.length - 1).length;
    const added = ((SAMPLE.length - 1) * T + spaces * W) * 14 / 1000;
    const plain = width({}, false);
    const noLig = width({ ligatures: false }, false);
    const noLigNoCalt = width({ ligatures: false, otfContextualAlternate: false }, false);
    const tracked = width({}, true);
    rows.push({ font, plain, noLig, noLigNoCalt, tracked, modelLig: Math.round((noLig + added) * 1000) / 1000, modelLigCalt: Math.round((noLigNoCalt + added) * 1000) / 1000, added: Math.round(added * 1000) / 1000 });
  }
  return { rows };
});
