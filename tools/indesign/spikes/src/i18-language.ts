// The panel's German / English buttons: the language reaches every linked frame, one Undo restores it,
// and applying again afterwards switches the language-dependent settings (capitalised words, Duden).
import { applyFlatter, LANGUAGES, removeFlatter, setStoryLanguage, storyLanguage } from '@flatter/indesign-adapter';
import { asArray, DE_TEXT, inNewDocument, type Any } from './lib.ts';

inNewDocument((doc: Any) => {
  const a = doc.pages.item(0).textFrames.add({ geometricBounds: [40, 40, 160, 260] });
  const b = doc.pages.item(0).textFrames.add({ geometricBounds: [200, 40, 500, 460] });
  a.nextTextFrame = b;
  a.contents = DE_TEXT.join('\r');
  const story = a.parentStory;
  story.texts.item(0).properties = { appliedFont: 'Minion Pro\tRegular', pointSize: 10, leading: 13, appliedLanguage: 'English: USA' };
  const before = storyLanguage(story);
  setStoryLanguage([story], LANGUAGES.de);
  const after = storyLanguage(story);
  // Text in the second frame too.
  const inSecond = String(b.texts.item(0).characters.item(0).appliedLanguage.name);
  doc.undo();
  const undone = storyLanguage(story);
  setStoryLanguage([story], LANGUAGES.de);
  const de = applyFlatter(story, {});
  const capsDe = story.paragraphs.item(0).hyphenateCapitalizedWords;
  const hyphensDe = de.paragraphs.reduce((s, p) => s + p.plan.stats.hyphens, 0);
  setStoryLanguage([story], LANGUAGES.en);
  const en = applyFlatter(story, {});
  const capsEn = story.paragraphs.item(0).hyphenateCapitalizedWords;
  removeFlatter(story);
  const pass =
    before === 'English: USA' && after === LANGUAGES.de && inSecond === LANGUAGES.de && undone === 'English: USA' &&
    capsDe === true && capsEn === false && hyphensDe > 0 &&
    de.linesAsPlanned === de.linesPlanned && en.linesAsPlanned === en.linesPlanned;
  void asArray;
  return { pass, before, after, inSecond, undone, capsDe, capsEn, hyphensDe, de: `${de.linesAsPlanned}/${de.linesPlanned}`, en: `${en.linesAsPlanned}/${en.linesPlanned}` };
});
