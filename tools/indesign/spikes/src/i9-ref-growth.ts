// Do references from reading many characters accumulate and slow every later edit? Does reading in a
// separate hidden document (closed afterwards) avoid it?
import { app, asArray, id, inNewDocument, type Any } from './lib.ts';

function userText(): Any {
  for (let i = 0; i < app.documents.length; i++) {
    const d = app.documents.item(i);
    if (!String(d.name).startsWith('TestFile')) continue;
    for (let s = 0; s < d.stories.length; s++) {
      const st = d.stories.item(s);
      if (Number(st.characters.length) > 5000 && Number(st.paragraphs.length) === 1) return st.texts.item(0);
    }
  }
  throw new Error('TestFile not open');
}

inNewDocument((doc: Any) => {
  const src = userText();
  const page = doc.pages.item(0);
  const f = page.textFrames.add({ geometricBounds: [0, 0, 20000, 9000] });
  src.duplicate(id.LocationOptions.AT_BEGINNING, f.insertionPoints.item(0));
  const story = f.parentStory;
  const rect = page.rectangles.add({ geometricBounds: [100, 300, 110, 320] });
  const op = (): number => {
    const s = Date.now();
    for (let i = 0; i < 20; i++) rect.geometricBounds = [100 + (i % 2), 300, 110, 320];
    return Date.now() - s;
  };
  const growth: number[] = [op()];
  for (let r = 0; r < 3; r++) {
    asArray(story.characters.everyItem().horizontalOffset);
    growth.push(op());
  }
  // Same reads in a hidden scratch document, closed after each read.
  const viaTemp: number[] = [];
  const doc2 = app.documents.add({ showingWindow: false });
  const before = op();
  for (let r = 0; r < 3; r++) {
    const tmp = app.documents.add({ showingWindow: false });
    const g = tmp.pages.item(0).textFrames.add({ geometricBounds: [0, 0, 20000, 9000] });
    const s0 = Date.now();
    src.duplicate(id.LocationOptions.AT_BEGINNING, g.insertionPoints.item(0));
    const n = asArray(g.parentStory.characters.everyItem().horizontalOffset).length;
    const readMs = Date.now() - s0;
    const c0 = Date.now();
    tmp.close(id.SaveOptions.NO);
    viaTemp.push(op(), readMs, Date.now() - c0, n);
  }
  doc2.close(id.SaveOptions.NO);
  return { growthMsPer20Moves: growth, tempDoc: { before, afterEach: viaTemp } };
});
