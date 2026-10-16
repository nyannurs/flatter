// Phase 3 groundwork: undo grouping, special characters, line geometry across frames and columns.
import { app, asArray, id, inNewDocument, textFrame, type Any } from './lib.ts';

inNewDocument((doc: Any) => {
  const out: Any = {};
  // 1. doScript with a function and ENTIRE_SCRIPT undo.
  const frame = textFrame(doc, [40, 40, 200, 300], 'Eins zwei drei.', {});
  try {
    app.doScript(() => {
      doc.pages.item(0).rectangles.add({ geometricBounds: [300, 40, 310, 100] });
      doc.pages.item(0).rectangles.add({ geometricBounds: [320, 40, 330, 100] });
    }, id.ScriptLanguage.UXPSCRIPT, [], id.UndoModes.ENTIRE_SCRIPT, 'Flatter test');
    const before = doc.rectangles.length;
    doc.undo();
    out.undo = { rectanglesAfterScript: before, afterOneUndo: doc.rectangles.length, undoName: String(doc.undoName ?? '') };
  } catch (e) {
    out.undo = { error: String(e) };
  }
  // 2. Special characters: what do contents look like?
  const story = frame.parentStory;
  story.texts.item(0).contents = 'A\u00a0B\u202fC D';
  story.insertionPoints.item(-1).contents = id.SpecialCharacters.FORCED_LINE_BREAK;
  story.insertionPoints.item(-1).contents = 'E';
  story.insertionPoints.item(-1).contents = id.SpecialCharacters.DISCRETIONARY_HYPHEN;
  story.insertionPoints.item(-1).contents = 'F';
  story.insertionPoints.item(-1).contents = id.SpecialCharacters.NONBREAKING_HYPHEN;
  story.insertionPoints.item(-1).contents = 'G';
  story.insertionPoints.item(-1).contents = id.SpecialCharacters.EM_DASH;
  story.insertionPoints.item(-1).contents = 'H';
  const chars = asArray(story.characters.everyItem().contents);
  out.specialChars = chars.map((c: Any) => (typeof c === 'string' ? JSON.stringify(c) + ' U+' + c.charCodeAt(0).toString(16) : 'enum:' + String(c)));
  out.storyContents = JSON.stringify(story.contents);
  // 3. Line geometry in a 2-column frame and in a threaded frame.
  const f2 = textFrame(doc, [400, 40, 440, 400], 'Ein zwei drei vier fünf sechs sieben acht neun zehn elf zwölf dreizehn vierzehn fünfzehn sechzehn siebzehn achtzehn neunzehn zwanzig', {});
  f2.textFramePreferences.properties = { textColumnCount: 2, textColumnGutter: 12 };
  const lines = f2.parentStory.lines;
  out.columnLines = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines.item(i);
    const ptf = l.parentTextFrames;
    out.columnLines.push({ i, x: +Number(l.horizontalOffset).toFixed(2), baseline: +Number(l.baseline).toFixed(2), frames: ptf.length, frameId: ptf[0]?.id, textColumnIndex: (() => { try { return l.parentTextColumns?.length ?? 'n/a'; } catch (e) { return 'err'; } })() });
  }
  try { out.textColumns = f2.textColumns.length; out.col2Bounds = f2.textColumns.item(1).isValid; } catch (e) { out.textColumns = 'err ' + e; }
  out.frameBounds = f2.geometricBounds;
  out.page = { name: f2.parentPage.name, bounds: f2.parentPage.bounds };
  out.rulerOrigin = String(doc.viewPreferences.rulerOrigin);
  return out;
});
