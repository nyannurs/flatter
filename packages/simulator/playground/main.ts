import { modeLabel, senseMultiplier } from '@flatter/core';
import fontBytes from '@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff';
import deText from '../../../test/fixtures/texts/de.txt';
import enText from '../../../test/fixtures/texts/en.txt';
import { averageCharWidth, fontFromBytes, paragraphVariants, plainVariant, renderSvg, type RenderColors, SIM_LANGUAGES, simulate, splitParagraphs, summarise, type SimLanguage, type SimResult, type Variant } from '../src/index.ts';

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

/** Shape ↔ Sense slider (ADR-025): its two ends and the Sinneinheiten weight in between. */
function senseLabel(v: number): string {
  if (v <= 0) return 'Shape only';
  if (v >= 100) return 'Sense first';
  const m = senseMultiplier(v / 100);
  return v === 50 ? 'Balanced' : `weight ×${m < 1 ? m.toFixed(2) : m.toFixed(1)}`;
}

// Colours of the preview: background, text and the two bands (one alpha for both). Remembered per browser.
const COLOR_INPUTS = { cPaper: '#ffffff', cInk: '#1b1b1b', cLong: '#2563eb', cShort: '#ea580c', cAlpha: '12' } as const;
const COLOR_KEY = 'flatter-playground-colours';
try {
  const saved = JSON.parse(localStorage.getItem(COLOR_KEY) ?? '{}') as Record<string, string>;
  for (const id of Object.keys(COLOR_INPUTS)) if (typeof saved[id] === 'string') $<HTMLInputElement>(id).value = saved[id];
} catch {
  // No storage: start with the defaults.
}

const rgba = (hex: string, alpha: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

function colors(): Partial<RenderColors> {
  const ink = val('cInk');
  const alpha = num('cAlpha') / 100;
  const long = rgba(val('cLong'), alpha);
  const short = rgba(val('cShort'), alpha);
  $('cAlphaOut').textContent = `${num('cAlpha')} %`;
  // The legend's swatches follow the bands.
  $('legend').style.setProperty('--long-band', long);
  $('legend').style.setProperty('--short-band', short);
  try {
    localStorage.setItem(COLOR_KEY, JSON.stringify(Object.fromEntries(Object.keys(COLOR_INPUTS).map((id) => [id, val(id)]))));
  } catch {
    // Not remembered; fine.
  }
  return { paper: val('cPaper'), ink, longBand: long, shortBand: short, edge: rgba(ink, 0.25), note: rgba(ink, 0.55) };
}

/** The last result and its view options, for the variants animation. */
let last: { result: SimResult; view: Parameters<typeof renderSvg>[1] } | undefined;

/**
 * Until the animation has played through once, the preview shows the text as a plain composer sets it (greedy first
 * fit), for showing Flatter to others: before, then the animation, then Flatter's result from then on.
 */
let playedThrough = false;

function render(keepInfo = false): void {
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
  $('senseBalOut').textContent = senseLabel(num('senseBal'));
  $<HTMLInputElement>('senseBal').disabled = !checked('sense');
  $('trackMaxOut').textContent = `±${num('trackMax')}/1000 em`;
  $<HTMLInputElement>('trackMax').disabled = !checked('tracking');
  $('wordMaxOut').textContent = `±${num('wordMax')} %`;
  $<HTMLInputElement>('wordMax').disabled = !checked('tracking');
  // Functional style draws one zone in the long band's colour.
  $('cLongName').textContent = functionalStyle ? 'Zone' : 'Long band';
  $<HTMLInputElement>('cShort').disabled = functionalStyle;

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
    senseBalance: num('senseBal') / 100,
    tracking: { enabled: checked('tracking'), mode: 'precise', max: num('trackMax') },
    wordSpaceShare: num('wordMax') / 100,
  });
  const shownResult = playedThrough ? result : { ...result, paragraphs: result.paragraphs.map((p) => ({ ...p, plan: plainVariant(p.items, p.settings, p.plan)?.plan ?? p.plan })) };
  const s = summarise(shownResult);
  const plans = shownResult.paragraphs.map((p) => p.plan);
  const edge = {
    long: Math.max(0, ...plans.map((p) => p.stats.longEdgeRange)),
    short: Math.max(0, ...plans.map((p) => p.stats.shortEdgeRange)),
    worst: Math.max(0, ...plans.map((p) => p.stats.edgeMiss)),
  };
  const allGood = s.errors === 0;
  $('status').innerHTML =
    `<span class="big ${allGood ? 'ok' : 'bad'}">${allGood ? '✓' : '⚠'} ${s.inRhythm}/${s.bandLines} lines in rhythm</span>` +
    `<span class="meta">edges: long ±${edge.long.toFixed(1)} pt, short ±${edge.short.toFixed(1)} pt, worst ${edge.worst.toFixed(1)} pt off · ${s.perfect}/${s.paragraphs} paragraphs strict · ${s.hyphens} hyphens · ${s.tracked} tracked lines, ${s.spaced} with adjusted word spaces · ${s.errors} errors · ${s.warnings} warnings · solved in ${result.solveMs.toFixed(1)} ms</span>`;

  const view = { font, fontSize: size, leading: size * 1.3, measure, showBands: checked('bands'), showMarkers: checked('markers'), colors: colors() };
  last = { result, view };
  $('preview').innerHTML = renderSvg(plans, view);
  if (!playedThrough) $('watchInfo').textContent = 'Before Flatter: the text as a plain composer sets it. Press ▶ to watch Flatter choose.';
  else if (!keepInfo) $('watchInfo').textContent = '';

  const items: string[] = [];
  shownResult.paragraphs.forEach(({ plan }, pi) => {
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
// How long the animation plays, set by the Duration slider (seconds); remembered per browser.
const SECS_KEY = 'flatter-playground-watch-seconds';
const secsInput = $<HTMLInputElement>('watchSecs');
try {
  const saved = localStorage.getItem(SECS_KEY);
  if (saved) secsInput.value = saved;
} catch {
  // No storage: start with the default.
}
const durationMs = () => num('watchSecs') * 1000;
const showSecs = () => {
  $('watchSecsOut').textContent = `${num('watchSecs')} s`;
};
showSecs();
let watching: { frame: number; timer?: ReturnType<typeof setTimeout>; start?: number; duration?: number } | undefined;

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
    // Start from the plain composer's version (what the preview showed before), then worst to best.
    const lists = result.paragraphs.map((p, i) => {
      const all = paragraphVariants(p.items, p.settings, p.plan, VARIANTS, i + 1).variants;
      return [...all.filter((v) => v.source === 'greedy'), ...all.filter((v) => v.source !== 'greedy')];
    });
    const total = lists.reduce((s2, l) => s2 + l.length, 0);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    $('watch').textContent = '■ Stop';
    watching!.start = performance.now();
    watching!.duration = durationMs();
    let shown = -1;
    const at = (list: Variant[], u: number) => list[Math.min(list.length - 1, Math.floor(u * list.length))] ?? list[list.length - 1]!;
    const step = (): void => {
      if (!watching) return;
      const linear = Math.min(1, (performance.now() - watching.start!) / watching.duration!);
      // Slow down towards the end, where the variants get close to Flatter's; reduced motion: ten still steps.
      const u = reduced ? Math.floor(linear * 10) / 10 : 1 - (1 - linear) ** 2.2;
      const k = Math.min(total - 1, Math.floor(u * total));
      if (k !== shown || linear >= 1) {
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
        // From now on the preview, status and report show Flatter's result.
        playedThrough = true;
        render(true);
        return;
      }
      watching.frame = requestAnimationFrame(step);
    };
    step();
  }, 30);
}

$('watch').addEventListener('click', watch);
// Changing the duration while it plays keeps the current position and plays the rest at the new speed.
secsInput.addEventListener('input', () => {
  showSecs();
  try {
    localStorage.setItem(SECS_KEY, secsInput.value);
  } catch {
    // Not remembered; fine.
  }
  if (watching?.start === undefined) return;
  const now = performance.now();
  const done = Math.min(1, (now - watching.start) / watching.duration!);
  watching.duration = durationMs();
  watching.start = now - done * watching.duration;
});

for (const id of ['chars', 'size', 'z', 'band', 'maxHyph', 'senseBal', 'trackMax', 'wordMax', ...Object.keys(COLOR_INPUTS)]) $(id).addEventListener('input', schedule);
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
$('cReset').addEventListener('click', () => {
  for (const [id, v] of Object.entries(COLOR_INPUTS)) $<HTMLInputElement>(id).value = v;
  schedule();
});
$('reset').addEventListener('click', () => {
  textArea.value = sample(langSel.value as SimLanguage);
  textEdited = false;
  schedule();
});
render();
