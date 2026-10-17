import { modeLabel } from '@flatter/core';
import fontBytes from '@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff';
import deText from '../../../test/fixtures/texts/de.txt';
import enText from '../../../test/fixtures/texts/en.txt';
import { averageCharWidth, fontFromBytes, renderSvg, SIM_LANGUAGES, simulate, splitParagraphs, summarise, type SimLanguage } from '../src/index.ts';

const font = fontFromBytes(fontBytes);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const num = (id: string) => Number($<HTMLInputElement>(id).value);
const checked = (id: string) => $<HTMLInputElement>(id).checked;
const val = (id: string) => $<HTMLSelectElement>(id).value;
const sample = (lang: SimLanguage) => (lang.startsWith('de') ? deText : enText).trim();
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const langSel = $<HTMLSelectElement>('lang');
for (const [k, v] of Object.entries(SIM_LANGUAGES)) langSel.add(new Option(v, k));
const textArea = $<HTMLTextAreaElement>('text');
textArea.value = sample('de');
let textEdited = false;

let queued = false;
function schedule(): void {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    render();
  });
}

function render(): void {
  const lang = val('lang') as SimLanguage;
  const size = num('size');
  const chars = num('chars');
  const text = textArea.value;
  const measure = chars * averageCharWidth(font, size, splitParagraphs(text).join(' '));
  const z = (num('z') / 100) * measure;
  const band = (num('band') / 100) * z;

  $('charsOut').textContent = `${chars} characters · ${measure.toFixed(0)} pt`;
  $('sizeOut').textContent = `${size} pt`;
  $('zOut').textContent = `${num('z').toFixed(1)} % · ${z.toFixed(1)} pt`;
  $('modeTag').textContent = modeLabel(z, measure);
  $('bandOut').textContent = `${num('band')} % of zone · ${band.toFixed(1)} pt`;
  $('maxHyphOut').textContent = String(num('maxHyph'));
  $('trackMaxOut').textContent = `±${num('trackMax')}/1000 em`;
  $<HTMLInputElement>('trackMax').disabled = !checked('tracking');
  $('wordMaxOut').textContent = `±${num('wordMax')} %`;
  $<HTMLInputElement>('wordMax').disabled = !checked('tracking');

  const result = simulate(text, {
    font,
    fontSize: size,
    language: lang,
    measure,
    flatterzone: z,
    band,
    phase: val('phase') as 'long' | 'short' | 'auto',
    continuous: checked('continuous'),
    mode: val('mode') as 'strict' | 'soft',
    maxConsecutiveHyphens: num('maxHyph'),
    noHyphenation: checked('noHyph'),
    hyphenation: val('hyphMode') as 'safe' | 'normal',
    sense: checked('sense'),
    tracking: { enabled: checked('tracking'), mode: 'precise', max: num('trackMax') },
    wordSpaceShare: num('wordMax') / 100,
  });
  const s = summarise(result);
  const plans = result.paragraphs.map((p) => p.plan);
  const edge = {
    long: Math.max(0, ...plans.map((p) => p.stats.longEdgeRange)),
    short: Math.max(0, ...plans.map((p) => p.stats.shortEdgeRange)),
    worst: Math.max(0, ...plans.map((p) => p.stats.edgeMiss)),
  };
  const allGood = s.errors === 0;
  $('status').innerHTML =
    `<span class="big ${allGood ? 'ok' : 'bad'}">${allGood ? '✓' : '⚠'} ${s.inRhythm}/${s.bandLines} lines in rhythm</span>` +
    `<span class="meta">edges: long ±${edge.long.toFixed(1)} pt, short ±${edge.short.toFixed(1)} pt, worst ${edge.worst.toFixed(1)} pt off · ${s.perfect}/${s.paragraphs} paragraphs strict · ${s.hyphens} hyphens · ${s.tracked} tracked lines, ${s.spaced} with adjusted word spaces · ${s.errors} errors · ${s.warnings} warnings · solved in ${result.solveMs.toFixed(1)} ms</span>`;

  $('preview').innerHTML = renderSvg(
    result.paragraphs.map((p) => p.plan),
    { font, fontSize: size, leading: size * 1.3, measure, showBands: checked('bands'), showMarkers: checked('markers') },
  );

  const items: string[] = [];
  result.paragraphs.forEach(({ plan }, pi) => {
    for (const v of plan.violations) {
      if (v.kind === 'tight-steering') continue;
      const where = v.line >= 0 ? `¶${pi + 1}, line ${v.line + 1}` : `¶${pi + 1}`;
      items.push(`<li class="sev-${v.severity}"><strong>${where}</strong>: ${esc(v.message)}</li>`);
    }
  });
  $('issues').innerHTML = items.length ? `<h2>Report</h2><ul>${items.join('')}</ul>` : '';
}

for (const id of ['chars', 'size', 'z', 'band', 'maxHyph', 'trackMax', 'wordMax']) $(id).addEventListener('input', schedule);
for (const id of ['phase', 'mode', 'continuous', 'noHyph', 'hyphMode', 'sense', 'tracking', 'bands', 'markers']) $(id).addEventListener('change', schedule);
textArea.addEventListener('input', () => {
  textEdited = true;
  schedule();
});
langSel.addEventListener('change', () => {
  if (!textEdited) textArea.value = sample(langSel.value as SimLanguage);
  // Sinneinheiten default: on for German, off for English (plan §2A.6).
  $<HTMLInputElement>('sense').checked = langSel.value.startsWith('de');
  schedule();
});
$('reset').addEventListener('click', () => {
  textArea.value = sample(langSel.value as SimLanguage);
  textEdited = false;
  schedule();
});
render();
