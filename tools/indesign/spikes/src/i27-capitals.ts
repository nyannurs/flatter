// Capitalization (2026-10-27): text in Small Caps or All Caps without ß is set exactly as planned. With ß InDesign
// reserves more room than it draws, so Flatter reports it as content it cannot plan around (no alarm).
import { DE_TEXT, inNewDocument, id, type Any } from './lib.ts';
import { applyFlatter, compatibilityAlarms, removeFlatter } from '@flatter/indesign-adapter';

inNewDocument((doc: Any) => {
  const plain = DE_TEXT.join(' ').replace(/ß/g, 'ss');
  const out: Record<string, string> = {};
  let pass = true;
  for (const cap of ['NORMAL', 'SMALL_CAPS', 'ALL_CAPS', 'CAP_TO_SMALL_CAP', 'OPENTYPE_ALL_SMALL_CAPS']) {
    for (const [name, text] of [['plain', plain], ['with ß', DE_TEXT.join(' ')]] as const) {
      const f = doc.pages.item(0).textFrames.add({ geometricBounds: [40, 40, 760, 300] });
      f.contents = text;
      const story = f.parentStory;
      story.texts.item(0).properties = { appliedFont: 'Minion Pro\tRegular', pointSize: 10, leading: 13, appliedLanguage: 'German: 2006 Reform', capitalization: id.Capitalization[cap] };
      const r = applyFlatter(story, { showBands: false, zoneShare: 0.2, bandShare: 0.5 });
      const flagged = r.paragraphs.some((p) => p.unsupported.some((u) => u.startsWith('ß')));
      const exact = r.linesAsPlanned === r.linesPlanned;
      const synthetic = /^(SMALL_CAPS|ALL_CAPS|CAP_TO_SMALL_CAP)$/.test(cap) && name === 'with ß';
      const ok = synthetic ? flagged && compatibilityAlarms(r).length === 0 : exact && !flagged;
      if (!ok) pass = false;
      out[`${cap} ${name}`] = `${r.linesAsPlanned}/${r.linesPlanned}${flagged ? ' flagged' : ''}${ok ? '' : ' FAIL'}`;
      removeFlatter(story);
      f.remove();
    }
  }
  return { pass, out };
});
