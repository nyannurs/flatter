/**
 * S6: steering under layout conditions (plan §7.2, §7.8). No hyphenation, to isolate layout effects.
 * Each case plans breaks for one German and one English paragraph, steers with teeth, reads back.
 */
import { solveParagraph } from '@flatter/core';
import { DE_TEXT, EN_TEXT, id, inNewDocument, readLines, textFrame, type Any, type LineInfo } from './lib.ts';
import { measureParagraph } from './measure.ts';

const SIZE = 10;
const LEAD = 13;
const COL = 280;
const GUTTER = 14;
const ROWS = 4; // lines per column / frame in the column and threading cases

interface Case {
  name: string;
  noTeeth?: boolean;
  layer?: { hidden: boolean; suppress: boolean };
  nonprinting?: boolean;
  optical?: boolean;
  columns?: boolean;
  threaded?: boolean;
  baselineGrid?: boolean;
  beneathOnly?: { teethBelow: boolean };
  ignoreWrap?: boolean;
}

const CASES: Case[] = [
  { name: 'no teeth (how often natural breaks match the plan)', noTeeth: true },
  { name: 'control' },
  { name: 'teeth on hidden layer, wrap kept', layer: { hidden: true, suppress: false } },
  { name: 'teeth on hidden layer, wrap suppressed', layer: { hidden: true, suppress: true } },
  { name: 'non-printing teeth', nonprinting: true },
  { name: 'optical margin alignment', optical: true },
  { name: 'two columns', columns: true },
  { name: 'two threaded frames', threaded: true },
  { name: 'aligned to baseline grid', baselineGrid: true },
  { name: '"wrap only affects text beneath", teeth above', beneathOnly: { teethBelow: false } },
  { name: '"wrap only affects text beneath", teeth below', beneathOnly: { teethBelow: true } },
  { name: 'frame set to ignore text wrap', ignoreWrap: true },
];

inNewDocument((doc: Any) => {
  const none = doc.swatches.itemByName('None');
  const layer = doc.layers.add({ name: 'Flatter (Steuerung)' });
  const base = doc.layers.item(doc.layers.length - 1);
  const results: Any[] = [];
  for (const c of CASES) {
    let matched = 0;
    let total = 0;
    const misses: string[] = [];
    const checks: string[] = [];
    for (const [lang, text] of [['German: 2006 Reform', DE_TEXT[0]!], ['English: USA', EN_TEXT[0]!]] as const) {
      const german = lang.startsWith('German');
      const setup = { language: lang, capitalized: german, size: SIZE, leading: LEAD, hyphenation: false };
      const meas = measureParagraph(doc, 1500, text, setup);
      doc.pages.item(0).textFrames.everyItem().remove();
      const plan = solveParagraph(meas.items, { measure: COL, language: german ? 'de' : 'en', epsilon: 0.05 });
      // Geometry: where does line i sit?
      const x0 = 40;
      const y0 = 40;
      const multi = c.columns || c.threaded;
      const pos = (i: number) => {
        const col = multi ? Math.floor(i / ROWS) : 0;
        const row = multi ? i % ROWS : i;
        const x = c.threaded ? x0 + col * (COL + 60) : x0 + col * (COL + GUTTER);
        return { x, baseline: y0 + LEAD * (row + 1) };
      };
      const frames: Any[] = [];
      const h = multi ? LEAD * ROWS + 2 : LEAD * (plan.lines.length + 3);
      if (c.columns) {
        const cols = Math.ceil(plan.lines.length / ROWS);
        const f = textFrame(doc, [y0, x0, y0 + h, x0 + cols * COL + (cols - 1) * GUTTER], text, setup);
        f.textFramePreferences.properties = { textColumnCount: cols, textColumnGutter: GUTTER, textColumnFixedWidth: COL };
        frames.push(f);
      } else if (c.threaded) {
        const n = Math.ceil(plan.lines.length / ROWS);
        for (let k = 0; k < n; k++) {
          const f = k === 0 ? textFrame(doc, [y0, x0, y0 + h, x0 + COL], text, setup) : doc.pages.item(0).textFrames.add({ geometricBounds: [y0, x0 + k * (COL + 60), y0 + h, x0 + k * (COL + 60) + COL] });
          if (k > 0) {
            f.textFramePreferences.properties = { insetSpacing: [0, 0, 0, 0], firstBaselineOffset: id.FirstBaseline.LEADING_OFFSET };
            frames[k - 1].nextTextFrame = f;
          }
          frames.push(f);
        }
      } else {
        frames.push(textFrame(doc, [y0, x0, y0 + h, x0 + COL], text, setup));
      }
      // Keep the text on the bottom layer, so "above" and "below" are unambiguous.
      for (const f of frames) f.itemLayer = base;
      const story = frames[0].parentStory;
      if (c.optical) story.storyPreferences.properties = { opticalMarginAlignment: true, opticalMarginSize: SIZE };
      if (c.baselineGrid) {
        doc.gridPreferences.properties = { baselineStart: y0, baselineDivision: LEAD, baselineGridRelativeOption: id.BaselineGridRelativeOption.TOP_OF_PAGE_OF_BASELINE_GRID_RELATIVE_OPTION };
        story.texts.item(0).alignToBaseline = true;
      }
      // "Text Wrap Only Affects Text Beneath" is textPreferences.zOrderTextWrap in scripting.
      if (c.beneathOnly) doc.textPreferences.zOrderTextWrap = true;
      if (c.ignoreWrap) frames[0].textFramePreferences.ignoreWrap = true;
      if (c.layer) layer.properties = { visible: true, locked: false };
      const teeth: Any[] = [];
      plan.lines.forEach((line, i) => {
        if (line.kind !== 'band' || c.noTeeth) return;
        const p = pos(i);
        const cy = p.baseline - meas.xHeight / 2;
        const props: Any = {
          geometricBounds: [cy - 0.05, p.x + line.steerWidth, cy + 0.05, p.x + COL + 10],
          strokeWeight: 0,
          strokeColor: none,
          fillColor: none,
          itemLayer: c.layer || (c.beneathOnly && !c.beneathOnly.teethBelow) ? layer : base,
          nonprinting: !!c.nonprinting,
        };
        const r = doc.pages.item(0).rectangles.add(props);
        r.textWrapPreferences.properties = { textWrapMode: id.TextWrapModes.BOUNDING_BOX_TEXT_WRAP, textWrapSide: id.TextWrapSideOptions.LEFT_SIDE, textWrapOffset: [0, 0, 0, 0] };
        if (c.beneathOnly?.teethBelow) r.sendToBack();
        teeth.push(r);
      });
      if (c.layer) {
        layer.suppressTextWrapWhenLayerHidden = c.layer.suppress;
        layer.visible = !c.layer.hidden;
        checks.push(`layer visible=${layer.visible} suppress=${layer.suppressTextWrapWhenLayerHidden}`);
      }
      if (c.beneathOnly) checks.push(`zOrderTextWrap=${doc.textPreferences.zOrderTextWrap}; teeth on ${teeth[0]?.itemLayer.name}, text on ${frames[0].itemLayer.name}`);
      if (c.ignoreWrap) checks.push(`ignoreWrap=${frames[0].textFramePreferences.ignoreWrap}`);
      story.recompose();
      const lines: LineInfo[] = readLines(story);
      plan.lines.forEach((line, i) => {
        total++;
        const got = lines[i];
        const plannedLast = meas.charRange[line.endItem - 1]![1] - 1;
        let k = got ? got.last : -1;
        while (got && k > got.first && /^\s$/.test(text[k] ?? '')) k--;
        if (got && k === plannedLast) matched++;
        else if (misses.length < 3) misses.push(`${lang.slice(0, 2)} line ${i + 1}: planned …${text.slice(Math.max(0, plannedLast - 15), plannedLast + 1)} got …${got ? got.text.trim().slice(-16) : '(none)'}`);
      });
      for (const t of teeth) t.remove();
      for (const f of frames) f.remove();
      if (c.beneathOnly) doc.textPreferences.zOrderTextWrap = false;
      layer.properties = { visible: true };
    }
    results.push({ case: c.name, matched, total, misses, checks: [...new Set(checks)] });
  }
  return { results };
});
