// The designer's history before the alarm 18/53 (2026-10-27), replayed in a throwaway document: Flatter on a wide
// frame at 14/17, duplicate the frame, make the copy 12/15 and narrower, set its language, Apply, slider ticks.
// Text from the story in "flatter-i21-story" (read-only).
import { inPoints, liveUpdate, liveVerify, openSession, setStoryLanguage, type ApplySettings } from '@flatter/indesign-adapter';
import { app, inNewDocument, type Any } from './lib.ts';

inNewDocument((doc: Any) => {
  const [docName, storyId] = String(app.extractLabel('flatter-i21-story') || '').split(':');
  const text = String(app.documents.itemByName(docName).stories.itemByID(Number(storyId)).contents);
  const settings: ApplySettings = { showBands: true, ...JSON.parse(String(app.extractLabel('flatter-i21-settings') || '{}')) };
  const steps: string[] = [];
  const f = inPoints(() => {
    doc.documentPreferences.properties = { pageWidth: 595, pageHeight: 842, facingPages: true, pagesPerDocument: 3 };
    return doc.pages.item(1).textFrames.add({ geometricBounds: [31, 150, 825, 604] });
  });
  f.contents = text;
  const story = f.parentStory;
  story.texts.item(0).properties = { appliedFont: 'Avara\tBold', pointSize: 14, leading: 17, appliedLanguage: 'German: 2006 Reform', tracking: 0 };
  const a = openSession(story, { ...settings, zoneShare: 0.1 });
  liveUpdate(a.live, { ...settings, zoneShare: 0.09, draft: true }, true);
  liveUpdate(a.live, { ...settings, zoneShare: 0.09 }, false);
  const av = liveVerify(a.live);
  steps.push(`original 14/17 wide: ${av.linesAsPlanned}/${av.linesPlanned}`);
  const copyFrame = f.duplicate(doc.pages.item(0));
  const copy = copyFrame.parentStory;
  inPoints(() => { copyFrame.geometricBounds = [31, 181, 825, 401]; });
  copy.texts.item(0).properties = { pointSize: 12, leading: 15 };
  steps.push(`copy tracking values: ${new Set([].concat(copy.textStyleRanges.everyItem().tracking)).size}`);
  setStoryLanguage([copy], 'German: 2006 Reform');
  const b = openSession(copy, { ...settings, zoneShare: 0.1 });
  steps.push(`copy apply 0.1: ${b.report.linesAsPlanned}/${b.report.linesPlanned}`);
  liveUpdate(b.live, { ...settings, zoneShare: 0.09, draft: true }, true);
  liveUpdate(b.live, { ...settings, zoneShare: 0.08, draft: true }, false);
  liveUpdate(b.live, { ...settings, zoneShare: 0.08 }, false);
  const bv = liveVerify(b.live);
  steps.push(`copy ticks to 0.08: ${bv.linesAsPlanned}/${bv.linesPlanned} rounds ${bv.rounds}`);
  return { pass: b.report.linesAsPlanned === b.report.linesPlanned && bv.linesAsPlanned === bv.linesPlanned, steps };
});
