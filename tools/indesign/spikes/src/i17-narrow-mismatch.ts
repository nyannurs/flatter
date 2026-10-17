// At a narrow measure, why does InDesign break earlier than planned? Compare model and InDesign widths
// for the first mismatching line, and look at the tooth there.
import { inPoints, openSession, type ApplySettings } from '@flatter/indesign-adapter';
import { app, asArray, id, inNewDocument, type Any } from './lib.ts';

inNewDocument((doc: Any) => {
  let src: Any;
  for (let i = 0; i < app.documents.length; i++) {
    const d = app.documents.item(i);
    if (!String(d.name).startsWith('TestFile')) continue;
    for (let s = 0; s < d.stories.length; s++) if (d.stories.item(s).extractLabel('flatter')) src = d.stories.item(s);
  }
  const user: ApplySettings = JSON.parse(src.extractLabel('flatter')).settings;
  const variant = String(app.extractLabel('flatter-i17') || 'de');
  const settings: ApplySettings = { ...user, showBands: false, ...(variant === 'exact' ? { tracking: { enabled: true, mode: 'precise', max: 10 }, wordSpaceShare: 0.25 } : {}) };
  const sizes = inPoints(() => asArray(src.textContainers).map((f: Any) => { const b = f.geometricBounds.map(Number); return [b[3] - b[1], b[2] - b[0]]; }));
  doc.documentPreferences.pagesPerDocument = sizes.length;
  const made = sizes.map(([w, h]: number[], i: number) => doc.pages.item(i).textFrames.add({ geometricBounds: [36, 36, 36 + h, 36 + w] }));
  for (let i = 1; i < made.length; i++) made[i - 1].nextTextFrame = made[i];
  src.texts.item(0).duplicate(id.LocationOptions.AT_BEGINNING, made[0].insertionPoints.item(0));
  const story = made[0].parentStory;
  story.texts.item(0).tracking = 0;
  if (variant === 'de') story.texts.item(0).appliedLanguage = 'German: 2006 Reform';
  const { live, report } = openSession(story, settings);
  return inPoints(() => {
    const pr = report.paragraphs[0]!;
    const m = pr.mismatch;
    if (!m) return { asPlanned: `${report.linesAsPlanned}/${report.linesPlanned}`, note: 'no mismatch' };
    const w: Any = (live.session as Any).work[0];
    const k = m.line;
    const pl = pr.plan.lines[k]!;
    const para = story.paragraphs.item(0);
    const ln = para.lines.item(k);
    const lnChars = ln.characters;
    const n = Number(lnChars.length);
    const start = Number(lnChars.item(0).index) - Number(para.index);
    let j = n - 1;
    while (j > 0 && /^\s$/.test(String(lnChars.item(j).contents))) j--;
    const actualEnd = Number(lnChars.item(j).endHorizontalOffset);
    const x0 = Number(ln.horizontalOffset);
    const gotLast = start + j;
    const adv = w.data.advances as number[];
    let model = 0;
    for (let q = start; q <= gotLast; q++) model += adv[q]!;
    const tracks = asArray(lnChars.everyItem().tracking).map(Number);
    let trackSum = 0;
    for (let q = 0; q < j; q++) trackSum += tracks[q]! * 12 / 1000;
    // Teeth near this line
    const slot = m.slotGot ?? m.slotUsed;
    const teeth: string[] = [];
    for (const it of asArray(doc.layers.itemByName('Flatter (Steuerung)').pageItems.everyItem().getElements())) {
      const b = it.geometricBounds.map(Number);
      const pg = it.parentPage ? Number(it.parentPage.documentOffset) : -1;
      if (pg === slot.page && b[0] <= slot.baseline + 2 && b[2] >= slot.baseline - 14) teeth.push(`${b[0].toFixed(2)}–${b[2].toFixed(2)} x ${b[1].toFixed(2)}–${b[3].toFixed(2)}`);
    }
    const prev = pr.plan.lines[k - 1];
    return {
      asPlanned: `${report.linesAsPlanned}/${report.linesPlanned}`, line: k,
      planned: { text: pl.text, width: pl.width, ink: pl.inkWidth, steer: pl.steerWidth, slack: pl.slack, tracking: pl.tracking, wordSpace: pl.wordSpace, hyphen: pl.endsWithHyphen, role: pl.role, prevEndsWithHyphen: prev?.endsWithHyphen },
      got: { text: String(ln.contents), startX: x0, actualWidth: actualEnd - x0, modelWidth: model + trackSum, hyphenated: m.got?.hyphenated },
      slot: { baseline: slot.baseline, startX: slot.startX, columnRight: slot.columnRight },
      toothLeftMinusStart: teeth,
      lineAbove: String(para.lines.item(k - 1).contents).slice(-30),
    };
  });
});
