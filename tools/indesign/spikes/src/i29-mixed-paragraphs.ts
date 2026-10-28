// A long story with several paragraph styles, a paragraph that starts with a forced line break, empty paragraphs
// and one of spaces only (designer's crash in verify, 2026-10-28). Apply must not fail and set the lines as planned.
import { DE_TEXT, inNewDocument, id, type Any } from './lib.ts';
import { applyFlatter, compatibilityAlarms, removeFlatter } from '@flatter/indesign-adapter';

// Progress goes to the file named by the app label "flatter-progress-file" (if set), to find a hang.
const progressFile = String(require('indesign').app.extractLabel('flatter-progress-file') || '');
const fsModule = 'fs'; // UXP's own fs, not bundled
let logged = '';
const log = (m: string) => {
  logged += `${new Date().toISOString()} ${m}\n`;
  if (progressFile) require(fsModule).writeFileSync(progressFile, logged);
};

inNewDocument((doc: Any) => {
  log('start');
  const styles = [
    doc.paragraphStyles.add({ name: 'Head', appliedFont: 'Minion Pro\tBold', pointSize: 16, leading: 19 }),
    doc.paragraphStyles.add({ name: 'Body', appliedFont: 'Minion Pro\tRegular', pointSize: 10, leading: 13 }),
    doc.paragraphStyles.add({ name: 'Small', appliedFont: 'Minion Pro\tItalic', pointSize: 8, leading: 10 }),
  ];
  const paras: [string, number][] = [
    ['Ein Titel über zwei Zeilen, der lang genug ist, um zu brechen', 0],
    [DE_TEXT[0]!, 1],
    ['', 1],
    ['\n' + DE_TEXT[1]!, 1],
    ['   ', 1],
    [DE_TEXT[2]!, 2],
    [DE_TEXT[0]! + '\n\n' + DE_TEXT[1]!, 1],
  ];
  const f = doc.pages.item(0).textFrames.add({ geometricBounds: [40, 40, 800, 300] });
  f.contents = paras.map((p) => p[0]).join('\r');
  const story = f.parentStory;
  story.texts.item(0).appliedLanguage = 'German: 2006 Reform';
  paras.forEach((p, i) => story.paragraphs.item(i).appliedParagraphStyle = styles[p[1]]);
  story.texts.item(0).appliedLanguage = 'German: 2006 Reform';
  log('text set');
  const out: Record<string, string> = {};
  let pass = true;
  for (const [name, settings] of [
    ['aesthetic', { showBands: true }],
    ['aesthetic precise', { showBands: true, tracking: { enabled: true, mode: 'precise' as const, max: 5 }, wordSpaceShare: 0.25 }],
    ['functional', { showBands: true, style: 'functional' as const }],
  ] as const) {
    log(`apply ${name}`);
    try {
      const r = applyFlatter(story, { zoneShare: 0.2, bandShare: 0.5, ...settings });
      const ok = r.linesAsPlanned === r.linesPlanned && compatibilityAlarms(r).length === 0;
      if (!ok) pass = false;
      out[name] = `${r.linesAsPlanned}/${r.linesPlanned}, paragraphs ${r.paragraphs.length}, rounds ${r.rounds}${ok ? '' : ' FAIL ' + JSON.stringify(r.paragraphs.find((p) => p.mismatch)?.mismatch?.planned.text ?? '')}`;
    } catch (e) {
      pass = false;
      out[name] = `error: ${String((e as Error)?.message ?? e)}`;
    }
    log(`done ${name}: ${out[name]}`);
    removeFlatter(story);
  }
  void id;
  return { pass, out };
});
