// Slider ticks on a copy of a story from the designer's document (alarm 18/53 after Apply and four Adjust steps,
// 2026-10-27). Copies the story named by "flatter-i21-story" like i21 (same page layout), applies with the
// settings in "flatter-i21-settings" at zoneShare + 0.02, then replays the panel's ticks down to the stored value:
// draft ticks (no word spaces), the full tick, verify.
import { inPoints, liveUpdate, liveVerify, openSession, type ApplySettings } from '@flatter/indesign-adapter';
import { app, id, inNewDocument, type Any } from './lib.ts';

inNewDocument((doc: Any) => {
  const [docName, storyId] = String(app.extractLabel('flatter-i21-story') || '').split(':');
  const srcDoc = app.documents.itemByName(docName);
  const src = srcDoc.stories.itemByID(Number(storyId));
  const settings: ApplySettings = { showBands: false, ...JSON.parse(String(app.extractLabel('flatter-i21-settings') || '{}')) };
  const srcFrame = src.textContainers[0];
  const setup = inPoints(() => ({
    w: Number(srcDoc.documentPreferences.pageWidth), h: Number(srcDoc.documentPreferences.pageHeight), facing: srcDoc.documentPreferences.facingPages,
    pages: Number(srcDoc.pages.length), origin: srcDoc.viewPreferences.rulerOrigin, page: Number(srcFrame.parentPage.documentOffset), bounds: srcFrame.geometricBounds.map(Number),
  }));
  const f = inPoints(() => {
    doc.documentPreferences.properties = { pageWidth: setup.w, pageHeight: setup.h, facingPages: setup.facing, pagesPerDocument: setup.pages };
    doc.viewPreferences.rulerOrigin = setup.origin;
    return doc.pages.item(setup.page).textFrames.add({ geometricBounds: setup.bounds });
  });
  src.texts.item(0).duplicate(id.LocationOptions.AT_BEGINNING, f.insertionPoints.item(0));
  const story = f.parentStory;
  // Optional: the source document's probe cache, and the other frames on the same page (plain copies).
  const extras = String(app.extractLabel('flatter-i25-extras') || '');
  if (extras.includes('probes')) doc.insertLabel('flatter-probe', String(srcDoc.extractLabel('flatter-probe') || ''));
  if (extras.includes('neighbours')) {
    for (const other of srcFrame.parentPage.textFrames.everyItem().getElements() as Any[]) {
      if (other.parentStory.id === src.id) continue;
      const b = inPoints(() => other.geometricBounds.map(Number));
      const nf = inPoints(() => doc.pages.item(setup.page).textFrames.add({ geometricBounds: b }));
      other.parentStory.texts.item(0).duplicate(id.LocationOptions.AT_BEGINNING, nf.insertionPoints.item(0));
    }
  }
  if (app.extractLabel('flatter-i21-keep-tracking') !== 'yes') story.texts.item(0).tracking = 0;
  const z = settings.zoneShare ?? 0.1;
  const steps: string[] = [];
  const { live, report } = openSession(story, { ...settings, zoneShare: z + 0.02 });
  steps.push(`apply ${z + 0.02}: ${report.linesAsPlanned}/${report.linesPlanned}`);
  liveUpdate(live, { ...settings, zoneShare: z + 0.01, draft: true }, true);
  liveUpdate(live, { ...settings, zoneShare: z, draft: true }, false);
  liveUpdate(live, { ...settings, zoneShare: z }, false);
  const r = liveVerify(live);
  steps.push(`ticks to ${z}, verify: ${r.linesAsPlanned}/${r.linesPlanned} rounds ${r.rounds}`);
  const fresh = openSession(story, settings).report;
  steps.push(`fresh apply ${z}: ${fresh.linesAsPlanned}/${fresh.linesPlanned}`);
  return { pass: r.linesAsPlanned === r.linesPlanned, extras, probeLabelLength: String(doc.extractLabel('flatter-probe') || '').length, frames: doc.textFrames.length, steps };
});
