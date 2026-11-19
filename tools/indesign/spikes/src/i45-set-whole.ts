// Preview on a few paragraphs, then Set whole story (2026-11-19). A long story through facing pages with three
// columns: Apply on four paragraphs only, then the whole story written as fixed line breaks in one go, then Unfreeze
// and Remove must give the text back exactly. App label "flatter-i45-pages" sets the page count (default 8).
import { DE_TEXT, app, id, inNewDocument, asArray, type Any } from './lib.ts';
import { CONTROL_LAYER, isFrozen, openSession, removeFlatter, setWholeStory, unfreezeFlatter } from '@flatter/indesign-adapter';

inNewDocument((doc: Any) => {
  const pages = Number(app.extractLabel('flatter-i45-pages') || '8');
  doc.documentPreferences.properties = { pageWidth: 595, pageHeight: 842, facingPages: true, pagesPerDocument: pages };
  const frames: Any[] = [];
  for (let p = 0; p < pages; p++) {
    const f = doc.pages.item(p).textFrames.add({ geometricBounds: [40, 40, 802, 555] });
    f.textFramePreferences.properties = { textColumnCount: 3, textColumnGutter: 12, insetSpacing: [0, 0, 0, 0] };
    if (frames.length) frames[frames.length - 1].nextTextFrame = f;
    frames.push(f);
  }
  const story = frames[0].parentStory;
  // A centred head every 20 paragraphs: Flatter leaves it alone.
  story.contents = Array.from({ length: pages * 20 }, (_, k) => (k % 20 === 0 ? `Kapitel ${k / 20 + 1}` : DE_TEXT[k % DE_TEXT.length])).join('\r');
  story.texts.item(0).properties = { appliedFont: 'Minion Pro\tRegular', pointSize: 9, leading: 11.5, appliedLanguage: 'German: 2006 Reform' };
  for (let k = 0; k < pages * 20; k += 20) story.paragraphs.item(k).justification = id.Justification.CENTER_ALIGN;
  const original = String(story.contents);
  const settings = { showBands: false, sense: true, zoneShare: 0.2, bandShare: 0.5, tracking: { enabled: true, mode: 'precise' as const, max: 5 }, wordSpaceShare: 0.25 };
  const timed = <T>(f: () => T): [T, number] => {
    const t0 = Date.now();
    const r = f();
    return [r, Date.now() - t0];
  };
  const teeth = () => {
    const layer = doc.layers.itemByName(CONTROL_LAYER);
    return layer.isValid ? Number(layer.pageItems.length) : 0;
  };

  // 1. Preview on paragraphs 2 to 5.
  const [{ report: preview }, previewMs] = timed(() => openSession(story, settings, { paragraphs: { from: 2, to: 5 } }));
  const previewParagraphs = preview.paragraphs.map((p) => p.index);

  // 2. The whole story, frozen.
  const [whole, wholeMs] = timed(() => setWholeStory(story, settings));
  const frozen = isFrozen(story);
  const teethAfter = teeth();
  const text = String(story.contents);
  const forcedBreaks = Array.from(text).filter((c) => c === '\n').length;

  // 3. Unfreeze gives the text back exactly.
  const [removed, unfreezeMs] = timed(() => unfreezeFlatter(story));
  const sameAfterUnfreeze = String(story.contents) === original;

  // 4. Set it again, then Remove: text and tracking as before. How fragmented is the text before that?
  const rangesAfterUnfreeze = Number(story.textStyleRanges.length);
  if (app.extractLabel('flatter-i45-reset') === 'yes') story.texts.item(0).tracking = 0;
  const rangesBeforeAgain = Number(story.textStyleRanges.length);
  const [again, againMs] = timed(() => setWholeStory(story, settings));
  removeFlatter(story);
  const sameAfterRemove = String(story.contents) === original;
  const tracking = [...new Set(asArray(story.textStyleRanges.everyItem().tracking).map(Number))];

  const pass =
    previewParagraphs.length === 4 && previewParagraphs[0] === 2 && previewParagraphs[3] === 5 && preview.linesAsPlanned === preview.linesPlanned &&
    frozen && teethAfter === 0 && whole.missed === 0 && forcedBreaks === whole.breaks && removed === whole.breaks + whole.hyphens &&
    sameAfterUnfreeze && again.missed === 0 && sameAfterRemove && tracking.length === 1 && tracking[0] === 0;
  return {
    pass,
    pages,
    preview: { paragraphs: previewParagraphs, lines: `${preview.linesAsPlanned}/${preview.linesPlanned}`, ms: previewMs },
    whole: { ...whole, wallMs: wholeMs, frozen, teethAfter, forcedBreaks },
    unfreeze: { removed, sameAfterUnfreeze, ms: unfreezeMs, rangesAfter: Number(story.textStyleRanges.length) },
    again: { missed: again.missed, ms: againMs, timings: again.timings, rangesAfterUnfreeze, rangesBeforeAgain },
    remove: { sameAfterRemove, tracking },
  };
});
