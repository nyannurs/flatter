// Redo after undoing merged steps (2026-11-26): one ENTIRE_SCRIPT step, then steps merged into it with AUTO_UNDO
// (ExtendScript text, UXP script text, UXP function). After undo and redo, which parts come back?
import { app, id, inNewDocument } from './lib.ts';

inNewDocument((doc: any) => {
  const frame = doc.pages.item(0).textFrames.add({ geometricBounds: [40, 40, 400, 400] });
  const story = frame.parentStory;
  story.contents = 'x';
  const sid = story.id;
  const out: Record<string, string> = {};
  for (const kind of ['es', 'uxp', 'fn']) {
    story.contents = 'x';
    app.doScript(() => { story.insertionPoints.item(-1).contents = 'A'; }, id.ScriptLanguage.UXPSCRIPT, [], id.UndoModes.ENTIRE_SCRIPT, 'Step');
    if (kind === 'es') app.doScript(`app.documents.itemByID(${doc.id}).stories.itemByID(${sid}).insertionPoints.item(-1).contents = 'B';`, id.ScriptLanguage.JAVASCRIPT, [], id.UndoModes.AUTO_UNDO, 'Step');
    if (kind === 'uxp') app.doScript(`require('indesign').app.documents.itemByID(${doc.id}).stories.itemByID(${sid}).insertionPoints.item(-1).contents = 'B';`, id.ScriptLanguage.UXPSCRIPT, [], id.UndoModes.AUTO_UNDO, 'Step');
    if (kind === 'fn') app.doScript(() => { story.insertionPoints.item(-1).contents = 'B'; }, id.ScriptLanguage.UXPSCRIPT, [], id.UndoModes.AUTO_UNDO, 'Step');
    app.doScript(() => { story.insertionPoints.item(-1).contents = 'C'; }, id.ScriptLanguage.UXPSCRIPT, [], id.UndoModes.AUTO_UNDO, 'Step');
    const done = String(story.contents);
    doc.undo();
    const undone = String(story.contents);
    doc.redo();
    out[kind] = `${done} → undo ${undone} → redo ${String(story.contents)}`;
  }
  return out;
});
