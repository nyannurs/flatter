// Do writes get slower when every tick merges into one growing undo step (AUTO_UNDO), as during a drag?
import { app, id, inNewDocument, type Any } from './lib.ts';

inNewDocument((doc: Any) => {
  const base = 'Dies ist ein Typoblindtext. An ihm kann man sehen, ob alle Buchstaben da sind und wie sie aussehen. ';
  const f = doc.pages.item(0).textFrames.add({ geometricBounds: [40, 40, 800, 563] });
  f.contents = base.repeat(Math.ceil(12000 / base.length));
  const story = f.parentStory;
  story.texts.item(0).properties = { appliedFont: 'Minion Pro\tRegular', pointSize: 12, leading: 14.4, composer: 'Adobe Single-line Composer' };
  const chars = story.paragraphs.item(0).characters;
  const tick = (v: number) => { for (let i = 0; i < 600; i++) chars.item(i * 19).tracking = v + (i % 5); };
  const run = (mode: Any, label: string) => {
    const times: number[] = [];
    for (let t = 0; t < 6; t++) {
      const s = Date.now();
      app.doScript(() => tick(t), id.ScriptLanguage.UXPSCRIPT, [], t === 0 ? id.UndoModes.ENTIRE_SCRIPT : mode, label);
      times.push(Date.now() - s);
    }
    return times;
  };
  const text = String(story.contents);
  const lines: [number, number][] = [];
  for (let a = 0; a + 112 < 11800; a += 112) lines.push([a, a + 110]);
  const timeIt = (fn: () => void) => { let ms = 0; app.doScript(() => { const t = Date.now(); fn(); ms = Date.now() - t; }, id.ScriptLanguage.UXPSCRIPT, [], id.UndoModes.AUTO_UNDO, 'x'); return ms; };
  const rangeWrites = timeIt(() => lines.forEach(([a, e], i) => { chars.itemByRange(a, e).tracking = 3 + (i % 9) * 0.37; }));
  let n = 0;
  const spaceWrites = timeIt(() => lines.forEach(([a, e], i) => { for (let k = a; k < e; k++) if (text[k] === ' ') { chars.item(k).tracking = 9 + (i % 9) * 0.41; n++; } }));
  const both = timeIt(() => lines.forEach(([a, e], i) => { chars.itemByRange(a, e).tracking = 4 + (i % 9) * 0.37; for (let k = a; k < e; k++) if (text[k] === ' ') chars.item(k).tracking = 11 + (i % 9) * 0.41; }));
  return {
    lines: lines.length, spaces: n, rangeWrites, spaceWrites, both,
    mergeIntoOneStep: run(id.UndoModes.AUTO_UNDO, 'drag'),
    separateSteps: run(id.UndoModes.ENTIRE_SCRIPT, 'tick'),
    fastSeparate: run(id.UndoModes.FAST_ENTIRE_SCRIPT, 'tick'),
  };
});
