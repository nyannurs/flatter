// Start cost of a write chunk (2026-11-26): Set whole story should show progress, so its writes run as several scripts.
// A UXP script text pays about 1.3 s for require('indesign'); an ExtendScript text may start faster. Both write the
// same 300 forced breaks with a condition and 300 tracking ranges in a throwaway three-column story.
import { DE_TEXT, app, id, inNewDocument } from './lib.ts';

const UXP = [
  "const id = require('indesign');",
  "const job = JSON.parse(require('uxp').script.args[0]);",
  'const story = id.app.documents.itemByID(job.doc).stories.itemByID(job.story);',
  'const cond = id.app.documents.itemByID(job.doc).conditions.itemByName("Flatter frozen");',
  'const ips = story.insertionPoints; const chars = story.characters;',
  'for (const k of job.at) { ips.item(k).contents = "\\n"; chars.item(k).applyConditions([cond], true); }',
  'for (const k of job.at) chars.itemByRange(k + 1, k + 20).tracking = 7;',
  "require('uxp').script.setResult('ok');",
].join('\n');

const ES = [
  'var job = eval("(" + app.extractLabel("flatter-job") + ")");',
  'var doc = app.documents.itemByID(job.doc); var story = doc.stories.itemByID(job.story);',
  'var cond = doc.conditions.itemByName("Flatter frozen");',
  'var ips = story.insertionPoints; var chars = story.characters;',
  'for (var i = 0; i < job.at.length; i++) { var k = job.at[i]; ips.item(k).contents = "\\n"; chars.item(k).applyConditions([cond], true); }',
  'for (var i = 0; i < job.at.length; i++) { var k = job.at[i]; chars.itemByRange(k + 1, k + 20).tracking = 7; }',
  '"ok";',
].join('\n');

inNewDocument((doc: any) => {
  doc.documentPreferences.properties = { pageWidth: 595, pageHeight: 842, facingPages: false, pagesPerDocument: 4 };
  const frames: any[] = [];
  for (let p = 0; p < 4; p++) {
    const f = doc.pages.item(p).textFrames.add({ geometricBounds: [40, 40, 802, 555] });
    f.textFramePreferences.properties = { textColumnCount: 3, textColumnGutter: 12 };
    if (frames.length) frames[frames.length - 1].nextTextFrame = f;
    frames.push(f);
  }
  const story = frames[0].parentStory;
  story.contents = Array.from({ length: 60 }, (_, k) => DE_TEXT[k % DE_TEXT.length]).join('\r');
  story.texts.item(0).properties = { appliedFont: 'Minion Pro\tRegular', pointSize: 9, leading: 11.5 };
  if (!doc.conditions.itemByName('Flatter frozen').isValid) doc.conditions.add({ name: 'Flatter frozen' });
  const n = Number(story.characters.length);
  const positions = (offset: number) => Array.from({ length: 300 }, (_, k) => Math.floor(((k + 0.5) * n) / 310) + offset).sort((a, b) => b - a);
  const time = (f: () => unknown) => {
    const t0 = Date.now();
    const r = f();
    return { ms: Date.now() - t0, r: String(r) };
  };
  const empty = time(() => app.doScript("require('indesign'); require('uxp').script.setResult('ok');", id.ScriptLanguage.UXPSCRIPT, [], id.UndoModes.AUTO_UNDO, 'x'));
  const emptyEs = time(() => app.doScript('"ok";', id.ScriptLanguage.JAVASCRIPT, [], id.UndoModes.AUTO_UNDO, 'x'));
  const emptyEs2 = time(() => app.doScript('"ok";', id.ScriptLanguage.JAVASCRIPT, [], id.UndoModes.AUTO_UNDO, 'x'));
  const uxp = time(() => app.doScript(UXP, id.ScriptLanguage.UXPSCRIPT, [JSON.stringify({ doc: doc.id, story: story.id, at: positions(0) })], id.UndoModes.AUTO_UNDO, 'x'));
  app.insertLabel('flatter-job', JSON.stringify({ doc: doc.id, story: story.id, at: positions(3) }));
  const es = time(() => app.doScript(ES, id.ScriptLanguage.JAVASCRIPT, [], id.UndoModes.AUTO_UNDO, 'x'));
  app.insertLabel('flatter-job', JSON.stringify({ doc: doc.id, story: story.id, at: positions(6) }));
  const es2 = time(() => app.doScript(ES, id.ScriptLanguage.JAVASCRIPT, [], id.UndoModes.AUTO_UNDO, 'x'));
  const breaks = Array.from(String(story.contents)).filter((c) => c === '\n').length;
  return { emptyUxp: empty, emptyEs, emptyEs2, uxp, es, es2, breaks };
});
