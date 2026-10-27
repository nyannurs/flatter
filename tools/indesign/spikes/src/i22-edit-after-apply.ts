// Editing a story after Apply (designer's report, 2026-10-27): the live session must notice and measure again,
// as the panel does, instead of planning with the old text (then every line fails and the alarm fires).
import { DE_TEXT, inNewDocument, type Any } from './lib.ts';
import { compatibilityAlarms, liveIsStale, liveUpdate, liveVerify, openSession } from '@flatter/indesign-adapter';

inNewDocument((doc: Any) => {
  const f = doc.pages.item(0).textFrames.add({ geometricBounds: [40, 40, 600, 400] });
  f.contents = 'Avara Bold 14/16 ' + DE_TEXT.join(' ');
  const story = f.parentStory;
  story.texts.item(0).properties = { appliedFont: 'Minion Pro\tRegular', pointSize: 12, leading: 14.4, appliedLanguage: 'German: 2006 Reform' };
  const settings = { showBands: false, zoneShare: 0.2, bandShare: 0.5, tracking: { enabled: true, mode: 'precise' as const, max: 5 }, wordSpaceShare: 0.25 };
  let { live } = openSession(story, settings);
  // Slider ticks write tracking: that is Flatter's own change, not an edit.
  liveUpdate(live, { ...settings, zoneShare: 0.19 }, true);
  liveVerify(live);
  const staleAfterTicks = liveIsStale(live);
  // The designer deletes the heading at the start of the paragraph.
  story.characters.itemByRange(0, 16).remove();
  const staleAfterEdit = liveIsStale(live);
  // What the old session would do (the bug) and what the panel does now (measure again).
  liveUpdate(live, { ...settings, zoneShare: 0.18 }, false);
  const oldWay = liveVerify(live);
  ({ live } = openSession(story, { ...settings, zoneShare: 0.18 }));
  const newWay = liveVerify(live);
  // A change of type size is noticed too.
  story.texts.item(0).pointSize = 11;
  const staleAfterSize = liveIsStale(live);
  const pass = !staleAfterTicks && staleAfterEdit && staleAfterSize && newWay.linesAsPlanned === newWay.linesPlanned && compatibilityAlarms(newWay).length === 0;
  return {
    pass, staleAfterTicks, staleAfterEdit, staleAfterSize,
    oldWay: `${oldWay.linesAsPlanned}/${oldWay.linesPlanned}`, newWay: `${newWay.linesAsPlanned}/${newWay.linesPlanned}`,
  };
});
