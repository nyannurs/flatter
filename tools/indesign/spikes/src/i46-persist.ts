// Unfreeze and Remove after saving, closing and reopening, and after editing (2026-11-19). A story set with Set whole
// story is saved, closed and opened again; a paragraph is added at the start and one deleted in the middle; Remove must
// give every remaining paragraph its own original alignment, composer and tracking back (paragraphs are found by their
// fingerprints, not their numbers). The same file round-trips through IDML: Unfreeze must give the text back. Files go
// to the folder in the app label "flatter-i46-dir" and are closed without saving.
import { DE_TEXT, app, id, inNewDocument, asArray, type Any } from './lib.ts';
import { isFrozen, removeFlatter, setWholeStory, STORY_LABEL, unfreezeFlatter } from '@flatter/indesign-adapter';

const N = 40;
const justified = (k: number) => k % 5 === 0;
const tracked = (k: number) => k % 7 === 0;

inNewDocument(() => {
  const dir = String(app.extractLabel('flatter-i46-dir') || '');
  if (!dir) throw new Error('set the app label flatter-i46-dir');
  const opened: Any[] = [];
  // A document of its own: it is saved, closed and opened again (the wrapper's document stays empty).
  const doc = app.documents.add({ showingWindow: false });
  opened.push(doc);
  try {
    doc.viewPreferences.horizontalMeasurementUnits = id.MeasurementUnits.POINTS;
    doc.viewPreferences.verticalMeasurementUnits = id.MeasurementUnits.POINTS;
    doc.documentPreferences.properties = { pageWidth: 595, pageHeight: 842, facingPages: false, pagesPerDocument: 3 };
    const frames: Any[] = [];
    for (let p = 0; p < 3; p++) {
      const f = doc.pages.item(p).textFrames.add({ geometricBounds: [40, 40, 802, 555] });
      f.textFramePreferences.properties = { textColumnCount: 2, textColumnGutter: 12, insetSpacing: [0, 0, 0, 0] };
      if (frames.length) frames[frames.length - 1].nextTextFrame = f;
      frames.push(f);
    }
    const story = frames[0].parentStory;
    const texts = Array.from({ length: N }, (_, k) => `Absatz ${k + 1}. ${DE_TEXT[k % DE_TEXT.length]}`);
    story.contents = texts.join('\r');
    story.texts.item(0).properties = { appliedFont: 'Minion Pro\tRegular', pointSize: 9, leading: 11.5, appliedLanguage: 'German: 2006 Reform', composer: 'Adobe Paragraph Composer' };
    for (let k = 0; k < N; k++) {
      const para = story.paragraphs.item(k);
      if (justified(k)) para.justification = id.Justification.LEFT_JUSTIFIED;
      if (tracked(k)) para.texts.item(0).tracking = 10;
    }
    const original = String(story.contents);
    const settings = { showBands: false, sense: true, zoneShare: 0.2, bandShare: 0.5, tracking: { enabled: true, mode: 'precise' as const, max: 5 }, wordSpaceShare: 0.25 };
    const whole = setWholeStory(story, settings);

    const indd = `${dir}/i46-persist.indd`;
    const idml = `${dir}/i46-persist.idml`;
    doc.save(indd);
    doc.exportFile(id.ExportFormat.INDESIGN_MARKUP, idml);
    doc.close(id.SaveOptions.NO);

    // Reopen the .indd (hidden), edit, Remove.
    const reopened = app.open(indd, false);
    opened.push(reopened);
    const s2 = asArray(reopened.stories.everyItem().getElements()).find((s: Any) => s.extractLabel(STORY_LABEL)) as Any;
    const frozenAfterReopen = !!s2 && isFrozen(s2);
    s2.insertionPoints.item(0).contents = 'Ein neuer erster Absatz, nach dem Speichern eingefügt.\r';
    // Delete original paragraph 12 (now number 13, index 12).
    s2.paragraphs.item(12).remove();
    const removed = removeFlatter(s2);
    // Every remaining original paragraph k: its own originals back.
    const expectedOriginals = [...Array(N).keys()].filter((k) => k !== 11);
    const paras = s2.paragraphs;
    const wrong: string[] = [];
    expectedOriginals.forEach((k, i) => {
      const para = paras.item(i + 1);
      const just = String(para.justification);
      const wantJust = justified(k) ? 'LEFT_JUSTIFIED' : 'LEFT_ALIGN';
      const tr = Number(para.characters.item(0).tracking);
      const wantTr = tracked(k) ? 10 : 0;
      const composer = String(para.composer);
      if (just !== wantJust || tr !== wantTr || composer !== 'Adobe Paragraph Composer') wrong.push(`¶${k + 1}: ${just} ${tr} ${composer}`);
    });
    const expectedText = ['Ein neuer erster Absatz, nach dem Speichern eingefügt.', ...texts.filter((_, k) => k !== 11)].join('\r');
    const textBack = String(s2.contents) === expectedText;

    // IDML: the record and the condition survive; Unfreeze gives the text back, Remove the originals.
    const fromIdml = app.open(idml, false);
    opened.push(fromIdml);
    const s3 = asArray(fromIdml.stories.everyItem().getElements()).find((s: Any) => s.extractLabel(STORY_LABEL)) as Any;
    const idmlFrozen = !!s3 && isFrozen(s3);
    const idmlUnfrozen = s3 ? unfreezeFlatter(s3) : 0;
    const idmlText = !!s3 && String(s3.contents) === original;
    if (s3) removeFlatter(s3);
    const idmlJust = s3 ? String(s3.paragraphs.item(5).justification) : '';

    const pass = whole.missed === 0 && frozenAfterReopen && removed.paragraphsNotFound === 2 && wrong.length === 0 && textBack &&
      idmlFrozen && idmlUnfrozen === whole.breaks + whole.hyphens && idmlText && idmlJust === 'LEFT_JUSTIFIED';
    return {
      pass,
      whole: { lines: whole.lines, breaks: whole.breaks, hyphens: whole.hyphens, missed: whole.missed },
      reopen: { frozenAfterReopen, removed, wrong: wrong.slice(0, 8), textBack },
      idml: { found: !!s3, idmlFrozen, idmlUnfrozen, idmlText, idmlJust },
    };
  } finally {
    for (const d of opened) {
      try {
        if (d.isValid) d.close(id.SaveOptions.NO);
      } catch {
        /* already closed */
      }
    }
  }
});
