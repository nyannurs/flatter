// Which InDesign special characters Flatter handles (2026-11-26): one story per character, inserted every few words;
// Preview on the whole story; lines as planned, how the character reads in `contents`, and its measured width.
import { DE_TEXT, asArray, id, inNewDocument, type Any } from './lib.ts';
import { openSession, removeFlatter } from '@flatter/indesign-adapter';

const NAMES = (require('indesign').app.extractLabel('flatter-i52-only') || '').split(',').filter(Boolean).length ? (require('indesign').app.extractLabel('flatter-i52-only') as string).split(',') : ['EM_SPACE', 'EN_SPACE', 'THIN_SPACE', 'HAIR_SPACE', 'SIXTH_SPACE', 'QUARTER_SPACE', 'THIRD_SPACE', 'FIGURE_SPACE', 'PUNCTUATION_SPACE', 'NONBREAKING_SPACE', 'FIXED_WIDTH_NONBREAKING_SPACE', 'FLUSH_SPACE',
  'END_NESTED_STYLE', 'AUTO_PAGE_NUMBER', 'SECTION_MARKER', 'NEXT_PAGE_NUMBER', 'ZERO_WIDTH_NONJOINER', 'ZERO_WIDTH_JOINER', 'DISCRETIONARY_LINE_BREAK', 'INDENT_HERE_TAB', 'RIGHT_INDENT_TAB'];
const REPLACE = (n: string) => n.endsWith('_SPACE');

inNewDocument((doc: Any) => {
  const onPage = Number(require('indesign').app.extractLabel('flatter-i52-page') || '1');
  doc.documentPreferences.properties = { pageWidth: 595, pageHeight: 842, pagesPerDocument: onPage + 2 };
  const out: Record<string, unknown> = {};
  for (const name of NAMES) {
    const f = doc.pages.item(onPage).textFrames.add({ geometricBounds: [60, 60, 700, 300] });
    f.textFramePreferences.properties = { insetSpacing: [0, 0, 0, 0], firstBaselineOffset: id.FirstBaseline.LEADING_OFFSET };
    f.contents = DE_TEXT.slice(0, 2).join('\r');
    const s = f.parentStory;
    s.texts.item(0).properties = { appliedFont: 'Minion Pro\tRegular', pointSize: 9.5, leading: 12.5, appliedLanguage: 'German: 2006 Reform' };
    const t = Array.from(String(s.contents));
    const at: number[] = [];
    let w = 0;
    for (let k = 1; k < t.length; k++) if (t[k - 1] === ' ' && /\p{L}/u.test(t[k]!) && ++w % 5 === 0) at.push(k);
    for (const k of at.reverse()) {
      if (REPLACE(name)) {
        s.characters.item(k - 1).remove();
        s.insertionPoints.item(k - 1).contents = id.SpecialCharacters[name];
      } else s.insertionPoints.item(k).contents = id.SpecialCharacters[name];
    }
    const contents = String(s.contents);
    const k0 = REPLACE(name) ? at[at.length - 1]! - 1 : at[at.length - 1]!;
    const ch = s.characters.item(k0);
    const code = Array.from(contents)[k0]?.codePointAt(0)?.toString(16);
    const width = Number(s.characters.item(k0 + 1).horizontalOffset) - Number(ch.horizontalOffset);
    let live = '';
    let first = '';
    try {
      const { report } = openSession(s, { showBands: false, sense: true, zoneShare: 0.2, bandShare: 0.5 });
      live = `${report.linesAsPlanned}/${report.linesPlanned}`;
      const p = report.paragraphs.find((q) => q.mismatch);
      if (p?.mismatch) {
        const m = p.mismatch;
        const line = p.plan.lines[m.line]!;
        const prev = p.plan.lines[m.line - 1];
        const lines = s.lines;
        const geo = [0, 1, 2].map((q) => ({ y: +Number(lines.item(q).baseline).toFixed(1), x0: +Number(lines.item(q).horizontalOffset).toFixed(1), x1: +Number(lines.item(q).endHorizontalOffset).toFixed(1), t: String(lines.item(q).contents).slice(-10) }));
        const teeth = asArray(doc.layers.itemByName('Flatter (Steuerung)').rectangles.everyItem().getElements()).map((r: Any) => asArray(r.geometricBounds).map((v: Any) => +Number(v).toFixed(1))).filter((b: number[]) => b[0] < 120);
        first = JSON.stringify({ geo, teeth, line: m.line, planned: line.text, prevPlanned: prev?.text, got: m.got?.text, width: +line.width.toFixed(2), steer: +m.planned.steerWidth.toFixed(2), avail: +line.available.toFixed(2), slotStart: m.slotUsed?.startX, gotSlotStart: m.slotGot?.startX, gotWidth: m.got?.width });
      }
      removeFlatter(s);
    } catch (e) {
      live = String(e).slice(0, 120);
    }
    out[name] = { live, code, lengthMatch: Array.from(contents).length === Number(s.characters.length), width: +width.toFixed(2), first };
    f.remove();
  }
  return out;
});
