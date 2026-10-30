import { modeLabel } from '@flatter/core';
import fontBytes from '@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff';
import deText from '../../../test/fixtures/texts/de.txt';
import enText from '../../../test/fixtures/texts/en.txt';
import { averageCharWidth, fontFromBytes, paragraphVariants, renderSvg, SIM_LANGUAGES, simulate, splitParagraphs, summarise, type SimLanguage, type SimResult, type Variant } from '../src/index.ts';

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

/** The last result and its view options, for the variants animation. */
let last: { result: SimResult; view: Parameters<typeof renderSvg>[1] } | undefined;

function render(): void {
  stopWatching();
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
  // Functional style: the band is how much neighbouring lines should differ at least; no phase.
  const functionalStyle = val('style') === 'functional';
  $('bandName').textContent = functionalStyle ? 'Flutter (neighbours differ by at least)' : 'Band';
  $<HTMLSelectElement>('phase').disabled = functionalStyle;
  $<HTMLInputElement>('continuous').disabled = functionalStyle;
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
    style: val('style') as 'aesthetic' | 'functional',
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

  const view = { font, fontSize: size, leading: size * 1.3, measure, showBands: checked('bands'), showMarkers: checked('markers') };
  last = { result, view };
  $('preview').innerHTML = renderSvg(
    result.paragraphs.map((p) => p.plan),
    view,
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

// Watch Flatter choose: every paragraph's variants from worst to best, ending on the plan Flatter chose. The solver
// never lists variants (its dynamic program finds the cheapest at once); this shows what it weighed.
const VARIANTS = 300;
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const DURATION_MS = 8000;
let watching: { frame: number; timer?: ReturnType<typeof setTimeout> } | undefined;

function stopWatching(): void {
  if (!watching) return;
  cancelAnimationFrame(watching.frame);
  if (watching.timer) clearTimeout(watching.timer);
  watching = undefined;
  $('watch').textContent = '▶ Watch Flatter choose';
  $('watchInfo').textContent = '';
  $('watchBar').style.setProperty('--p', '0');
}

function watch(): void {
  if (watching) {
    stopWatching();
    render();
    return;
  }
  if (!last) return;
  const { result, view } = last;
  $('watchInfo').textContent = 'Preparing variants…';
  watching = { frame: 0 };
  watching.timer = setTimeout(() => {
    const lists = result.paragraphs.map((p, i) => paragraphVariants(p.items, p.settings, p.plan, VARIANTS, i + 1).variants);
    const total = lists.reduce((s2, l) => s2 + l.length, 0);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    $('watch').textContent = '■ Stop';
    const start = performance.now();
    let shown = -1;
    const at = (list: Variant[], u: number) => list[Math.min(list.length - 1, Math.floor(u * list.length))] ?? list[list.length - 1]!;
    const step = (): void => {
      if (!watching) return;
      const linear = Math.min(1, (performance.now() - start) / DURATION_MS);
      // Slow down towards the end, where the variants get close to Flatter's; reduced motion: ten still steps.
      const u = reduced ? Math.floor(linear * 10) / 10 : 1 - (1 - linear) ** 2.2;
      const k = Math.min(total - 1, Math.floor(u * total));
      if (k !== shown) {
        shown = k;
        const current = lists.map((l) => at(l, u));
        $('preview').innerHTML = renderSvg(current.filter(Boolean).map((v) => v.plan), view);
        const errors = current.reduce((s2, v) => s2 + (v?.errors ?? 0), 0);
        const cost = current.reduce((s2, v) => s2 + (v?.cost ?? 0), 0);
        const done = linear >= 1;
        $('watchInfo').innerHTML = done
          ? `<strong>Flatter's choice</strong>: the best of ${total.toLocaleString('en')} variants shown, cost ${compact.format(cost)}, ${errors} rule ${errors === 1 ? 'break' : 'breaks'}. The solver found it without trying them one by one, in ${result.solveMs.toFixed(0)} ms.`
          : `Variant ${(k + 1).toLocaleString('en')} of ${total.toLocaleString('en')} · ${errors} rule ${errors === 1 ? 'break' : 'breaks'} · cost ${compact.format(cost)}`;
        $('watchBar').style.setProperty('--p', String(u));
      }
      if (linear >= 1) {
        watching = undefined;
        $('watch').textContent = '▶ Watch again';
        return;
      }
      watching.frame = requestAnimationFrame(step);
    };
    step();
  }, 30);
}

$('watch').addEventListener('click', watch);

for (const id of ['chars', 'size', 'z', 'band', 'maxHyph', 'trackMax', 'wordMax']) $(id).addEventListener('input', schedule);
for (const id of ['style', 'phase', 'mode', 'continuous', 'noHyph', 'hyphMode', 'sense', 'tracking', 'bands', 'markers']) $(id).addEventListener('change', schedule);
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
