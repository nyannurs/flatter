/**
 * Flatter panel (plan §6.3, §6.4). Live loop: slider input → debounce → plan
 * on cached measurements → move teeth (one undo step per drag); after a pause,
 * read back and verify.
 */
import { modeLabel } from '@flatter/core';
import {
  liveUpdate,
  liveVerify,
  openSession,
  removeFlatter,
  storedSettings,
  type ApplyResult,
  type ApplySettings,
  type LiveSession,
} from '@flatter/indesign-adapter';
import { startDevChannel } from './dev.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
declare const require: (m: string) => Any;
declare const FLATTER_DEV: boolean;

const indesign = require('indesign');
const app = indesign.app;

const DEBOUNCE_MS = 30;
const VERIFY_AFTER_MS = 250;

const $ = (id: string): Any => document.getElementById(id);
const num = (id: string) => Number($(id).value);
const checked = (id: string) => !!$(id).checked;
const picked = (id: string, fallback: string) => String($(id).value || fallback);

interface PanelState {
  live?: LiveSession;
  storyId?: number;
  dragging: boolean;
  tickTimer?: ReturnType<typeof setTimeout>;
  verifyTimer?: ReturnType<typeof setTimeout>;
  lastTickMs?: number;
  lastResult?: ApplyResult;
}
const state: PanelState = { dragging: false };

export function settingsFromUI(): ApplySettings {
  const tracking = checked('tracking');
  return {
    zoneShare: num('zone') / 100,
    bandShare: num('band') / 100,
    variation: num('variation') / 100,
    phase: picked('phase', 'long') as ApplySettings['phase'],
    mode: picked('mode', 'strict') as ApplySettings['mode'],
    hyphenation: picked('hyphenation', 'safe') as ApplySettings['hyphenation'],
    maxConsecutiveHyphens: num('maxHyph'),
    sense: checked('sense'),
    continuous: checked('continuous'),
    ...(tracking ? { tracking: { enabled: true, max: num('trackMax') } } : {}),
  };
}

function settingsToUI(s: ApplySettings): void {
  if (s.zoneShare !== undefined) $('zone').value = s.zoneShare * 100;
  if (s.bandShare !== undefined) $('band').value = s.bandShare * 100;
  if (s.variation !== undefined) $('variation').value = s.variation * 100;
  if (s.phase) $('phase').value = s.phase;
  if (s.mode) $('mode').value = s.mode;
  if (s.hyphenation) $('hyphenation').value = s.hyphenation;
  if (s.maxConsecutiveHyphens) $('maxHyph').value = s.maxConsecutiveHyphens;
  if (s.sense !== undefined) $('sense').checked = s.sense;
  if (s.continuous !== undefined) $('continuous').checked = s.continuous;
  $('tracking').checked = !!s.tracking?.enabled;
  if (s.tracking?.max) $('trackMax').value = s.tracking.max;
  syncLabels();
}

/** The story of the current selection: a text frame, or text / insertion point inside one. */
export function targetStory(): Any | undefined {
  try {
    if (!app.documents.length) return undefined;
    const sel = app.selection;
    const first = Array.isArray(sel) ? sel[0] : sel?.[0];
    if (!first) return undefined;
    if (first.parentStory) return first.parentStory;
    if (first.constructorName === 'TextFrame' || first.parentStory === undefined) return first.parentStory ?? undefined;
  } catch {
    /* no usable selection */
  }
  return undefined;
}

function syncLabels(): void {
  const share = num('zone') / 100;
  $('modeTag').textContent = modeLabel(share, 1);
  $('trackMax').disabled = !checked('tracking');
}

function setStatus(text: string, kind: 'ok' | 'bad' | 'err' | '' = '', meta = ''): void {
  const el = $('status');
  el.textContent = text;
  el.className = 'status' + (kind ? ' ' + kind : '');
  $('meta').textContent = meta;
}

function render(r: ApplyResult, ms?: number): void {
  state.lastResult = r;
  let band = 0;
  let inRhythm = 0;
  let strict = 0;
  const items: string[] = [];
  for (const p of r.paragraphs) {
    const broken = new Set(p.plan.violations.filter((v) => v.kind === 'band' || v.kind === 'contrast').map((v) => v.line));
    const bandLines = p.plan.lines.filter((l) => l.kind === 'band');
    band += bandLines.length;
    inRhythm += bandLines.filter((l) => !broken.has(l.index)).length;
    if (p.plan.feasible) strict++;
    for (const v of p.plan.violations) {
      if (v.kind === 'tight-steering') continue;
      const where = v.line >= 0 ? `¶${p.index + 1}, line ${v.line + 1}` : `¶${p.index + 1}`;
      items.push(`<div class="sev-${v.severity}"><b>${where}</b>: ${escapeHtml(v.message)}</div>`);
    }
    if (!p.steered && p.mismatch) items.push(`<div class="sev-error"><b>¶${p.index + 1}, line ${p.mismatch.line + 1}</b>: InDesign did not break where planned.</div>`);
    for (const w of p.refused) items.push(`<div class="sev-info"><b>¶${p.index + 1}</b>: InDesign refused the hyphenation ${escapeHtml(w)}; re-planned.</div>`);
    for (const u of p.unsupported) items.push(`<div class="sev-warning"><b>¶${p.index + 1}</b>: contains a ${u}; Flatter cannot plan around it yet.</div>`);
  }
  const allGood = inRhythm === band && r.linesAsPlanned === r.linesPlanned;
  setStatus(
    `${allGood ? '✓' : '⚠'} ${inRhythm}/${band} lines in rhythm`,
    allGood ? 'ok' : 'bad',
    `${strict}/${r.paragraphs.length} paragraphs strict · ${r.linesAsPlanned}/${r.linesPlanned} lines set as planned · ${r.trackedLines} tracked` +
      (ms !== undefined ? ` · ${ms} ms` : '') +
      (state.lastTickMs !== undefined ? ` · last slider tick ${state.lastTickMs} ms` : ''),
  );
  $('report').innerHTML = items.join('');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fail(e: unknown): void {
  setStatus('Something went wrong', 'err', String((e as Error)?.message ?? e));
}

function apply(): void {
  const story = targetStory();
  if (!story) {
    setStatus('Select a text frame first.', 'bad');
    return;
  }
  try {
    const { live, report } = openSession(story, settingsFromUI());
    state.live = live;
    state.storyId = story.id;
    render(report, report.ms);
  } catch (e) {
    fail(e);
  }
}

function remove(): void {
  const story = targetStory();
  if (!story) return;
  try {
    const r = removeFlatter(story);
    state.live = undefined;
    setStatus('Removed', '', `${r.teethRemoved} teeth removed, ${r.settingsRestored} settings restored.`);
    $('report').innerHTML = '';
  } catch (e) {
    fail(e);
  }
}

/** Slider or option changed. Debounced; the first tick of a drag opens the undo step. */
function onInput(): void {
  syncLabels();
  if (!checked('live')) return;
  if (state.tickTimer) clearTimeout(state.tickTimer);
  state.tickTimer = setTimeout(tick, DEBOUNCE_MS);
}

function tick(): void {
  const story = targetStory();
  if (!story) return;
  try {
    if (!state.live || state.storyId !== story.id || !state.live.story.isValid) {
      apply();
      return;
    }
    const t0 = Date.now();
    liveUpdate(state.live, settingsFromUI(), !state.dragging);
    state.dragging = true;
    state.lastTickMs = Date.now() - t0;
    if (state.verifyTimer) clearTimeout(state.verifyTimer);
    state.verifyTimer = setTimeout(verify, VERIFY_AFTER_MS);
  } catch (e) {
    fail(e);
  }
}

function verify(): void {
  if (!state.live) return;
  try {
    const t0 = Date.now();
    const r = liveVerify(state.live);
    state.dragging = false;
    render(r, Date.now() - t0);
  } catch (e) {
    fail(e);
  }
}

function onSelectionChanged(): void {
  const story = targetStory();
  if (!story) {
    $('target').textContent = 'Select a text frame or put the cursor in text.';
    return;
  }
  const words = String(story.contents).replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ');
  $('target').textContent = `Story: ${words}…`;
  if (state.storyId !== story.id) {
    state.live = undefined;
    state.storyId = story.id;
    const stored = storedSettings(story);
    if (stored) {
      settingsToUI(stored);
      setStatus('Flatter is applied to this story.', '', 'Move a slider or press Recompute to work on it.');
    } else {
      setStatus('', '');
      $('report').innerHTML = '';
    }
  }
}

function init(): void {
  for (const id of ['zone', 'band', 'variation', 'maxHyph', 'trackMax']) {
    $(id).addEventListener('input', onInput);
    $(id).addEventListener('change', onInput);
  }
  for (const id of ['phase', 'mode', 'hyphenation', 'sense', 'continuous', 'tracking']) $(id).addEventListener('change', onInput);
  $('apply').addEventListener('click', apply);
  $('recompute').addEventListener('click', () => {
    state.live = undefined;
    apply();
  });
  $('remove').addEventListener('click', remove);
  app.addEventListener('afterSelectionChanged', onSelectionChanged);
  syncLabels();
  onSelectionChanged();
  if (typeof FLATTER_DEV !== 'undefined' && FLATTER_DEV) startDevChannel();
}

const { entrypoints } = require('uxp');
entrypoints.setup({
  panels: {
    flatterPanel: {
      show() {
        /* the panel's DOM is the page itself */
      },
    },
  },
});
init();
