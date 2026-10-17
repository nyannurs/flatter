// How many of the report's problems come from the text and the settings, and how many from Flatter?
// Copies the user's story (read-only on their file) at its exact frame sizes and solves it with variants.
import { inPoints, openSession, removeFlatter, type ApplySettings } from '@flatter/indesign-adapter';
import { app, asArray, id, inNewDocument, type Any } from './lib.ts';

function userStory(): Any {
  for (let i = 0; i < app.documents.length; i++) {
    const d = app.documents.item(i);
    if (!String(d.name).startsWith('TestFile')) continue;
    for (let s = 0; s < d.stories.length; s++) {
      const st = d.stories.item(s);
      if (st.extractLabel('flatter')) return st;
    }
  }
  throw new Error('no Flatter story in TestFile');
}

inNewDocument((doc: Any) => {
  const src = userStory();
  const userSettings: ApplySettings = JSON.parse(src.extractLabel('flatter')).settings;
  const sizes = inPoints(() => asArray(src.textContainers).map((f: Any) => { const b = f.geometricBounds.map(Number); return [b[3] - b[1], b[2] - b[0]]; }));
  doc.documentPreferences.pagesPerDocument = sizes.length;
  const copy = (lang?: string): Any => {
    const made = sizes.map(([w, h]: number[], i: number) => doc.pages.item(i).textFrames.add({ geometricBounds: [36, 36, 36 + h, 36 + w] }));
    for (let i = 1; i < made.length; i++) made[i - 1].nextTextFrame = made[i];
    src.texts.item(0).duplicate(id.LocationOptions.AT_BEGINNING, made[0].insertionPoints.item(0));
    const story = made[0].parentStory;
    story.texts.item(0).tracking = 0;
    if (lang) story.texts.item(0).appliedLanguage = lang;
    return { story, made };
  };
  const rows: Any[] = [];
  const run = (name: string, settings: ApplySettings, lang?: string) => {
    const { story, made } = copy(lang);
    const { report } = openSession(story, settings);
    const plan = report.paragraphs[0]!.plan;
    const kinds: Record<string, number> = {};
    const lines = new Set<number>();
    for (const v of plan.violations) {
      if (v.severity === 'info') continue;
      kinds[v.kind] = (kinds[v.kind] ?? 0) + 1;
      if (['band', 'hole', 'contrast'].includes(v.kind)) lines.add(v.line);
    }
    const visible = report.linesPlanned;
    // Problems among the lines that are actually visible in the frames.
    const visibleBad = [...lines].filter((l) => l < visible).length;
    const mm = report.paragraphs[0]!.mismatch;
    rows.push({
      mismatch: mm ? `line ${mm.line}: planned …${mm.planned.text.slice(-14)} hy=${mm.planned.hyphen} got …${mm.got?.text.slice(-14)} hy=${mm.got?.hyphenated}` : undefined,
      measures: [...new Set(plan.lines.map((l: Any) => Math.round(l.available + l.indent)))],
      name, solvedAs: plan.solvedAs, lines: plan.lines.length, visible, asPlanned: `${report.linesAsPlanned}/${report.linesPlanned}`,
      linesWithRhythmProblems: lines.size, visibleWithProblems: visibleBad, kinds, hyphens: plan.stats.hyphens,
      measure: Math.round(plan.params.measure * 10) / 10, Z: Math.round(plan.params.flatterzone * 10) / 10, band: Math.round(plan.params.band * 10) / 10,
    });
    // Remove this variant's teeth before the next copy: left behind, they squeeze the next one.
    removeFlatter(story);
    made.forEach((f: Any) => f.remove());
  };
  const base: ApplySettings = { ...userSettings, showBands: false };
  const de = 'German: 2006 Reform';
  run('your settings, language as in your file', base);
  run('German', base, de);
  run('German + Flatterzone 15 %', { ...base, zoneShare: 0.15 }, de);
  run('German + exact ends (letters ±10, spaces ±25 %)', { ...base, tracking: { enabled: true, mode: 'precise', max: 10 }, wordSpaceShare: 0.25 }, de);
  return { userSettings, sizes, rows };
});
