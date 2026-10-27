// A frame duplicated from a Flatter story (designer's report, 2026-10-27): the copy carries Flatter's tracking
// but not its record. Apply on the copy must measure without that tracking, or lines miss their plan
// (22 of 46 as planned) until Recompute.
import { DE_TEXT, inNewDocument, type Any } from './lib.ts';
import { applyFlatter, compatibilityAlarms, removeFlatter } from '@flatter/indesign-adapter';

inNewDocument((doc: Any) => {
  const f = doc.pages.item(0).textFrames.add({ geometricBounds: [40, 40, 800, 260] });
  f.contents = DE_TEXT.join(' ');
  const story = f.parentStory;
  story.texts.item(0).properties = { appliedFont: 'Minion Pro\tRegular', pointSize: 12, leading: 14.4, appliedLanguage: 'German: 2006 Reform', tracking: 0 };
  const settings = { showBands: false, zoneShare: 0.1, bandShare: 0.9, tracking: { enabled: true, mode: 'precise' as const, max: 5 }, wordSpaceShare: 0.25 };
  const first = applyFlatter(story, settings);
  const copy = f.duplicate(doc.pages.add()).parentStory;
  const leftover = [...new Set([].concat(copy.textStyleRanges.everyItem().tracking).map(Number))].length;
  const second = applyFlatter(copy, settings);
  removeFlatter(copy);
  const after = [...new Set([].concat(copy.textStyleRanges.everyItem().tracking).map(Number))];
  const pass = leftover > 1 && second.linesAsPlanned === second.linesPlanned && compatibilityAlarms(second).length === 0 && after.length === 1 && after[0] === 0;
  return {
    pass, leftoverTrackingValues: leftover, trackingAfterRemove: after,
    original: `${first.linesAsPlanned}/${first.linesPlanned}`, copy: `${second.linesAsPlanned}/${second.linesPlanned}`,
  };
});
