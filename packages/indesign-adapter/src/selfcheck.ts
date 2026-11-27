/**
 * Self-check: does this InDesign still behave the way Flatter relies on? Runs the whole chain on a known
 * German paragraph in a hidden document that is closed afterwards. The panel runs it once after every
 * InDesign or Flatter update and shows the compatibility alarm when a check fails.
 */
import { compatibilityAlarms } from './apply.ts';
import { applyFlatter, freezeFlatter, inPoints, isFrozen, removeFlatter, setWholeStory, unfreezeFlatter } from './dom.ts';
import { asArray, indesign, localNames, type Any } from './dom-port.ts';

export interface SelfCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SelfCheckResult {
  ok: boolean;
  indesign: string;
  checks: SelfCheck[];
  ms: number;
}

/** German text with many long words, typed hyphens and numbers: exercises measuring, probing and steering. */
export const SELF_CHECK_TEXT = [
  'Ein guter Flattersatz entsteht nicht von selbst. Wer Texte linksbündig setzt, überlässt den rechten Rand scheinbar dem Zufall, doch gerade dieser Rand bestimmt, ob eine Seite ruhig oder unruhig wirkt.',
  'In der Wachstube des alten Rathauses lagen die Druckerzeugnisse der vergangenen Woche auf einem Stapel: Flugblätter, Programmhefte und ein dünnes Verzeichnis der Ausstellungen im Staubecken der ehemaligen Mühle.',
  'Die Rechtschreibreform von 2006 hat das Trennen in einigen Punkten vereinfacht. Bei Zusammensetzungen wie Schifffahrt bleiben alle drei Konsonanten erhalten, und die E-Mail-Adresse der Max-Planck-Gesellschaft wird am Bindestrich getrennt.',
].join('\r');

export function selfCheck(): SelfCheckResult {
  const id = indesign();
  const app = id.app;
  const t0 = Date.now();
  const checks: SelfCheck[] = [];
  const check = (name: string, fn: () => string | true) => {
    try {
      const r = fn();
      checks.push({ name, ok: r === true, detail: r === true ? 'ok' : r });
    } catch (e) {
      checks.push({ name, ok: false, detail: `error: ${String((e as Error)?.message ?? e)}` });
    }
  };
  const unitBefore = String(app.scriptPreferences.measurementUnit);
  check('Scripting interface', () => {
    const missing = [
      ['app.doScript', typeof app.doScript === 'function'],
      ['UndoModes', !!id.UndoModes?.ENTIRE_SCRIPT && !!id.UndoModes?.AUTO_UNDO],
      ['ScriptLanguage.UXPSCRIPT', !!id.ScriptLanguage?.UXPSCRIPT],
      ['SpecialCharacters.FORCED_LINE_BREAK', !!id.SpecialCharacters?.FORCED_LINE_BREAK],
      ['TextWrapModes', !!id.TextWrapModes?.BOUNDING_BOX_TEXT_WRAP],
      ['MeasurementUnits.POINTS', !!id.MeasurementUnits?.POINTS],
    ].filter(([, ok]) => !ok).map(([n]) => n);
    return missing.length ? `missing: ${missing.join(', ')}` : true;
  });
  let doc: Any;
  try {
    doc = app.documents.add({ showingWindow: false });
    inPoints(() => {
      doc.documentPreferences.properties = { facingPages: false, pageWidth: 600, pageHeight: 900 };
    });
    const frame = inPoints(() => doc.pages.item(0).textFrames.add({ geometricBounds: [40, 40, 860, 290] }));
    frame.contents = SELF_CHECK_TEXT;
    const story = frame.parentStory;
    story.texts.item(0).properties = { appliedFont: 'Minion Pro\tRegular', pointSize: 10, leading: 13, appliedLanguage: localNames().german, tracking: 0 };
    const original = String(story.contents);
    let plain: Any;
    check('Lines set where Flatter steers them', () => {
      plain = applyFlatter(story, { showBands: true });
      if (plain.linesPlanned < 5) return `only ${plain.linesPlanned} lines`;
      return plain.linesAsPlanned === plain.linesPlanned ? true : `${plain.linesAsPlanned} of ${plain.linesPlanned} lines as planned`;
    });
    check('Hyphenation points from InDesign', () => {
      if (!plain) return 'no result';
      const { checked, empty } = plain.probeCheck;
      if (checked < 5) return `only ${checked} words checked`;
      return empty / checked < 0.5 ? true : `InDesign gave no points for ${empty} of ${checked} words`;
    });
    check('Exact line ends (tracking and word spaces)', () => {
      const r = applyFlatter(story, { tracking: { enabled: true, mode: 'precise', max: 10 }, wordSpaceShare: 0.25 });
      if (r.linesAsPlanned !== r.linesPlanned) return `${r.linesAsPlanned} of ${r.linesPlanned} lines as planned`;
      return r.trackedLines + r.spacedLines > 0 ? true : 'no line was tracked';
    });
    check('No compatibility alarms', () => {
      // No result to look at is not a pass (2026-11-26).
      if (!plain) return 'no result';
      const alarms = compatibilityAlarms(plain);
      return alarms.length ? alarms.join(' ') : true;
    });
    check('Freeze and Unfreeze', () => {
      const before = asArray(story.lines.everyItem().contents).length;
      const f = freezeFlatter(story);
      const after = asArray(story.lines.everyItem().contents).length;
      const removed = unfreezeFlatter(story);
      if (after !== before) return `frozen story has ${after} lines instead of ${before}`;
      if (removed !== f.breaks + f.hyphens) return `Unfreeze removed ${removed} of ${f.breaks + f.hyphens} characters`;
      return true;
    });
    check('Set whole story (frozen in one go)', () => {
      // The script InDesign runs to completion: forced breaks with the Freeze condition at every planned line end, then
      // the planned tracking (ADR-032). Every line must end where planned, and Unfreeze must give the text back.
      const r = setWholeStory(story, { tracking: { enabled: true, mode: 'precise', max: 10 }, wordSpaceShare: 0.25 });
      if (r.lines < 5) return `only ${r.lines} lines`;
      if (r.missed) return `${r.missed} of ${r.lines} lines broke before their planned end`;
      if (!r.breaks) return 'no line break was written';
      if (!isFrozen(story)) return 'the story is not marked frozen';
      const removed = unfreezeFlatter(story);
      if (removed !== r.breaks + r.hyphens) return `Unfreeze removed ${removed} of ${r.breaks + r.hyphens} characters`;
      return String(story.contents) === original ? true : 'text differs after Unfreeze';
    });
    check('Remove restores the text', () => {
      removeFlatter(story);
      if (String(story.contents) !== original) return 'text differs after Remove';
      const tracking = [...new Set(asArray(story.textStyleRanges.everyItem().tracking).map(Number))];
      return tracking.length === 1 && tracking[0] === 0 ? true : `tracking left: ${tracking.join(', ')}`;
    });
  } catch (e) {
    checks.push({ name: 'Test document', ok: false, detail: `error: ${String((e as Error)?.message ?? e)}` });
  } finally {
    try {
      doc?.close(id.SaveOptions.NO);
    } catch {
      /* already closed */
    }
  }
  check('Measurement units restored', () => (String(app.scriptPreferences.measurementUnit) === unitBefore ? true : `now ${String(app.scriptPreferences.measurementUnit)}`));
  return { ok: checks.every((c) => c.ok), indesign: String(app.version), checks, ms: Date.now() - t0 };
}
