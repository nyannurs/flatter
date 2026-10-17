// After measuring a 12,000-character paragraph in a scratch frame, later operations on that frame are slow
// (removal 11.6 s). Which part of measuring causes it, and what avoids it?
import { app, asArray, id, inNewDocument, type Any } from './lib.ts';

function userPara(doc: Any): Any {
  for (let i = 0; i < app.documents.length; i++) {
    const d = app.documents.item(i);
    if (!String(d.name).startsWith('TestFile')) continue;
    for (let s = 0; s < d.stories.length; s++) {
      const st = d.stories.item(s);
      if (Number(st.characters.length) < 5000 || Number(st.paragraphs.length) !== 1) continue;
      const f1 = doc.pages.item(0).textFrames.add({ geometricBounds: [40, 40, 312, 225] });
      st.texts.item(0).duplicate(id.LocationOptions.AT_BEGINNING, f1.insertionPoints.item(0));
      return f1.parentStory.paragraphs.item(0);
    }
  }
  throw new Error('TestFile not open');
}

inNewDocument((doc: Any) => {
  const para = userPara(doc);
  const page = doc.pages.item(0);
  const right = Number(page.bounds[3]);
  const t: Record<string, Any> = {};
  const time = (k: string, fn: () => unknown) => { const s0 = Date.now(); const r = fn(); t[k] = Date.now() - s0; return r; };
  const variant = (name: string, opts: { wide?: boolean; read?: boolean; ligOff?: boolean; clear?: 'contents' | 'remove-text' }) => {
    const f = page.textFrames.add({ geometricBounds: [0, right + 200, 100, right + 2200], contents: 'x' });
    const story = f.parentStory;
    time(`${name}: duplicate`, () => { story.texts.item(0).contents = ''; para.texts.item(0).duplicate(id.LocationOptions.AT_BEGINNING, story.insertionPoints.item(0)); });
    if (opts.wide) time(`${name}: widen`, () => { f.geometricBounds = [0, right + 200, 20000, right + 9200]; });
    if (opts.read) time(`${name}: read offsets`, () => asArray(story.characters.everyItem().horizontalOffset).length);
    if (opts.ligOff) time(`${name}: ligatures off + read`, () => { story.texts.item(0).ligatures = false; asArray(story.characters.everyItem().horizontalOffset).length; });
    if (opts.clear === 'contents') time(`${name}: clear contents`, () => { story.texts.item(0).contents = ''; });
    if (opts.clear === 'remove-text') time(`${name}: remove text`, () => { story.texts.item(0).remove(); });
    time(`${name}: small op`, () => { story.texts.item(0).contents = 'x x'; f.geometricBounds = [0, right + 200, 100, right + 2200]; asArray(story.characters.everyItem().horizontalOffset); });
    time(`${name}: remove frame`, () => f.remove());
  };
  variant('1 duplicate only', {});
  variant('2 duplicate+wide', { wide: true });
  variant('3 duplicate+wide+read', { wide: true, read: true });
  variant('4 +ligatures off', { wide: true, read: true, ligOff: true });
  variant('5 +clear contents first', { wide: true, read: true, ligOff: true, clear: 'contents' });
  variant('6 +remove text first', { wide: true, read: true, ligOff: true, clear: 'remove-text' });
  return { t };
});
