// Stress test (designer's question, 2026-10-30): a long story threaded through frames of different widths and column
// counts, an image with text wrap, four paragraph styles in a fixed order, special characters and every kind of
// break. Measures Apply, a slider tick and the verify after it. App label "flatter-i31-groups" sets the length
// (default 19 groups of 8 paragraphs); progress goes to the file in "flatter-progress-file".
import { DE_TEXT, app, id, inNewDocument, type Any } from './lib.ts';
import { compatibilityAlarms, inPoints, liveUpdate, liveVerify, openSession, removeFlatter } from '@flatter/indesign-adapter';

const progressFile = String(app.extractLabel('flatter-progress-file') || '');
const fsModule = 'fs'; // UXP's own fs, not bundled
let logged = '';
const log = (m: string) => {
  logged += `${new Date().toISOString()} ${m}\n`;
  if (progressFile) require(fsModule).writeFileSync(progressFile, logged);
};
const timed = <T>(f: () => T): [T, number] => {
  const t0 = Date.now();
  const r = f();
  return [r, Date.now() - t0];
};

const SPECIALS = [
  ' Siehe S. 123 und Abb. 4, dazu 10 km Fußweg.',
  ' Dazwischen – ein Gedanke — und noch einer … am Ende.',
  ' Sie sagte: „Das ist ein ‚Zitat‘ im Zitat“ und »so weiter«.',
  ' Die Donau­dampf­schiff­fahrts­gesellschaft fuhr weiter.',
  ' Mehr unter https://www.example.org/​verzeichnis/​ausstellungen/​2026/​staubecken-der-muehle im Netz.',
  ' Schreiben Sie eine E‑Mail an die Max-Planck-Gesellschaft.',
  ' Hier folgt ein erzwungener\nZeilenumbruch mitten im Absatz.',
  ' Eine Tabelle:\tSpalte eins\tSpalte zwei.',
];

inNewDocument((doc: Any) => {
  const groups = Number(app.extractLabel('flatter-i31-groups') || '19');
  log(`start, ${groups} groups`);
  const pagesNeeded = 12 + Math.ceil(groups / 2);
  inPoints(() => {
    doc.documentPreferences.properties = { pageWidth: 595, pageHeight: 842, facingPages: true, pagesPerDocument: pagesNeeded };
    doc.viewPreferences.rulerOrigin = id.RulerOrigin.PAGE_ORIGIN;
  });
  const head = doc.paragraphStyles.add({ name: 'Head', appliedFont: 'Minion Pro\tBold', pointSize: 16, leading: 19, spaceBefore: 12, spaceAfter: 4, justification: id.Justification.CENTER_ALIGN });
  const lead = doc.paragraphStyles.add({ name: 'Lead', appliedFont: 'Minion Pro\tItalic', pointSize: 12, leading: 15, spaceAfter: 6 });
  const body = doc.paragraphStyles.add({ name: 'Body', appliedFont: 'Minion Pro\tRegular', pointSize: 10, leading: 13, firstLineIndent: 10 });
  const small = doc.paragraphStyles.add({ name: 'Small', appliedFont: 'Minion Pro\tRegular', pointSize: 8, leading: 10, spaceBefore: 4 });
  head.nextStyle = lead;
  lead.nextStyle = body;
  body.nextStyle = body;
  // Frames: page, bounds (page origin), columns.
  const frames: Any[] = [];
  inPoints(() => {
    const spec: [number, number[], number][] = [
      [0, [300, 40, 800, 555], 2],
      [1, [40, 40, 800, 320], 1],
      [2, [40, 40, 800, 555], 1],
      [3, [40, 40, 800, 555], 3],
      [4, [40, 40, 800, 555], 3],
      [5, [40, 120, 800, 475], 1],
    ];
    for (let p = 6; p < pagesNeeded; p++) spec.push([p, [40, 40, 800, 555], p % 3 === 0 ? 1 : 2]);
    for (const [page, b, cols] of spec) {
      const f = doc.pages.item(page).textFrames.add({ geometricBounds: b });
      f.textFramePreferences.textColumnCount = cols;
      f.textFramePreferences.textColumnGutter = 12;
      if (frames.length) frames[frames.length - 1].nextTextFrame = f;
      frames.push(f);
    }
    // An image with text wrap in the middle of the wide frame on page 3.
    const img = doc.pages.item(2).rectangles.add({ geometricBounds: [300, 330, 460, 555] });
    img.textWrapPreferences.textWrapMode = id.TextWrapModes.BOUNDING_BOX_TEXT_WRAP;
    img.textWrapPreferences.textWrapOffset = [8, 8, 8, 8];
  });
  const paras: [string, Any][] = [];
  for (let g = 0; g < groups; g++) {
    paras.push([`Kapitel ${g + 1}: Über den Rand und die Zeilen`, head]);
    paras.push(['Ein einleitender Absatz in kursiver Schrift, der etwas länger ist als eine Zeile und den Ton des Kapitels setzt.', lead]);
    for (let k = 0; k < 5; k++) {
      const base = DE_TEXT[(g + k) % DE_TEXT.length]!;
      const text = g === 3 && k === 2 ? Array(12).fill(base).join(' ') : base + SPECIALS[(g * 5 + k) % SPECIALS.length];
      paras.push([text, body]);
    }
    paras.push([`Abb. ${g + 1}: Bildunterschrift in kleiner Schrift, zwei Zeilen lang, damit auch sie einen Rand hat.`, small]);
  }
  const story = frames[0].parentStory;
  story.contents = paras.map((p) => p[0]).join('\r');
  paras.forEach((p, i) => story.paragraphs.item(i).applyParagraphStyle(p[1], true));
  story.texts.item(0).appliedLanguage = 'German: 2006 Reform';
  // Column, frame and page breaks at paragraph ends, and one column break inside a paragraph.
  const breakAt = (pi: number, kind: Any, middle = false) => {
    const para = story.paragraphs.item(pi);
    const ip = middle ? para.insertionPoints.item(Math.floor(Number(para.characters.length) / 2)) : para.insertionPoints.item(-2);
    ip.contents = kind;
  };
  const at = (share: number) => Math.floor(paras.length * share);
  breakAt(at(0.13), id.SpecialCharacters.COLUMN_BREAK);
  breakAt(at(0.3), id.SpecialCharacters.FRAME_BREAK);
  breakAt(at(0.46), id.SpecialCharacters.PAGE_BREAK);
  breakAt(at(0.63), id.SpecialCharacters.COLUMN_BREAK, true);
  const chars = Number(story.characters.length);
  log(`breaks after paragraphs ${[0.13, 0.3, 0.46, 0.63].map(at).join(', ')} (column, frame, page, column inside)`);
  log(`text set: ${paras.length} paragraphs, ${chars} characters, ${frames.length} frames, overset ${story.overflows}`);

  const settings = { showBands: true, sense: true, zoneShare: 0.15, bandShare: 0.6, tracking: { enabled: true, mode: 'precise' as const, max: 5 }, wordSpaceShare: 0.25 };
  log('apply');
  const [{ live, report }, applyMs] = timed(() => openSession(story, settings));
  const headAlign = String(story.paragraphs.item(0).justification);
  log(`applied in ${applyMs} ms: ${report.linesAsPlanned}/${report.linesPlanned}`);
  const where = (m: Any) => (m.slotGot ? `page ${m.slotGot.page + 1} col ${Math.round(m.slotGot.columnLeft)}-${Math.round(m.slotGot.columnRight)} y ${Math.round(m.slotGot.baseline)}` : 'no slot');
  const mismatches = report.paragraphs.filter((p) => p.mismatch).map((p) => ({ p: p.index, line: p.mismatch!.line, where: where(p.mismatch), planned: p.mismatch!.planned.text.slice(-24), got: p.mismatch!.got?.text.slice(-24) }));
  const unsupported = report.paragraphs.filter((p) => p.unsupported.length).map((p) => `¶${p.index + 1}: ${p.unsupported.join(', ')}`);
  log('tick');
  const [, draftMs] = timed(() => liveUpdate(live, { ...settings, zoneShare: 0.14, draft: true }, true));
  const [, fullMs] = timed(() => liveUpdate(live, { ...settings, zoneShare: 0.14 }, false));
  log('verify');
  const [verified, verifyMs] = timed(() => liveVerify(live));
  log(`verified in ${verifyMs} ms: ${verified.linesAsPlanned}/${verified.linesPlanned}`);
  const vMismatches = verified.paragraphs.filter((p) => p.mismatch).map((p) => ({ p: p.index, line: p.mismatch!.line, where: where(p.mismatch), planned: p.mismatch!.planned.text.slice(-24), got: p.mismatch!.got?.text.slice(-24) }));
  const [, removeMs] = timed(() => removeFlatter(story));
  const headAlignAfter = String(story.paragraphs.item(0).justification);
  log('done');
  return {
    pass: verified.linesAsPlanned === verified.linesPlanned,
    size: { paragraphs: paras.length, chars, frames: frames.length, oversetLinesPlanned: report.oversetLines },
    applyMs, timings: report.timings, probes: report.probes, rounds: report.rounds,
    apply: `${report.linesAsPlanned}/${report.linesPlanned}`, alarms: compatibilityAlarms(report),
    tick: { draftMs, fullMs, verifyMs, verified: `${verified.linesAsPlanned}/${verified.linesPlanned}`, alarms: compatibilityAlarms(verified) },
    removeMs, headingAlignment: { before: 'CENTER_ALIGN (style)', whileApplied: headAlign, afterRemove: headAlignAfter },
    unsupported, mismatches: mismatches.slice(0, 30), mismatchCount: mismatches.length, verifyMismatches: vMismatches.slice(0, 2), verifyMismatchCount: vMismatches.length,
  };
});
