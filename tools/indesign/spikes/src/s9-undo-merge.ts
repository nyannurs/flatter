// Phase 4 groundwork: does UndoModes.AUTO_UNDO merge a script into the previous undo step?
import { app, id, inNewDocument, type Any } from './lib.ts';

inNewDocument((doc: Any) => {
  const add = (y: number) => doc.pages.item(0).rectangles.add({ geometricBounds: [y, 10, y + 5, 20] });
  app.doScript(() => add(10), id.ScriptLanguage.UXPSCRIPT, [], id.UndoModes.ENTIRE_SCRIPT, 'Flatter: Adjust');
  app.doScript(() => add(20), id.ScriptLanguage.UXPSCRIPT, [], id.UndoModes.AUTO_UNDO, 'tick');
  app.doScript(() => add(30), id.ScriptLanguage.UXPSCRIPT, [], id.UndoModes.AUTO_UNDO, 'tick');
  const after = doc.rectangles.length;
  const undoName = String(doc.undoName);
  doc.undo();
  const afterOneUndo = doc.rectangles.length;
  return { after, undoName, afterOneUndo, modes: Object.keys(id.UndoModes ?? {}) };
});
