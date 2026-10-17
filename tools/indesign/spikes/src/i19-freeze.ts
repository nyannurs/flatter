// Freeze and Unfreeze (plan §6.6): the frozen story keeps exactly its lines without teeth; Unfreeze and
// Remove give the original text back; Undo works; a frozen story refuses Apply.
import { applyFlatter, freezeFlatter, isFrozen, removeFlatter, unfreezeFlatter } from '@flatter/indesign-adapter';
import { asArray, DE_TEXT, inNewDocument, type Any } from './lib.ts';

const linesOf = (story: Any): string[] => asArray(story.textContainers).flatMap((f: Any) => (f.lines.length ? asArray(f.lines.everyItem().contents).map(String) : []));
// A line's visible text without what Freeze adds (the forced break, the hyphen it inserted, trailing spaces).
const norm = (l: string) => l.replace(/\n$/, '').replace(/[ \u00AD]+$/, '').replace(/-$/, '');
const teethOf = (doc: Any, story: Any) => {
  const layer = doc.layers.itemByName('Flatter (Steuerung)');
  if (!layer.isValid) return 0;
  return asArray(layer.pageItems.everyItem().getElements()).filter((it: Any) => it.extractLabel('flatter-tooth') === String(story.id)).length;
};

inNewDocument((doc: Any) => {
  const a = doc.pages.item(0).textFrames.add({ geometricBounds: [40, 40, 200, 250] });
  const b = doc.pages.item(0).textFrames.add({ geometricBounds: [240, 40, 520, 420] });
  a.nextTextFrame = b;
  a.contents = [...DE_TEXT, ...DE_TEXT].join('\r');
  const story = a.parentStory;
  story.texts.item(0).properties = { appliedFont: 'Minion Pro\tRegular', pointSize: 10, leading: 13, appliedLanguage: 'German: 2006 Reform' };
  const original = String(story.contents);
  const r = applyFlatter(story, { showBands: true, tracking: { enabled: true, mode: 'precise', max: 10 }, wordSpaceShare: 0.25 });
  const applied = linesOf(story);
  const beforeFreeze = String(story.contents);
  const f = freezeFlatter(story);
  const frozenLines = linesOf(story);
  const sameLines = frozenLines.length === applied.length && frozenLines.every((l, i) => norm(l) === norm(applied[i]!));
  const firstDiff = frozenLines.findIndex((l, i) => norm(l) !== norm(applied[i] ?? ''));
  const teethFrozen = teethOf(doc, story);
  let refused = '';
  try { applyFlatter(story, {}); } catch (e) { refused = String((e as Error).message); }
  // Undo the freeze, then freeze again.
  doc.undo();
  const undoRestored = String(story.contents) === beforeFreeze && !isFrozen(story) && teethOf(doc, story) > 0;
  freezeFlatter(story);
  const removedChars = unfreezeFlatter(story);
  const textBack = String(story.contents) === original;
  const again = applyFlatter(story, { showBands: true });
  freezeFlatter(story);
  removeFlatter(story);
  const removeBack = String(story.contents) === original && !isFrozen(story) && teethOf(doc, story) === 0;
  const pass =
    r.linesAsPlanned === r.linesPlanned && f.breaks > 0 && f.hyphens > 0 && sameLines && teethFrozen === 0 && refused.includes('frozen') &&
    undoRestored && removedChars === f.breaks + f.hyphens && textBack && again.linesAsPlanned === again.linesPlanned && removeBack;
  return {
    pass, applied: `${r.linesAsPlanned}/${r.linesPlanned}`, freeze: f, sameLines, firstDiff,
    diff: firstDiff >= 0 ? [JSON.stringify(applied[firstDiff]), JSON.stringify(frozenLines[firstDiff])] : undefined,
    teethFrozen, refused, undoRestored, removedChars, textBack, again: `${again.linesAsPlanned}/${again.linesPlanned}`, removeBack,
  };
});
