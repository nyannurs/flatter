// Shape ↔ Sense (ADR-025) in InDesign: at Sense first no planned line breaks a unit of meaning, and InDesign
// sets every line as planned; at Shape only and Balanced too (2026-10-30).
import { DE_TEXT, inNewDocument, type Any } from './lib.ts';
import { applyFlatter, compatibilityAlarms, removeFlatter } from '@flatter/indesign-adapter';

inNewDocument((doc: Any) => {
  const f = doc.pages.item(0).textFrames.add({ geometricBounds: [40, 40, 800, 280] });
  f.contents = DE_TEXT.join('\r');
  const story = f.parentStory;
  story.texts.item(0).properties = { appliedFont: 'Minion Pro\tRegular', pointSize: 10, leading: 13, appliedLanguage: 'German: 2006 Reform' };
  const out: Record<string, string> = {};
  let pass = true;
  for (const [style, extra] of [
    ['aesthetic', {}],
    ['aesthetic precise', { tracking: { enabled: true, mode: 'precise' as const, max: 5 }, wordSpaceShare: 0.25 }],
    ['functional', { style: 'functional' as const }],
  ] as const) {
    for (const senseBalance of [0, 0.5, 1]) {
      const r = applyFlatter(story, { showBands: false, zoneShare: 0.2, bandShare: 0.5, sense: true, senseBalance, ...extra });
      const senseBreaks = r.paragraphs.reduce((s, p) => s + p.plan.violations.filter((v) => v.kind === 'sense').length, 0);
      const ok = r.linesAsPlanned === r.linesPlanned && compatibilityAlarms(r).length === 0 && (senseBalance < 1 || senseBreaks === 0);
      if (!ok) pass = false;
      out[`${style} ${senseBalance}`] = `${r.linesAsPlanned}/${r.linesPlanned}, sense breaks ${senseBreaks}${ok ? '' : ' FAIL'}`;
      removeFlatter(story);
    }
  }
  return { pass, out };
});
