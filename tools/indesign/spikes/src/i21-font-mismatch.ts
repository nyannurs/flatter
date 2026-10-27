// Why does InDesign set none of the lines as planned for a story (for example one in Avara Bold)? Copies the story
// named by the app label "flatter-i21-story" ("<document name>:<story id>", read-only on that document) into a
// throwaway document, applies Flatter and compares Flatter's widths with InDesign's for the first lines.
import { inPoints, openSession, type ApplySettings } from '@flatter/indesign-adapter';
import { app, asArray, id, inNewDocument, type Any } from './lib.ts';

inNewDocument((doc: Any) => {
  const [docName, storyId] = String(app.extractLabel('flatter-i21-story') || '').split(':');
  const src = app.documents.itemByName(docName).stories.itemByID(Number(storyId));
  const settings: ApplySettings = JSON.parse(String(app.extractLabel('flatter-i21-settings') || '{}'));
  // Same page setup as the source: page size, facing pages, page count, ruler origin, and the frame on the same page
  // at the same place.
  const srcDoc = app.documents.itemByName(docName);
  const srcFrame = src.textContainers[0];
  const setup = inPoints(() => ({
    w: Number(srcDoc.documentPreferences.pageWidth), h: Number(srcDoc.documentPreferences.pageHeight), facing: srcDoc.documentPreferences.facingPages,
    pages: Number(srcDoc.pages.length), origin: srcDoc.viewPreferences.rulerOrigin, page: Number(srcFrame.parentPage.documentOffset), bounds: srcFrame.geometricBounds.map(Number),
  }));
  const sameLayout = app.extractLabel('flatter-i21-layout') !== 'simple';
  let f: Any;
  inPoints(() => {
    if (sameLayout) {
      doc.documentPreferences.properties = { pageWidth: setup.w, pageHeight: setup.h, facingPages: setup.facing, pagesPerDocument: setup.pages };
      doc.viewPreferences.rulerOrigin = setup.origin;
      f = doc.pages.item(setup.page).textFrames.add({ geometricBounds: setup.bounds });
    } else {
      const b = setup.bounds;
      f = doc.pages.item(0).textFrames.add({ geometricBounds: [40, 40, 40 + b[2] - b[0], 40 + b[3] - b[1]] });
    }
  });
  src.texts.item(0).duplicate(id.LocationOptions.AT_BEGINNING, f.insertionPoints.item(0));
  const story = f.parentStory;
  const { live, report } = openSession(story, { showBands: false, ...settings });
  return inPoints(() => {
    const pr = report.paragraphs[0]!;
    const w0: Any = (live.session as Any).work[0];
    const para = story.paragraphs.item(0);
    const lines: Any[] = [];
    let start = 0;
    for (let k = 0; k < 4; k++) {
      const pl = pr.plan.lines[k];
      const ln = para.lines.item(k);
      const chars = ln.characters;
      const n = Number(chars.length);
      let j = n - 1;
      while (j > 0 && /^\s$/.test(String(chars.item(j).contents))) j--;
      const actual = Number(chars.item(j).endHorizontalOffset) - Number(ln.horizontalOffset);
      let model = 0;
      for (let q = start; q <= start + j; q++) model += w0.data.advances[q]!;
      lines.push({ k, got: String(ln.contents).slice(-28), planned: pl && pl.text.slice(-28), plannedWidth: pl && Math.round(pl.width * 100) / 100, steer: pl && Math.round(pl.steerWidth * 100) / 100,
        gotActualWidth: Math.round(actual * 100) / 100, gotModelWidth: Math.round(model * 100) / 100, diff: Math.round((actual - model) * 100) / 100 });
      start += n;
    }
    const c = story.characters.item(0);
    return {
      setup: { ...setup, origin: String(setup.origin), sameLayout, frameBounds: f.geometricBounds.map((v: number) => Math.round(v)), teeth: (() => { const l = doc.layers.itemByName('Flatter (Steuerung)'); return l.isValid ? l.pageItems.everyItem().getElements().slice(0, 2).map((t: Any) => ({ b: t.geometricBounds.map((v: number) => Math.round(v * 10) / 10), page: t.parentPage ? t.parentPage.name : null })) : []; })(), line0x: Number(para.lines.item(0).horizontalOffset) },
      asPlanned: `${report.linesAsPlanned}/${report.linesPlanned}`, rounds: report.rounds, mismatch: pr.mismatch ? { line: pr.mismatch.line, planned: pr.mismatch.planned.text, got: pr.mismatch.got?.text } : undefined,
      font: { name: String(c.appliedFont.name), type: String(c.appliedFont.fontType), status: String(c.appliedFont.status), calt: c.otfContextualAlternate, lig: c.ligatures, kerning: String(c.kerningMethod) },
      measure: Math.round(w0.data.measure * 10) / 10, lines,
    };
  });
});
