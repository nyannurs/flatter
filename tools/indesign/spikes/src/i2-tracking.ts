// Integration: does the tracking rescue (ADR-010) steer correctly in InDesign? Scan measures until tracked lines occur.
import { applyFlatter, removeFlatter } from '@flatter/indesign-adapter';
import { asArray, DE_TEXT, EN_TEXT, inNewDocument, type Any } from './lib.ts';

inNewDocument((doc: Any) => {
  const rows: Any[] = [];
  let trackedTotal = 0;
  let trackedSteered = 0;
  for (const [lang, texts] of [['German: 2006 Reform', DE_TEXT], ['English: USA', EN_TEXT]] as const) {
    for (let width = 250; width <= 340; width += 6) {
      const f = doc.pages.item(0).textFrames.add({ geometricBounds: [40, 40, 600, 40 + width] });
      f.contents = texts.join('\r');
      const all = f.parentStory.texts.item(0);
      all.properties = { appliedFont: 'Minion Pro\tRegular', pointSize: 10, leading: 13, appliedLanguage: lang };
      const story = f.parentStory;
      const plain = applyFlatter(story, {});
      const r = applyFlatter(story, { tracking: { enabled: true, max: 5 } });
      const lines = r.paragraphs.flatMap((p) => p.plan.lines.map((l, i) => ({ p, l, i })));
      const tracked = lines.filter((x) => x.l.tracking !== 0);
      const steeredTracked = tracked.filter((x) => x.p.steered || (x.p.mismatch ? x.i < x.p.mismatch.line : true)).length;
      trackedTotal += tracked.length;
      trackedSteered += steeredTracked;
      const trackingValues = asArray(story.characters.everyItem().tracking).map(Number);
      rows.push({
        lang: lang.slice(0, 7),
        width,
        strictWithout: plain.paragraphs.filter((p) => p.plan.feasible).length,
        strictWith: r.paragraphs.filter((p) => p.plan.feasible).length,
        tracked: tracked.map((x) => x.l.tracking),
        lines: `${r.linesAsPlanned}/${r.linesPlanned}`,
        trackingInDoc: [...new Set(trackingValues)],
      });
      removeFlatter(story);
      f.remove();
    }
  }
  const allLines = rows.every((r) => r.lines.split('/')[0] === r.lines.split('/')[1]);
  return { pass: trackedTotal > 0 && trackedSteered === trackedTotal && allLines, trackedTotal, trackedSteered, rows: rows.filter((r) => r.tracked.length || r.lines.split('/')[0] !== r.lines.split('/')[1]) };
});
