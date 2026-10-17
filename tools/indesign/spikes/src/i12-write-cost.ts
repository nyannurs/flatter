// Does a tracking write get slower when the paragraph has many style ranges (every tracked space adds two)?
import { app, id, inNewDocument, type Any } from './lib.ts';

inNewDocument((doc: Any) => {
  const base = 'Dies ist ein Typoblindtext. An ihm kann man sehen, ob alle Buchstaben da sind und wie sie aussehen. ';
  const f = doc.pages.item(0).textFrames.add({ geometricBounds: [40, 40, 800, 563] });
  f.contents = base.repeat(Math.ceil(12000 / base.length));
  const story = f.parentStory;
  story.texts.item(0).properties = { appliedFont: 'Minion Pro\tRegular', pointSize: 12, leading: 14.4, composer: 'Adobe Single-line Composer' };
  const para = story.paragraphs.item(0);
  const chars = para.characters;
  const text = String(story.contents);
  const spaces: number[] = [];
  for (let k = 0; k < text.length; k++) if (text[k] === ' ') spaces.push(k);
  const out: Any[] = [];
  const teeth: Any[] = [];
  const addTeeth = (n: number) => {
    const none = doc.swatches.itemByName('None');
    const lines = Math.min(n, 52);
    for (let i = 0; i < lines; i++) {
      const b = 40 + 14.4 * (i + 1) - 3;
      const r = doc.pages.item(0).rectangles.add({ geometricBounds: [b, 500, b + 0.1, 565], strokeWeight: 0, strokeColor: none, fillColor: none });
      r.textWrapPreferences.properties = { textWrapMode: id.TextWrapModes.BOUNDING_BOX_TEXT_WRAP, textWrapSide: id.TextWrapSideOptions.LEFT_SIDE, textWrapOffset: [0, 0, 0, 0] };
      teeth.push(r);
    }
  };
  for (const [ranges, withTeeth] of [[2000, false], [2000, true]] as const) {
    if (withTeeth) addTeeth(52);
    para.texts.item(0).tracking = 0;
    // Make about this many style ranges by tracking every n-th space.
    const step = ranges ? Math.max(1, Math.floor(spaces.length / (ranges / 2))) : 0;
    if (step) for (let i = 0; i < spaces.length; i += step) chars.item(spaces[i]!).tracking = 7;
    const r = Number(para.textStyleRanges.length);
    for (const mode of ['auto', 'fast'] as const) {
      let ms = 0;
      app.doScript(() => {
        const t = Date.now();
        for (let i = 0; i < 300; i++) chars.itemByRange(i * 30, i * 30 + 20).tracking = (i % 7) + (mode === 'fast' ? 0.5 : 0.25);
        ms = Date.now() - t;
      }, id.ScriptLanguage.UXPSCRIPT, [], mode === 'auto' ? id.UndoModes.AUTO_UNDO : id.UndoModes.FAST_ENTIRE_SCRIPT, 'w');
      out.push({ ranges: r, mode, teeth: teeth.length, msPer300Writes: ms });
    }
  }
  return { out };
});
