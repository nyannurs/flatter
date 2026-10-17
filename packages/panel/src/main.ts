/**
 * Flatter panel (plan §6.3, §6.4). Live loop: slider input → debounce → plan
 * on cached measurements → move teeth (one undo step per drag); after a pause,
 * read back and verify.
 */
import { modeLabel, type Violation } from '@flatter/core';
import {
  clearMeasureCache,
  liveUpdate,
  liveVerify,
  openSession,
  removeFlatter,
  storedSettings,
  setStoryLanguage,
  storyLanguage,
  LANGUAGES,
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
  /** Apply runs (synchronously, can take seconds on long stories); ticks wait for it. */
  busy: boolean;
  /** Input arrived while busy: run one more tick afterwards. */
  pending: boolean;
  /** Apply failed for this story: do not retry on every slider tick. */
  failed?: { storyId: number; message: string };
  storyId?: number;
  dragging: boolean;
  tickTimer?: ReturnType<typeof setTimeout>;
  verifyTimer?: ReturnType<typeof setTimeout>;
  lastTickMs?: number;
  lastResult?: ApplyResult;
  /** The notes section of the report is open. */
  showNotes?: boolean;
  /** The last tick was a draft (no word spaces): verify applies the full settings first. */
  draft?: boolean;
}
const state: PanelState = { dragging: false, busy: false, pending: false };

export function settingsFromUI(): ApplySettings {
  const tracking = checked('tracking');
  return {
    zoneShare: num('zone') / 100,
    bandShare: num('band') / 100,
    phase: picked('phase', 'long') as ApplySettings['phase'],
    mode: picked('mode', 'strict') as ApplySettings['mode'],
    hyphenation: picked('hyphenation', 'safe') as ApplySettings['hyphenation'],
    maxConsecutiveHyphens: num('maxHyph'),
    sense: checked('sense'),
    continuous: checked('continuous'),
    showBands: checked('showBands'),
    // Laufweite in precise mode (ADR-013): every line end is pulled onto its edge, within ±max.
    ...(tracking ? { tracking: { enabled: true, mode: 'precise' as const, max: num('trackMax') }, wordSpaceShare: num('wordMax') / 100 } : {}),
  };
}

function settingsToUI(s: ApplySettings): void {
  if (s.zoneShare !== undefined) $('zone').value = s.zoneShare * 100;
  if (s.bandShare !== undefined) $('band').value = s.bandShare * 100;
  if (s.phase) $('phase').value = s.phase;
  if (s.mode) $('mode').value = s.mode;
  if (s.hyphenation) $('hyphenation').value = s.hyphenation;
  if (s.maxConsecutiveHyphens) $('maxHyph').value = s.maxConsecutiveHyphens;
  if (s.sense !== undefined) $('sense').checked = s.sense;
  if (s.continuous !== undefined) $('continuous').checked = s.continuous;
  if (s.showBands !== undefined) $('showBands').checked = s.showBands;
  $('tracking').checked = !!s.tracking?.enabled;
  if (s.tracking?.max !== undefined) $('trackMax').value = s.tracking.max;
  if (s.wordSpaceShare !== undefined) $('wordMax').value = Math.round(s.wordSpaceShare * 100);
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

/** Every story in the selection (selected frames, or the story the text cursor is in), once each. */
function selectedStories(): Any[] {
  const out = new Map<number, Any>();
  try {
    if (!app.documents.length) return [];
    for (const item of app.selection ?? []) {
      const story = item?.parentStory;
      if (story?.isValid) out.set(Number(story.id), story);
    }
  } catch {
    /* no usable selection */
  }
  return [...out.values()];
}

/** Show the target story's language and mark the matching button. */
function showLanguage(story: Any | undefined): void {
  const name = story ? storyLanguage(story) : '';
  $('langNow').textContent = name ? `Now: ${name}` : '';
  $('langDe').selected = name === LANGUAGES.de;
  $('langEn').selected = name === LANGUAGES.en;
}

/**
 * German / English buttons: set the language of the selected stories (all linked frames). A story
 * Flatter works on is applied again, because the language changes hyphenation and required settings.
 */
function setLanguage(lang: keyof typeof LANGUAGES): void {
  if (state.busy) return;
  const stories = selectedStories();
  if (!stories.length) {
    setStatus('Select one or more text frames first.', 'bad');
    return;
  }
  try {
    setStoryLanguage(stories, LANGUAGES[lang]);
  } catch (e) {
    fail(e);
    return;
  }
  const story = targetStory();
  showLanguage(story);
  const others = stories.filter((s) => s.id !== story?.id && storedSettings(s)).length;
  if (story && storedSettings(story)) {
    state.live = undefined;
    state.failed = undefined;
    apply();
  } else {
    setStatus(`Language set to ${LANGUAGES[lang]} for ${stories.length === 1 ? 'this story' : `${stories.length} stories`}.`, 'ok', 'Press Apply to set the rag.');
  }
  if (others) $('meta').textContent += ` ${others} other selected ${others === 1 ? 'story uses' : 'stories use'} Flatter: select ${others === 1 ? 'it' : 'each'} and press Recompute.`;
}

function syncLabels(): void {
  const share = num('zone') / 100;
  $('modeTag').textContent = modeLabel(share, 1).toUpperCase();
  $('trackMax').disabled = !checked('tracking');
  $('wordMax').disabled = !checked('tracking');
}

function setStatus(text: string, kind: 'ok' | 'bad' | 'err' | '' = '', meta = ''): void {
  const el = $('status');
  el.textContent = text;
  el.className = kind;
  $('meta').textContent = meta;
}

function render(r: ApplyResult, ms?: number): void {
  state.lastResult = r;
  let band = 0;
  let inRhythm = 0;
  let strict = 0;
  let longRange = 0;
  let shortRange = 0;
  let worstMiss = 0;
  let hidden = 0;
  const problems: string[] = [];
  const notes: string[] = [];
  for (const p of r.paragraphs) {
    const visible = (line: number) => line < p.visibleLines;
    const broken = new Set(p.plan.violations.filter((v) => v.kind === 'band' || v.kind === 'contrast').map((v) => v.line));
    // Only the lines you can see count: overset lines are not set.
    const bandLines = p.plan.lines.filter((l) => l.kind === 'band' && visible(l.index));
    band += bandLines.length;
    inRhythm += bandLines.filter((l) => !broken.has(l.index)).length;
    if (p.plan.feasible) strict++;
    longRange = Math.max(longRange, p.plan.stats.longEdgeRange);
    shortRange = Math.max(shortRange, p.plan.stats.shortEdgeRange);
    worstMiss = Math.max(worstMiss, p.plan.stats.edgeMiss);
    // One entry per line: its problems merged, worst severity first; hints go to the notes.
    const byLine = new Map<number, Violation[]>();
    for (const v of p.plan.violations) {
      if (v.kind === 'tight-steering') continue;
      if (v.line >= 0 && !visible(v.line)) {
        if (v.severity !== 'info') hidden++;
        continue;
      }
      const list = byLine.get(v.line) ?? [];
      list.push(v);
      byLine.set(v.line, list);
    }
    for (const [line, vs] of [...byLine.entries()].sort((x, y) => x[0] - y[0])) {
      const serious = vs.filter((v) => v.severity !== 'info');
      const hints = vs.filter((v) => v.severity === 'info');
      if (serious.length) {
        const cls = serious.some((v) => v.severity === 'error') ? 'err' : 'bad';
        problems.push(reportItem(p.index, line, cls, mergeMessages(serious)));
      }
      for (const h of hints) notes.push(reportItem(p.index, line, '', h.message));
    }
    if (!p.steered && p.mismatch) {
      const m = p.mismatch;
      const said = m.got
        ? `InDesign ended this line at “…${m.got.text.trim()}” instead of the planned “…${m.planned.text.trim()}”.`
        : 'InDesign did not set this line (it is overset or hidden).';
      problems.unshift(reportItem(p.index, m.line, 'err', `${said} The lines after it shift too, so they no longer match the plan. Try Recompute; if it stays, the line is too tight for its band.`));
    }
    for (const w of p.refused) notes.push(`<sp-body size="XS">¶${p.index + 1}: InDesign refused the hyphenation ${escapeHtml(w)}; re-planned.</sp-body>`);
    for (const u of p.unsupported) problems.push(`<sp-body size="XS" class="bad">¶${p.index + 1}: contains a ${u}; Flatter cannot plan around it yet.</sp-body>`);
  }
  const allGood = inRhythm === band && r.linesAsPlanned === r.linesPlanned;
  setStatus(
    `${allGood ? '✓' : '⚠'} ${inRhythm}/${band} visible lines in rhythm`,
    allGood ? 'ok' : 'bad',
    `Edges: long lines end within ${longRange.toFixed(1)} pt of each other, short within ${shortRange.toFixed(1)} pt; worst line ${worstMiss.toFixed(1)} pt off its edge · ` +
      `${strict}/${r.paragraphs.length} paragraphs strict · ${r.linesAsPlanned}/${r.linesPlanned} lines set as planned · ${r.trackedLines} tracked, ${r.spacedLines} with adjusted word spaces` +
      (r.oversetLines ? ` · ${r.oversetLines} lines overset (not visible, not set)` : '') +
      (ms !== undefined ? ` · ${ms} ms` : '') +
      (state.lastTickMs !== undefined ? ` · last slider tick ${state.lastTickMs} ms` : ''),
  );
  const parts: string[] = [];
  if (problems.length) parts.push(`<sp-detail>PROBLEMS (${problems.length})</sp-detail>`, ...problems);
  if (hidden) parts.push(`<sp-body size="XS" class="dim">${hidden} more in overset lines (not visible, not listed).</sp-body>`);
  if (notes.length) {
    parts.push(`<sp-body size="XS" class="toggle" id="notesToggle">${state.showNotes ? '▾' : '▸'} Notes (${notes.length}): line ends, phrases, hyphenation</sp-body>`);
    if (state.showNotes) parts.push(...notes);
  }
  $('report').innerHTML = parts.join('');
}

/** One sentence for all of a line's problems: a band miss and the hole it makes are one problem. */
function mergeMessages(vs: readonly Violation[]): string {
  const kinds = new Set(vs.map((v) => v.kind));
  return vs
    .filter((v) => !(v.kind === 'hole' && kinds.has('band')))
    .map((v) => (v.kind === 'band' && kinds.has('hole') ? `${v.message.replace(/\.$/, '')}: a hole in the rag.` : v.message))
    .join(' ');
}

/** One report entry. Entries about a line can be clicked to select that line in the document. */
function reportItem(paragraph: number, line: number, cls: string, message: string): string {
  const where = line >= 0 ? `¶${paragraph + 1}, line ${line + 1}` : `¶${paragraph + 1}`;
  const data = line >= 0 ? ` data-p="${paragraph}" data-l="${line}"` : '';
  return `<sp-body size="XS" class="${cls}${line >= 0 ? ' jump' : ''}"${data}>${where}: ${escapeHtml(message)}</sp-body>`;
}

/** Select line l of paragraph p in the document and scroll to it. */
function jumpTo(p: number, l: number): void {
  const story = state.live?.story ?? targetStory();
  if (!story) return;
  try {
    const line = story.paragraphs.item(p).lines.item(l);
    if (!line.isValid) {
      $('meta').textContent = `¶${p + 1}, line ${l + 1} is overset: it is not visible in any frame.`;
      return;
    }
    line.select();
    line.showText();
  } catch {
    // The text changed since the report; nothing to show.
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fail(e: unknown): void {
  setStatus('Flatter could not set this story', 'err', `${String((e as Error)?.message ?? e)}. Nothing was changed. Press Apply to try again.`);
}

/** Apply: measure, probe, plan, steer. Shows "Preparing…" first (it can take seconds on long stories). */
function apply(): void {
  const story = targetStory();
  if (!story) {
    setStatus('Select a text frame first.', 'bad');
    return;
  }
  if (state.busy) return;
  state.busy = true;
  state.failed = undefined;
  setStatus('Preparing…', '', 'Measuring the text and checking hyphenation. This happens once per story.');
  $('report').innerHTML = '';
  // Let the panel paint the status before the long synchronous work starts.
  setTimeout(() => {
    try {
      const { live, report } = openSession(story, settingsFromUI());
      state.live = live;
      state.storyId = story.id;
      render(report, report.ms);
    } catch (e) {
      state.live = undefined;
      state.failed = { storyId: story.id, message: String((e as Error)?.message ?? e) };
      fail(e);
    } finally {
      state.busy = false;
      if (state.pending) {
        state.pending = false;
        onInput();
      }
    }
  }, 30);
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
  if (state.busy) {
    state.pending = true;
    return;
  }
  // After a failed Apply, sliders do not retry (each retry would freeze InDesign again).
  if (state.failed && state.failed.storyId === story.id) return;
  try {
    if (!state.live || state.storyId !== story.id || !state.live.story.isValid) {
      apply();
      return;
    }
    const t0 = Date.now();
    const settings = settingsFromUI();
    // While a slider moves, word spaces wait: they are applied once the slider stops (see verify).
    const draft = !!settings.tracking?.enabled && (settings.wordSpaceShare ?? 0) > 0;
    liveUpdate(state.live, draft ? { ...settings, draft: true } : settings, !state.dragging);
    state.draft = draft;
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
  if (state.draft) {
    // Show that something is happening, then set the word spaces (about a second in a long story).
    setStatus('Setting word spaces…', '', '');
    setTimeout(() => {
      if (!state.live) return;
      try {
        if (state.draft) liveUpdate(state.live, settingsFromUI(), false);
        state.draft = false;
      } catch (e) {
        fail(e);
        return;
      }
      verify();
    }, 20);
    return;
  }
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
  // Flatter's own hidden measuring document opens and closes while it works.
  if (state.busy) return;
  const story = targetStory();
  if (!story) {
    $('target').textContent = 'Select a text frame or put the cursor in text.';
    showLanguage(undefined);
    return;
  }
  const words = String(story.contents).replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ');
  $('target').textContent = `Story: ${words}…`;
  showLanguage(story);
  if (state.storyId !== story.id) {
    state.live = undefined;
    state.failed = undefined;
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
  for (const id of ['zone', 'band', 'maxHyph', 'trackMax', 'wordMax']) {
    $(id).addEventListener('input', onInput);
    $(id).addEventListener('change', onInput);
  }
  for (const id of ['phase', 'mode', 'hyphenation', 'sense', 'continuous', 'tracking', 'showBands']) $(id).addEventListener('change', onInput);
  $('apply').addEventListener('click', apply);
  $('recompute').addEventListener('click', () => {
    // Recompute measures afresh (for example after formatting changed inside a paragraph).
    clearMeasureCache();
    state.live = undefined;
    state.failed = undefined;
    apply();
  });
  $('apply').addEventListener('click', () => {
    state.failed = undefined;
  });
  $('remove').addEventListener('click', remove);
  $('langDe').addEventListener('click', () => setLanguage('de'));
  $('langEn').addEventListener('click', () => setLanguage('en'));
  $('report').addEventListener('click', (e: Any) => {
    let el = e.target;
    if (el?.id === 'notesToggle' || el?.parentElement?.id === 'notesToggle') {
      state.showNotes = !state.showNotes;
      if (state.lastResult) render(state.lastResult);
      return;
    }
    while (el && el.id !== 'report' && !el.dataset?.l) el = el.parentElement;
    if (el?.dataset?.l !== undefined) jumpTo(Number(el.dataset.p), Number(el.dataset.l));
  });
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
