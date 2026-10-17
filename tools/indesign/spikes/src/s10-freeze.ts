// Spike for Freeze: how do forced line breaks, inserted hyphens, conditions and soft hyphens behave?
import { app, asArray, id, inNewDocument, type Any } from './lib.ts';

inNewDocument((doc: Any) => {
  const f = doc.pages.item(0).textFrames.add({ geometricBounds: [40, 40, 200, 160] });
  f.contents = 'Ein guter Flattersatz entsteht nicht von selbst. Wer Texte linksbündig setzt, über\u00ADlässt den rechten Rand dem Zufall.';
  const story = f.parentStory;
  story.texts.item(0).properties = { appliedFont: 'Minion Pro\tRegular', pointSize: 10, leading: 13, appliedLanguage: 'German: 2006 Reform', hyphenation: true, composer: 'Adobe Single-line Composer' };
  const before = asArray(story.lines.everyItem().contents).map(String);
  // 1) What does story.contents show for a forced line break, and how does a condition apply?
  const ip = story.insertionPoints.item(4);
  ip.contents = id.SpecialCharacters.FORCED_LINE_BREAK;
  const contentsChar = JSON.stringify(String(story.contents).slice(3, 6));
  let cond = doc.conditions.itemByName('Flatter frozen');
  if (!cond.isValid) cond = doc.conditions.add({ name: 'Flatter frozen' });
  story.characters.item(4).applyConditions([cond], true);
  const applied = asArray(story.characters.item(4).appliedConditions).map((c: Any) => c.name);
  const condProps = { visible: cond.visible, indicatorMethod: String(cond.indicatorMethod) };
  story.characters.item(4).remove();
  // 2) Soft hyphen at a line end followed by a forced break: is the hyphen shown?
  const text = String(story.contents);
  const soft = text.indexOf('\u00AD');
  story.insertionPoints.item(soft + 1).contents = id.SpecialCharacters.FORCED_LINE_BREAK;
  const softLine = asArray(story.lines.everyItem().contents).map(String).find((l: string) => l.includes('über'));
  const softEnd = story.lines.everyItem().getElements().map((l: Any) => Number(l.endHorizontalOffset));
  // Width of "über" + soft hyphen line end vs "über" alone: measure the end of the line holding the soft hyphen.
  const lineObj = asArray(story.lines.everyItem().getElements()).find((l: Any) => String(l.contents).includes('über\u00AD'));
  const lastCharEnd = lineObj ? Number(lineObj.characters.item(-2).endHorizontalOffset) : undefined;
  const softCharWidth = lineObj ? Number(lineObj.characters.item(-2).endHorizontalOffset) - Number(lineObj.characters.item(-2).horizontalOffset) : undefined;
  void app; void softEnd;
  return { before, contentsChar, applied, condProps, softLine: JSON.stringify(softLine), lastCharEnd, softCharWidth };
});
