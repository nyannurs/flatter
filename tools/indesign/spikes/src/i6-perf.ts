// Performance: what makes probing cleanup, tooth creation and tracking writes slow, and do undo modes help?
// A 12,000-character story in two threaded 185 × 272 pt frames (like the user's TestFile), overset.
import { app, asArray, id, inNewDocument, type Any } from './lib.ts';

const WORDS = 'Typoblindtext Buchstaben Hamburgefonts Rafgenduks Handgloves Schriften Alphabets Pangrams bekannt fremdsprachige Satzteile eingebaut Wirkung Sprachen Lateinisch demonstrandum Testtexten weswegen Nichteinhaltung bestraft mittlerweile Akzente'.split(' ');

/** Copy of the user's untouched TestFile story (read-only on their file), or generated text. */
function setup(doc: Any): Any {
  for (let i = 0; i < app.documents.length; i++) {
    const d = app.documents.item(i);
    if (!String(d.name).startsWith('TestFile') || app.extractLabel('flatter-i6-source') !== 'user') continue;
    for (let s = 0; s < d.stories.length; s++) {
      const st = d.stories.item(s);
      if (Number(st.characters.length) < 5000 || Number(st.paragraphs.length) !== 1) continue;
      doc.documentPreferences.pagesPerDocument = 2;
      const f1 = doc.pages.item(0).textFrames.add({ geometricBounds: [40, 40, 312, 225] });
      const f2 = doc.pages.item(1).textFrames.add({ geometricBounds: [40, 40, 312, 225] });
      f1.nextTextFrame = f2;
      st.texts.item(0).duplicate(id.LocationOptions.AT_BEGINNING, f1.insertionPoints.item(0));
      f1.parentStory.texts.item(0).properties = { composer: 'Adobe Single-line Composer', leading: 14.4 };
      f1.parentStory.recompose();
      return f1.parentStory;
    }
  }
  doc.documentPreferences.pagesPerDocument = 2;
  const f1 = doc.pages.item(0).textFrames.add({ geometricBounds: [40, 40, 312, 225] });
  const f2 = doc.pages.item(1).textFrames.add({ geometricBounds: [40, 40, 312, 225] });
  f1.nextTextFrame = f2;
  const base = 'Dies ist ein Typoblindtext. An ihm kann man sehen, ob alle Buchstaben da sind und wie sie aussehen. Manchmal benutzt man Worte wie Hamburgefonts, Rafgenduks oder Handgloves, um Schriften zu testen. ';
  f1.contents = base.repeat(Math.ceil(12000 / base.length));
  f1.parentStory.texts.item(0).properties = { appliedFont: 'Minion Pro\tRegular', pointSize: 12, leading: 14.4, composer: 'Adobe Single-line Composer', appliedLanguage: 'German: 2006 Reform' };
  f1.parentStory.recompose();
  return f1.parentStory;
}

function scenario(doc: Any, story: Any, layer: Any): Record<string, number> {
  const t: Record<string, number> = {};
  const time = (k: string, fn: () => unknown) => { const s = Date.now(); fn(); t[k] = Date.now() - s; };
  const page = doc.pages.item(0);
  const right = Number(page.bounds[3]);
  let scratch: Any;
  time('probe70', () => {
    scratch = page.textFrames.add({ geometricBounds: [0, right + 200, 100, right + 2200], itemLayer: layer, contents: 'x' });
    scratch.parentStory.texts.item(0).properties = { appliedFont: 'Minion Pro\tRegular', pointSize: 12, appliedLanguage: 'German: 2006 Reform', hyphenation: true };
    for (let i = 0; i < 70; i++) {
      const w = WORDS[i % WORDS.length]!;
      scratch.parentStory.texts.item(0).contents = 'x ' + w;
      for (const width of [400, 80, 60, 45]) {
        scratch.geometricBounds = [0, right + 200, 100, right + 200 + width];
        void String(scratch.parentStory.lines.item(0).contents);
      }
    }
  });
  time('removeScratch', () => scratch.remove());
  const lines = asArray(story.textContainers[0].lines.everyItem().getElements()).slice(0, 38);
  const baselines = lines.map((l: Any) => Number(l.baseline));
  const none = doc.swatches.itemByName('None');
  const rects: Any[] = [];
  time('create38teeth', () => {
    for (const b of baselines) {
      const r = page.rectangles.add({ geometricBounds: [b - 3, 190, b - 2.9, 228], strokeWeight: 0, strokeColor: none, fillColor: none, itemLayer: layer, nonprinting: true });
      r.textWrapPreferences.properties = { textWrapMode: id.TextWrapModes.BOUNDING_BOX_TEXT_WRAP, textWrapSide: id.TextWrapSideOptions.LEFT_SIDE, textWrapOffset: [0, 0, 0, 0] };
      r.insertLabel('flatter-line', 'x');
      rects.push(r);
    }
  });
  time('move38teeth', () => rects.forEach((r: Any, i: number) => { r.geometricBounds = [baselines[i]! - 3, 180, baselines[i]! - 2.9, 228]; }));
  const para = story.paragraphs.item(0);
  time('track38lines+230spaces', () => {
    let k = 0;
    for (let l = 0; l < 38; l++) {
      para.characters.itemByRange(k, k + 30).tracking = 5 + l * 0.01;
      for (let s = 0; s < 6; s++) para.characters.item(k + 5 * s + 3).tracking = 20;
      k += 32;
    }
  });
  time('readStyleRanges', () => { asArray(para.textStyleRanges.everyItem().index); asArray(para.textStyleRanges.everyItem().tracking); });
  time('recompose', () => story.recompose());
  time('removeTeeth', () => rects.forEach((r: Any) => r.remove()));
  para.texts.item(0).tracking = 0;
  return t;
}

function ticks(doc: Any, story: Any, layer: Any, order: 'track-first' | 'teeth-first' | 'teeth-only' | 'track-only'): Any {
  const page = doc.pages.item(0);
  const lines = asArray(story.textContainers[0].lines.everyItem().getElements()).slice(0, 18);
  const starts = lines.map((l: Any) => Number(l.characters.item(0).index));
  const ends = lines.map((l: Any) => Number(l.characters.item(-1).index));
  const baselines = lines.map((l: Any) => Number(l.baseline));
  const text = String(story.contents);
  const none = doc.swatches.itemByName('None');
  const rects = baselines.map((b: number) => {
    const r = page.rectangles.add({ geometricBounds: [b - 3, 200, b - 2.9, 228], strokeWeight: 0, strokeColor: none, fillColor: none, itemLayer: layer, nonprinting: true });
    r.textWrapPreferences.properties = { textWrapMode: id.TextWrapModes.BOUNDING_BOX_TEXT_WRAP, textWrapSide: id.TextWrapSideOptions.LEFT_SIDE, textWrapOffset: [0, 0, 0, 0] };
    return r;
  });
  const para = story.paragraphs.item(0);
  const out: Any[] = [];
  for (let tick = 0; tick < 6; tick++) {
    let tr = 0;
    let te = 0;
    const track = () => {
      const s0 = Date.now();
      starts.forEach((a: number, l: number) => {
        para.characters.itemByRange(a, ends[l]! - 1).tracking = tick + l * 0.01;
        for (let k = a; k < ends[l]! - 1; k++) if (text[k] === ' ') para.characters.item(k).tracking = tick + 10;
      });
      tr = Date.now() - s0;
    };
    const teeth = () => {
      const s0 = Date.now();
      rects.forEach((r: Any, i: number) => { r.geometricBounds = [baselines[i]! - 3, 200 + tick * 0.1, baselines[i]! - 2.9, 228]; });
      te = Date.now() - s0;
    };
    if (order === 'track-first') { track(); teeth(); }
    else if (order === 'teeth-first') { teeth(); track(); }
    else if (order === 'teeth-only') teeth();
    else track();
    out.push([tr, te]);
  }
  rects.forEach((r: Any) => r.remove());
  para.texts.item(0).tracking = 0;
  return out;
}

inNewDocument((doc: Any) => {
  const story = setup(doc);
  const layer = doc.layers.add({ name: 'perf', printable: false });
  const out: Record<string, Any> = {};
  for (const order of ['track-first', 'teeth-first', 'teeth-only', 'track-only'] as const) {
    let r: Any;
    app.doScript(() => { r = ticks(doc, story, layer, order); }, id.ScriptLanguage.UXPSCRIPT, [], id.UndoModes.AUTO_UNDO, `ticks ${order}`);
    out[order] = r;
  }
  return out;
});
