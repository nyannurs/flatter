// How fast can we give the spaces inside each line their own tracking? 12,000 characters, 40 visible lines.
// a) one write per line for the letters + one write per space; b) one write per line + changeGrep for its spaces.
// Also: does tracking a space widen only that gap, and leave ligatures intact?
import { app, asArray, id, inNewDocument, type Any } from './lib.ts';

inNewDocument((doc: Any) => {
  const base = 'Dies ist ein Typoblindtext. An ihm kann man sehen, ob alle Buchstaben da sind. Sehr bekannt ist dieser: The quick brown fox jumps over the lazy old dog. In Pflicht und Schriften. ';
  const f = doc.pages.item(0).textFrames.add({ geometricBounds: [40, 40, 640, 225] });
  f.contents = base.repeat(Math.ceil(12000 / base.length));
  const story = f.parentStory;
  story.texts.item(0).properties = { appliedFont: 'Minion Pro\tRegular', pointSize: 12, leading: 14.4, composer: 'Adobe Single-line Composer' };
  const para = story.paragraphs.item(0);
  const lines = asArray(para.lines.everyItem().getElements()).filter((l: Any) => { try { return Number(l.baseline) > 0 && l.parentTextFrames.length > 0; } catch { return false; } });
  const ranges = lines.map((l: Any) => [Number(l.characters.item(0).index), Number(l.characters.item(-1).index)]);
  const text = String(story.contents);
  const t: Record<string, number> = {};
  const time = (k: string, fn: () => unknown) => { const s = Date.now(); fn(); t[k] = Date.now() - s; };
  let writes = 0;
  time('a_perSpace', () => {
    for (const [a, b] of ranges as [number, number][]) {
      story.characters.itemByRange(a, b - 2).tracking = 10;
      for (let k = a; k < b - 1; k++) if (text[k] === ' ') { story.characters.item(k).tracking = 40; writes++; }
    }
  });
  story.texts.item(0).tracking = 0;
  time('b_changeGrep', () => {
    app.findGrepPreferences = id.NothingEnum.NOTHING;
    app.changeGrepPreferences = id.NothingEnum.NOTHING;
    app.findGrepPreferences.findWhat = ' ';
    for (const [a, b] of ranges as [number, number][]) {
      const r = story.characters.itemByRange(a, b - 2);
      r.tracking = 10;
      app.changeGrepPreferences.tracking = 45;
      r.changeGrep();
    }
    app.findGrepPreferences = id.NothingEnum.NOTHING;
    app.changeGrepPreferences = id.NothingEnum.NOTHING;
  });
  // Space tracking effect on one sample.
  const g = doc.pages.item(0).textFrames.add({ geometricBounds: [700, 40, 760, 1100] });
  g.contents = 'The fine flow';
  g.parentStory.texts.item(0).properties = { appliedFont: 'Minion Pro\tRegular', pointSize: 12 };
  const cs = g.parentStory.characters;
  const xs = () => asArray(cs.everyItem().horizontalOffset).map(Number);
  const x0 = xs();
  cs.item(3).tracking = 100;
  const x1 = xs();
  return { lines: ranges.length, spaceWrites: writes, t, spaceEffect: x1.map((x, i) => Math.round((x - x0[i]!) * 1000) / 1000) };
});
