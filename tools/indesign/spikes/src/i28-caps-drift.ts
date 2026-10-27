// Small caps: where does InDesign's line differ from Flatter's measured widths? (2026-10-27)
import { DE_TEXT, inNewDocument, id, asArray, type Any } from './lib.ts';
import { openSession } from '@flatter/indesign-adapter';

inNewDocument((doc: Any) => {
  const cap = String(require('indesign').app.extractLabel('flatter-i28-cap') || 'SMALL_CAPS');
  const f = doc.pages.item(0).textFrames.add({ geometricBounds: [40, 40, 760, 300] });
  f.contents = DE_TEXT.join(' ');
  const story = f.parentStory;
  story.texts.item(0).properties = { appliedFont: 'Minion Pro\tRegular', pointSize: 10, leading: 13, appliedLanguage: 'German: 2006 Reform', capitalization: id.Capitalization[cap] };
  const { live, report } = openSession(story, { showBands: false, zoneShare: 0.2, bandShare: 0.5 });
  const pr = report.paragraphs[0]!;
  const w0: Any = (live.session as Any).work[0];
  const para = story.paragraphs.item(0);
  const k = pr.mismatch?.line ?? 0;
  let start = 0;
  for (let q = 0; q < k; q++) start += Number(para.lines.item(q).characters.length);
  const ln = para.lines.item(k);
  const chars = ln.characters;
  const xs = asArray(chars.everyItem().horizontalOffset).map(Number);
  const xe = asArray(chars.everyItem().endHorizontalOffset).map(Number);
  const c = asArray(chars.everyItem().contents).map(String);
  const drift: string[] = [];
  let cum = 0;
  for (let q = 0; q < c.length; q++) {
    const d = xe[q]! - xs[q]! - w0.data.advances[start + q]!;
    cum += d;
    if (Math.abs(d) > 0.02) drift.push(`${c[q]}@${q}:${d.toFixed(2)}`);
  }
  const lineX = Number(ln.horizontalOffset);
  return { pass: !pr.mismatch, asPlanned: `${report.linesAsPlanned}/${report.linesPlanned}`, line: k + 1, planned: pr.mismatch?.planned.text, got: String(ln.contents), lineStartsAt: lineX, firstCharAt: xs[0], lastEnd: xe[c.length - 1], cumDrift: cum.toFixed(2), drift: drift.slice(0, 30) };
});
