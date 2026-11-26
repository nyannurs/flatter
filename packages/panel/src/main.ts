/**
 * Flatter panel (plan §6.3, §6.4). Live loop: slider input → debounce → plan
 * on cached measurements → move teeth (one undo step per drag); after a pause,
 * read back and verify.
 */
import { senseMultiplier, type Violation } from '@flatter/core';
import {
  clearMeasureCache,
  liveUpdate,
  liveVerify,
  openSession,
  removeFlatter,
  storedSettings,
  storyLanguage,
  knownHyphenLanguage,
  startWholeStory,
  unfreezeFlatter,
  liveIsStale,
  isFrozen,
  selfCheck,
  compatibilityAlarms,
  steeringFailed,
  isUserError,
  paragraphAt,
  type SelfCheckResult,
  type ApplyResult,
  type ApplySettings,
  type LiveSession,
  type WholeStoryJob,
} from '@flatter/indesign-adapter';
import { startDevChannel } from './dev.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
declare const require: (m: string) => Any;
declare const FLATTER_DEV: boolean;
declare const FLATTER_VERSION: string;

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
  failed?: { storyId: number };
  storyId?: number;
  dragging: boolean;
  tickTimer?: ReturnType<typeof setTimeout>;
  verifyTimer?: ReturnType<typeof setTimeout>;
  lastTickMs?: number;
  lastResult?: ApplyResult;
  /** The notes section of the report is open. */
  showNotes?: boolean;
  /** The result's details (edges, strict paragraphs, tracked lines, timings) are open. */
  showDetails?: boolean;
  /** Aesthetic (strict long/short) or functional rag (ADR-021). */
  style: 'aesthetic' | 'functional';
  /** The last tick was a draft (no word spaces): verify applies the full settings first. */
  draft?: boolean;
  /** What produced the latest result (for the alarm details). */
  lastAction: string;
  /** Steering failed and the story was measured again automatically; the first failure, for the alarm. */
  recovery?: { storyId: number; first: string };
  /** The paragraphs the live session works on: "" for the whole story, "3-7" for a preview on a selection. */
  scope?: string;
  /** The previewed paragraphs, kept when the text is deselected (Escape, a click elsewhere) until other text is selected. */
  preview?: { storyId: number; from: number; to: number };
  /** Apply to whole story is running (step by step, so the progress bar can redraw). */
  job?: WholeStoryJob;
  /** Cancel was pressed: the job stops and takes back what it wrote at the next step. */
  cancelWhole?: boolean;
  /** Time of the last result, for redrawing the report. */
  lastMs?: number;
}
const state: PanelState = { dragging: false, busy: false, pending: false, style: 'aesthetic', lastAction: '' };

/** Stop the live loop: a slider move waiting, a verify waiting, a drag in progress (2026-11-26, audit). */
function stopLive(): void {
  clearTimeout(state.tickTimer);
  clearTimeout(state.verifyTimer);
  state.tickTimer = undefined;
  state.verifyTimer = undefined;
  state.pending = false;
  state.dragging = false;
  state.draft = false;
}

/** Forget the live session: after Apply to whole story, Remove, Cancel or a failure, it no longer matches the document. */
function forgetSession(): void {
  state.live = undefined;
  state.preview = undefined;
  state.scope = undefined;
  state.failed = undefined;
  state.recovery = undefined;
}

/** The panel is free again: catch up with selection changes made meanwhile, then run a slider move that waited. */
function idle(): void {
  state.busy = false;
  const pending = state.pending;
  state.pending = false;
  onSelectionChanged();
  if (pending) onInput();
}

function settingsFromUI(): ApplySettings {
  const tracking = checked('tracking');
  return {
    zoneShare: num('zone') / 100,
    bandShare: num('band') / 100,
    phase: picked('phase', 'long') as ApplySettings['phase'],
    mode: picked('mode', 'strict') as ApplySettings['mode'],
    hyphenation: picked('hyphenation', 'safe') as ApplySettings['hyphenation'],
    maxConsecutiveHyphens: num('maxHyph'),
    sense: checked('sense'),
    senseBalance: num('senseBal') / 100,
    continuous: checked('continuous'),
    showBands: checked('showBands'),
    style: state.style,
    // Laufweite in precise mode (ADR-013): every line end is pulled onto its edge, within ±max.
    ...(tracking ? { tracking: { enabled: true, mode: 'precise' as const, max: num('trackMax') }, wordSpaceShare: num('wordMax') / 100 } : {}),
  };
}

/**
 * Choose a picker's item. A UXP sp-picker's `value` has only a getter (setting it threw, which stopped the panel from
 * showing a story's stored settings, 2026-11-26): select the menu item with that value instead.
 */
function pick(id: string, value: string): void {
  const items = Array.from($(id).querySelectorAll('sp-menu-item') as ArrayLike<Any>);
  const index = items.findIndex((item) => String(item.getAttribute('value') ?? item.value) === value);
  if (index < 0) return;
  items.forEach((item, k) => (item.selected = k === index));
  try {
    $(id).selectedIndex = index;
  } catch {
    /* the selected item is enough */
  }
}

function settingsToUI(s: ApplySettings): void {
  if (s.zoneShare !== undefined) $('zone').value = s.zoneShare * 100;
  if (s.bandShare !== undefined) $('band').value = s.bandShare * 100;
  if (s.phase) pick('phase', s.phase);
  if (s.mode) pick('mode', s.mode);
  if (s.hyphenation) pick('hyphenation', s.hyphenation);
  if (s.maxConsecutiveHyphens) $('maxHyph').value = s.maxConsecutiveHyphens;
  if (s.sense !== undefined) $('sense').checked = s.sense;
  $('senseBal').value = (s.senseBalance ?? 0.5) * 100;
  if (s.continuous !== undefined) $('continuous').checked = s.continuous;
  if (s.showBands !== undefined) $('showBands').checked = s.showBands;
  state.style = s.style ?? 'aesthetic';
  $('tracking').checked = !!s.tracking?.enabled;
  if (s.tracking?.max !== undefined) $('trackMax').value = s.tracking.max;
  if (s.wordSpaceShare !== undefined) $('wordMax').value = Math.round(s.wordSpaceShare * 100);
  syncLabels();
}

/** Dev channel only: a story to work on instead of the selection (in a hidden throwaway document). */
let devStory: Any | undefined;

/** The story of the current selection: a text frame, or text / insertion point inside one. */
function targetStory(): Any | undefined {
  if (devStory?.isValid) return devStory;
  try {
    if (!app.documents.length) return undefined;
    const sel = app.selection;
    const first = Array.isArray(sel) ? sel[0] : sel?.[0];
    return first?.parentStory || undefined;
  } catch {
    /* no usable selection */
  }
  return undefined;
}

/**
 * The paragraphs of the selected text in this story, for a preview on a few paragraphs (2026-11-19); undefined for a
 * text frame, a cursor or text of another story (then Flatter works on the whole story).
 */
function selectedParagraphs(story: Any): { from: number; to: number } | undefined {
  try {
    const sel = app.selection;
    const first = Array.isArray(sel) ? sel[0] : sel?.[0];
    if (!first || first.constructorName === 'InsertionPoint' || first.constructorName === 'TextFrame') return undefined;
    if (!first.parentStory || first.parentStory.id !== story.id) return undefined;
    const n = Number(first.characters?.length ?? 0);
    if (!n) return undefined;
    const a = Number(first.characters.item(0).index);
    const b = Number(first.characters.item(n - 1).index);
    const raw = story.paragraphs.everyItem().index;
    const starts = (Array.isArray(raw) ? raw : [raw]).map(Number);
    return { from: paragraphAt(starts, a), to: paragraphAt(starts, b) };
  } catch {
    return undefined;
  }
}

const scopeKey = (scope: { from: number; to: number } | undefined) => (scope ? `${scope.from}-${scope.to}` : '');

/** Paragraphs Preview takes when no text is selected (ADR-036). */
const PREVIEW_PARAGRAPHS = 5;

/**
 * The paragraphs Preview works on for the current selection: the selected text's paragraphs; else up to five from the
 * paragraph the cursor is in, or from the first paragraph of the selected frame; else the story's first five.
 */
function selectionScope(story: Any): { from: number; to: number } {
  const selected = selectedParagraphs(story);
  if (selected) return selected;
  let at = 0;
  try {
    const sel = app.selection;
    const first = Array.isArray(sel) ? sel[0] : sel?.[0];
    if (first?.parentStory?.id === story.id) {
      if (first.constructorName === 'InsertionPoint') at = Number(first.index);
      else if (first.constructorName === 'TextFrame' && Number(first.characters.length)) at = Number(first.characters.item(0).index);
    }
  } catch {
    /* no usable selection: start at the top */
  }
  let starts: number[] = [0];
  try {
    const raw = story.paragraphs.everyItem().index;
    starts = (Array.isArray(raw) ? raw : [raw]).map(Number);
  } catch {
    /* empty story */
  }
  const from = paragraphAt(starts, at);
  return { from, to: Math.min(starts.length - 1, from + PREVIEW_PARAGRAPHS - 1) };
}

/**
 * The paragraphs Preview and the sliders work on: the selected text's, or else the preview shown last in this story,
 * or else what Preview would take. Never the whole story of its own accord: a long story set live is slow (ADR-036).
 * Deselecting the text to see the rag (Escape) keeps the preview (2026-11-19).
 */
function workingScope(story: Any): { from: number; to: number } {
  const selected = selectedParagraphs(story);
  if (selected) return selected;
  const p = state.preview;
  return p && p.storyId === story.id ? { from: p.from, to: p.to } : selectionScope(story);
}

/** The story to work on: the selection's, or the live session's when nothing is selected. */
function workingStory(): Any | undefined {
  const story = targetStory();
  if (story) return story;
  return state.live?.story?.isValid ? state.live.story : undefined;
}
const scopeText = (scope: { from: number; to: number }) => (scope.from === scope.to ? `¶ ${scope.from + 1}` : `¶ ${scope.from + 1}–${scope.to + 1}`);

const FROZEN_HINT = 'This story is frozen.';

/** Unfreeze shows only for a frozen story (Apply to whole story freezes; ADR-036). */
function updateUnfreezeButton(story: Any | undefined): void {
  $('unfreeze').style.display = story && isFrozen(story) ? '' : 'none';
}

/**
 * Unfreeze takes the fixed line breaks out again (the characters with the condition "Flatter frozen") and puts the
 * tracking back. The rag is not set live again: Preview, then Apply to whole story (ADR-036).
 */
function unfreeze(): void {
  const story = targetStory();
  if (!story || state.busy || !isFrozen(story)) return;
  try {
    const n = unfreezeFlatter(story);
    updateUnfreezeButton(story);
    state.live = undefined;
    state.failed = undefined;
    $('report').innerHTML = '';
    setStatus(`Unfrozen: ${n} fixed characters removed.`, 'ok', 'Press Preview to adjust the rag, then Apply to whole story.');
  } catch (e) {
    fail(e);
  }
}

/**
 * A note when the story's language is one Flatter's own rules do not cover (anything but German and English): there
 * it uses only InDesign's hyphenation points, which Safe mode leaves out. The dictionary language itself is the
 * typographer's to assign in InDesign (the German / English buttons were removed, 2026-11-26).
 */
function showLanguage(story: Any | undefined): void {
  const name = story ? storyLanguage(story) : '';
  $('langNow').textContent = name && name !== 'mixed' && !knownHyphenLanguage(name) ? `Language: ${name}. Flatter's own rules cover German and English; here it uses InDesign's hyphenation only in Normal mode.` : '';
}

function syncLabels(): void {
  // Aesthetic: strict long/short bands. Functional: one zone, a fluttering edge, Laufweite as a rescue.
  const functional = state.style === 'functional';
  $('styleAesthetic').selected = !functional;
  $('styleFunctional').selected = functional;
  $('bandLabel').textContent = functional ? 'Flutter %' : 'Band %';
  // Phase and the rhythm across paragraphs mean nothing without long and short lines.
  $('phase').disabled = functional;
  $('continuous').disabled = functional;
  $('trackingLabel').textContent = functional ? 'Rescue lines outside the zone' : 'Align line ends exactly';
  $('trackLimits').style.display = checked('tracking') ? '' : 'none';
  $('senseBal').disabled = !checked('sense');
  $('senseLabel').textContent = `Shape ↔ Sense · ${senseHint(num('senseBal'))}`;
}

/** Shape ↔ Sense (ADR-025): what the slider position means. */
function senseHint(v: number): string {
  if (v <= 0) return 'Shape only';
  if (v >= 100) return 'Sense first';
  if (v === 50) return 'Balanced';
  const m = senseMultiplier(v / 100);
  return `×${m < 1 ? m.toFixed(2) : m.toFixed(1)}`;
}

function setStatus(text: string, kind: 'ok' | 'bad' | 'err' | '' = '', meta = '', details = ''): void {
  const el = $('status');
  el.textContent = text;
  el.className = kind;
  $('meta').textContent = meta;
  // Details (the numbers behind a result) stay folded unless opened.
  $('details').textContent = details;
  $('detailsToggle').textContent = state.showDetails ? '▾ Details' : '▸ Details';
  $('detailsToggle').style.display = details ? '' : 'none';
  $('details').style.display = details && state.showDetails ? '' : 'none';
}

function render(r: ApplyResult, ms?: number): void {
  state.lastMs = ms;
  renderResult(r, ms);
}

function renderResult(r: ApplyResult, ms?: number, act = true): void {
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
        : 'InDesign did not set this line (overset or hidden).';
      problems.unshift(reportItem(p.index, m.line, 'err', `${said} Later lines shift too. Press Preview again; if it stays, the line is too tight for its band.`));
    }
    for (const w of p.refused) notes.push(`<sp-body size="XS">¶${p.index + 1}: InDesign refused the hyphenation ${escapeHtml(w)}; re-planned.</sp-body>`);
    for (const u of p.unsupported) problems.push(`<sp-body size="XS" class="bad">¶${p.index + 1}: contains a ${escapeHtml(u)}; Flatter cannot plan around it yet.</sp-body>`);
  }
  const allGood = inRhythm === band && r.linesAsPlanned === r.linesPlanned;
  const functional = state.style === 'functional';
  const edges = functional
    ? worstMiss > 0.05
      ? `Worst line ${worstMiss.toFixed(1)} pt outside the zone.`
      : 'Every line ends inside the zone.'
    : `Long lines end within ${longRange.toFixed(1)} pt of each other, short within ${shortRange.toFixed(1)} pt; worst line ${worstMiss.toFixed(1)} pt off its edge.`;
  const seconds = (t: number) => (t < 1000 ? `${t} ms` : `${(t / 1000).toFixed(1)} s`);
  setStatus(
    `${allGood ? '✓' : '⚠'} ${inRhythm}/${band} lines ${functional ? 'inside the zone' : 'in rhythm'}`,
    allGood ? 'ok' : 'bad',
    `${r.linesAsPlanned}/${r.linesPlanned} set as planned` +
      (r.oversetLines ? ` · ${r.oversetLines} overset` : '') +
      (ms !== undefined ? ` · ${seconds(ms)}` : '') +
      (problems.length ? ` · ${problems.length} ${problems.length === 1 ? 'problem' : 'problems'} listed at the bottom` : ''),
    `${edges} ${strict}/${r.paragraphs.length} paragraphs strict. ${r.trackedLines} lines tracked, ${r.spacedLines} with adjusted word spaces.` +
      (r.oversetLines ? ` ${r.oversetLines} lines overset (not visible, not set).` : '') +
      (state.lastTickMs !== undefined ? ` Last slider tick ${seconds(state.lastTickMs)}.` : ''),
  );
  const parts: string[] = [];
  if (problems.length) parts.push(`<sp-detail>PROBLEMS (${problems.length})</sp-detail>`, ...problems);
  if (hidden) parts.push(`<sp-body size="XS" class="dim">${hidden} more in overset lines (not visible, not listed).</sp-body>`);
  if (notes.length) {
    parts.push(`<sp-body size="XS" class="toggle" id="notesToggle">${state.showNotes ? '▾' : '▸'} Notes (${notes.length})</sp-body>`);
    if (state.showNotes) parts.push(...notes);
  }
  $('report').innerHTML = parts.join('');
  // Redrawn for the Notes toggle: only the report, no re-measure and no alarm again.
  if (!act) return;
  const storyId = state.live?.story.id as number | undefined;
  if (steeringFailed(r) && storyId !== undefined && state.recovery?.storyId !== storyId) {
    // Lines that do not match their measurements look exactly like this, and Recompute cured every case so far
    // (2026-10-27): measure again once, automatically, before raising the alarm.
    state.recovery = { storyId, first: diagnosis(r) };
    setStatus('Lines did not match the plan. Measuring again…', '', '');
    setTimeout(() => recompute('automatic re-measure'), 0);
    return;
  }
  if (state.recovery?.storyId === storyId && !steeringFailed(r)) {
    state.recovery = undefined;
    $('meta').textContent += ' · Measured again automatically.';
  }
  const alarms = compatibilityAlarms(r);
  if (alarms.length) {
    const before = state.recovery?.storyId === storyId ? `\n\nBefore measuring again:\n${state.recovery!.first}` : '';
    showAlarm(
      'InDesign behaved in a way Flatter does not expect. If this keeps happening, an InDesign update may have changed how it sets text.',
      alarms,
      `${alarms.join('\n')}\n\nlines as planned ${r.linesAsPlanned}/${r.linesPlanned}, probe check ${r.probeCheck.empty}/${r.probeCheck.checked} empty, paragraphs ${r.paragraphs.length}\n${diagnosis(r)}${before}`,
    );
  }
}

/** What happened, for the alarm details: the action, the story, the first line that differs, the settings. */
function diagnosis(r: ApplyResult): string {
  const p = r.paragraphs.find((x) => x.mismatch);
  const m = p?.mismatch;
  const end = (t: string) => JSON.stringify(t.trim().slice(-30));
  let units = '';
  try {
    units = String(state.live?.story.parent.viewPreferences.horizontalMeasurementUnits);
  } catch {
    /* not available */
  }
  return [
    `after ${state.lastAction || 'unknown'}, story ${state.live?.story.id ?? '?'}, units ${units}, rounds ${r.rounds}, tracked ${r.trackedLines}, word spaces ${r.spacedLines}, overset ${r.oversetLines}`,
    p && m
      ? `first difference ¶${p.index + 1} line ${m.line + 1}: planned ${end(m.planned.text)} (steer ${m.planned.steerWidth.toFixed(2)} pt), got ${m.got ? `${end(m.got.text)} (${m.got.width.toFixed(2)} pt)` : 'nothing'}`
      : 'no difference recorded',
    `settings ${JSON.stringify(settingsFromUI())}`,
  ].join('\n');
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
    line.insertionPoints.item(0).select();
    line.showText();
  } catch {
    // The text changed since the report; nothing to show.
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fail(e: unknown): void {
  const message = String((e as Error)?.message ?? e);
  if (isUserError(e)) {
    setStatus('Flatter could not finish', 'err', message);
    return;
  }
  setStatus('Flatter could not finish', 'err', 'Unexpected error: see the pink box at the top.');
  showAlarm('Something unexpected went wrong. This can mean an InDesign update changed something Flatter relies on.', [message], String((e as Error)?.stack ?? message));
}

// --- Compatibility alarm -------------------------------------------------------------------------

const CHECK_KEY = 'flatter-selfcheck';

function environment(): string {
  let platform = '';
  try {
    platform = String(require('os').platform());
  } catch {
    /* unknown */
  }
  return `Flatter ${FLATTER_VERSION} · InDesign ${String(app.version)}${platform ? ` · ${platform}` : ''}`;
}

/**
 * The pink box at the top of the panel: only for things that should never happen, so an InDesign
 * update that changes something Flatter relies on is noticed at once.
 */
function showAlarm(summary: string, lines: readonly string[], details: string): void {
  $('alarmText').innerHTML = `<div class="alarm-lead">${escapeHtml(summary)}</div>` + lines.map((l) => `<div class="alarm-line">• ${escapeHtml(l)}</div>`).join('');
  $('alarmDetails').value = `${environment()}\n${new Date().toISOString()}\n\n${details}`;
  $('alarm').style.display = 'block';
  $('scroll').scrollTop = 0;
}

function hideAlarm(): void {
  $('alarm').style.display = 'none';
}

function alarmState(): { visible: boolean; text: string; status: string; version: string } {
  return { visible: $('alarm').style.display !== 'none', text: String($('alarmText').textContent ?? ''), status: String($('status').textContent ?? ''), version: FLATTER_VERSION };
}

function loadCheck(): { indesign: string; plugin: string; ok: boolean } | undefined {
  try {
    return JSON.parse(localStorage.getItem(CHECK_KEY) ?? 'null') ?? undefined;
  } catch {
    return undefined;
  }
}

function storeCheck(r: SelfCheckResult): void {
  try {
    localStorage.setItem(CHECK_KEY, JSON.stringify({ indesign: r.indesign, plugin: FLATTER_VERSION, ok: r.ok, at: new Date().toISOString() }));
  } catch {
    /* no storage: the check runs again next time */
  }
}

/** Run the self-check (a hidden test document, a few seconds). Resolves when done. */
function runSelfCheck(auto: boolean): Promise<SelfCheckResult | undefined> {
  return new Promise((resolve) => {
    if (state.busy) {
      if (!auto) setStatus('Flatter is busy. Try the self-check again in a moment.', 'bad');
      resolve(undefined);
      return;
    }
    state.busy = true;
    setStatus(`Checking Flatter with InDesign ${String(app.version)}…`, '', auto ? 'Once after each update; a few seconds.' : 'A few seconds.');
    setTimeout(() => {
      let result: SelfCheckResult | undefined;
      try {
        result = selfCheck();
        storeCheck(result);
        if (result.ok) {
          hideAlarm();
          setStatus(`✓ Self-check passed on InDesign ${result.indesign}`, 'ok', `${result.checks.length} checks in ${result.ms} ms.`);
        } else {
          const failed = result.checks.filter((c) => !c.ok);
          showAlarm(
            `Flatter's self-check failed on InDesign ${result.indesign}. Something InDesign does has changed, so results may be wrong until Flatter is updated.`,
            failed.map((c) => `${c.name}: ${c.detail}`),
            result.checks.map((c) => `${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: ${c.detail}`).join('\n'),
          );
          setStatus('Self-check failed', 'err', 'See the pink box at the top.');
        }
      } catch (e) {
        showAlarm('The self-check could not run.', [String((e as Error)?.message ?? e)], String((e as Error)?.stack ?? e));
        setStatus('Self-check failed', 'err', 'See the pink box at the top.');
      } finally {
        idle();
      }
      resolve(result);
    }, 50);
  });
}

/** After an InDesign or Flatter update (or a failed check), check again once. */
function selfCheckIfNeeded(): void {
  // Busy with a Preview the user started first: try again shortly instead of skipping until the next start.
  if (state.busy) {
    setTimeout(selfCheckIfNeeded, 3000);
    return;
  }
  const last = loadCheck();
  if (!last || last.indesign !== String(app.version) || last.plugin !== FLATTER_VERSION || !last.ok) void runSelfCheck(true);
}

function copyAlarmDetails(): void {
  const text = String($('alarmDetails').value ?? '');
  try {
    const clip = (navigator as Any).clipboard;
    const done = clip?.setContent ? clip.setContent({ 'text/plain': text }) : clip?.writeText ? clip.writeText(text) : Promise.reject(new Error('no clipboard'));
    Promise.resolve(done).then(
      () => setStatus('Details copied.', 'ok', 'Paste them into a message to the developer.'),
      () => selectAlarmDetails(),
    );
  } catch {
    selectAlarmDetails();
  }
}

function selectAlarmDetails(): void {
  $('alarmDetails').focus();
  $('alarmDetails').select?.();
  setStatus('Press Cmd+C to copy the selected details.', '', '');
}

/** Measure afresh (for example after formatting changed inside a paragraph), then preview. */
function recompute(action: string): void {
  clearMeasureCache();
  state.live = undefined;
  state.failed = undefined;
  apply(action);
}

/**
 * Preview: measure, probe, plan and steer the paragraphs of workingScope live (sliders move them in real time).
 * `fresh` takes the paragraphs from the current selection, as the Preview button does.
 */
function apply(action = 'Preview', fresh = false): void {
  const story = workingStory();
  if (!story) {
    setStatus('Select a text frame first.', 'bad');
    return;
  }
  if (isFrozen(story)) {
    setStatus(FROZEN_HINT, 'bad', 'Press Unfreeze to change the rag.');
    return;
  }
  if (state.busy) return;
  // A drag or verify of the previous session must not run on the new one.
  stopLive();
  state.busy = true;
  state.failed = undefined;
  setStatus('Measuring…', '', 'Text and hyphenation.');
  $('report').innerHTML = '';
  // Let the panel paint the status before the long synchronous work starts.
  const scope = fresh ? selectionScope(story) : workingScope(story);
  setTimeout(() => {
    try {
      const { live, report } = openSession(story, settingsFromUI(), { paragraphs: scope });
      state.lastAction = action;
      state.live = live;
      state.storyId = story.id;
      state.scope = scopeKey(scope);
      state.preview = { storyId: story.id, ...scope };
      render(report, report.ms);
      updateUnfreezeButton(story);
      showTarget(story);
    } catch (e) {
      state.live = undefined;
      state.failed = { storyId: story.id };
      fail(e);
    } finally {
      idle();
    }
  }, 30);
}

// --- Apply to whole story -----------------------------------------------------------------------

const RATE_KEY = 'flatter-rate';
/**
 * Milliseconds per character of the story for Apply to whole story, first run (8 pages of three columns, 62,000
 * characters: 9.7 s with Laufweite, 2026-11-26). The panel learns the real rate on this computer after each run.
 */
const DEFAULT_RATE = { plain: 0.12, tracking: 0.16 };

function loadRate(tracking: boolean): number {
  try {
    const r = JSON.parse(localStorage.getItem(RATE_KEY) ?? 'null');
    const v = Number(r?.[tracking ? 'tracking' : 'plain']);
    if (v > 0) return v;
  } catch {
    /* no storage */
  }
  return tracking ? DEFAULT_RATE.tracking : DEFAULT_RATE.plain;
}

function storeRate(tracking: boolean, msPerChar: number): void {
  if (!(msPerChar > 0)) return;
  try {
    const r = JSON.parse(localStorage.getItem(RATE_KEY) ?? 'null') ?? {};
    const old = Number(r[tracking ? 'tracking' : 'plain']);
    r[tracking ? 'tracking' : 'plain'] = old > 0 ? (old + msPerChar) / 2 : msPerChar;
    localStorage.setItem(RATE_KEY, JSON.stringify(r));
  } catch {
    /* no storage: the default estimate stays */
  }
}

const seconds = (ms: number) => {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.round(s / 60)} min`;
};

/** Paragraph and character count of a story (cheap: two reads). */
function storySize(story: Any): { paragraphs: number; chars: number } {
  try {
    return { paragraphs: Number(story.paragraphs.length), chars: Number(story.characters.length) };
  } catch {
    return { paragraphs: 0, chars: 0 };
  }
}

/** The line under the buttons: how much Apply to whole story will set, and about how long it takes. */
function showEstimate(story: Any | undefined): void {
  if (!story) {
    $('estimate').textContent = '';
    return;
  }
  const { paragraphs, chars } = storySize(story);
  const ms = chars * loadRate(checked('tracking'));
  $('estimate').textContent = paragraphs ? `${paragraphs} ¶ · about ${seconds(ms)}` : '';
}

function showProgress(label: string, fraction: number, done: string, left: string): void {
  $('progress').style.display = '';
  $('progressLabel').textContent = label;
  $('progressBar').style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  $('progressDone').textContent = done;
  $('progressLeft').textContent = left;
}

/** While the whole story is set, no setting can change: what is written is what the panel shows afterwards. */
function lockPanel(locked: boolean): void {
  $('settings').className = locked ? 'locked' : '';
  for (const el of Array.from(document.querySelectorAll('#settings sp-slider, #settings sp-picker, #settings sp-checkbox, #settings sp-action-button') as ArrayLike<Any>)) el.disabled = locked;
  $('preview').disabled = locked;
  $('applyWhole').disabled = locked;
  $('remove').disabled = locked;
  $('unfreeze').disabled = locked;
  if (!locked) {
    $('progress').style.display = 'none';
    // Controls that depend on others (Phase with the functional style, Shape ↔ Sense) get their state back.
    syncLabels();
  }
}

/**
 * Apply to whole story (ADR-036): every paragraph with the panel's settings, written as fixed line breaks (frozen),
 * step by step so the progress bar redraws and Cancel works. InDesign stays usable between steps.
 */
function applyWhole(): void {
  const story = workingStory();
  if (!story) {
    setStatus('Select a text frame first.', 'bad');
    return;
  }
  if (state.busy) return;
  stopLive();
  state.busy = true;
  state.cancelWhole = false;
  const settings = settingsFromUI();
  const tracking = !!settings.tracking?.enabled;
  const { chars } = storySize(story);
  const estimate = Math.max(1000, chars * loadRate(tracking));
  const t0 = Date.now();
  let tMeasured = 0;
  lockPanel(true);
  setStatus('', '');
  $('report').innerHTML = '';
  showProgress('Measuring the text…', 0, '', `about ${seconds(estimate)}`);
  const finish = () => {
    state.job = undefined;
    lockPanel(false);
    try {
      updateUnfreezeButton(story);
      showTarget(story);
    } catch {
      /* the story is gone (document closed, frames deleted) */
    }
    idle();
  };
  const step = () => {
    const job = state.job;
    if (!job) return;
    try {
      if (state.cancelWhole) {
        const back = job.cancel();
        forgetSession();
        finish();
        setStatus('Cancelled', '', back ? 'The story is as it was before.' : 'The line breaks were taken out again; press Remove to restore the original paragraph settings.');
        return;
      }
      const done = job.step();
      const p = job.progress();
      if (done) {
        const r = job.result!;
        storeRate(tracking, (Date.now() - t0) / Math.max(1, chars));
        forgetSession();
        state.storyId = story.id;
        finish();
        const missed = r.missed ? ` ${r.missed} ${r.missed === 1 ? 'line' : 'lines'} did not fit and broke early.` : '';
        setStatus(`Whole story set and frozen in ${((Date.now() - t0) / 1000).toFixed(1)} s`, r.missed ? 'bad' : 'ok', `${r.paragraphs} paragraphs, ${r.lines} lines.${missed} Cmd+Z or Unfreeze to change it.`, `${r.breaks} fixed line breaks, ${r.hyphens} with a hyphen.`);
        return;
      }
      if (!tMeasured) tMeasured = Date.now() - t0;
      // Measuring is one step; the bar then follows the write chunks, the time left their average speed.
      const elapsedWrite = Date.now() - t0 - tMeasured;
      const share = tMeasured / Math.max(tMeasured + 1, estimate);
      const writeShare = p.total ? p.done / p.total : 1;
      const left = p.done ? (elapsedWrite / p.done) * (p.total - p.done) : Math.max(0, estimate - tMeasured);
      showProgress(p.phase === 'checking' ? 'Checking the lines…' : 'Writing the line breaks…', share + (1 - share) * writeShare, `${Math.round(writeShare * 100)} %`, `about ${seconds(left)} left`);
    } catch (e) {
      forgetSession();
      finish();
      fail(e);
      return;
    }
    setTimeout(step, 0);
  };
  // Let the panel paint the bar before the first (longest) step starts.
  setTimeout(() => {
    try {
      state.job = startWholeStory(story, settings);
    } catch (e) {
      forgetSession();
      finish();
      fail(e);
      return;
    }
    step();
  }, 30);
}

function remove(): void {
  const story = workingStory();
  if (!story) {
    setStatus('Select a text frame first.', 'bad');
    return;
  }
  if (state.busy) return;
  // A slider tick or verify still waiting would set the rag again right after it was removed.
  stopLive();
  try {
    const r = removeFlatter(story);
    forgetSession();
    updateUnfreezeButton(story);
    const lost = r.paragraphsNotFound ? ` ${r.paragraphsNotFound} could not be matched (paragraph deleted or its start rewritten) and stay as they are.` : '';
    setStatus('Removed', r.paragraphsNotFound ? 'bad' : '', `${r.settingsRestored} settings restored.${lost}`);
    $('report').innerHTML = '';
    showTarget(story);
  } catch (e) {
    fail(e);
  }
}

/** Slider or option changed. Debounced; the first tick of a drag opens the undo step. */
function onInput(): void {
  syncLabels();
  if (state.tickTimer) clearTimeout(state.tickTimer);
  state.tickTimer = setTimeout(tick, DEBOUNCE_MS);
}

function tick(): void {
  const story = workingStory();
  if (!story) return;
  if (state.busy) {
    state.pending = true;
    return;
  }
  // After a failed Apply, sliders do not retry (each retry would freeze InDesign again).
  if (state.failed && state.failed.storyId === story.id) return;
  if (isFrozen(story)) {
    setStatus(FROZEN_HINT, 'bad', 'Press Unfreeze to change the rag.');
    return;
  }
  try {
    if (!state.live || state.storyId !== story.id || !state.live.story.isValid || state.scope !== scopeKey(workingScope(story))) {
      apply(state.live && state.storyId === story.id ? 'slider on another selection' : 'slider on a new story');
      return;
    }
    if (liveIsStale(state.live)) {
      // The text or its formatting changed since Flatter measured it: measure again first.
      state.live = undefined;
      apply('re-measure after an edit (slider)');
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
    // For example after Cmd+Z took back the teeth: the session no longer matches the document (2026-11-26, audit).
    sessionFailed(story, e);
  }
}

/** A slider move or verify failed: forget the session and stop retrying on this story until Preview is pressed. */
function sessionFailed(story: Any, e: unknown): void {
  stopLive();
  state.live = undefined;
  state.failed = { storyId: Number(story?.id) };
  fail(e);
}

function verify(): void {
  if (!state.live) return;
  if (liveIsStale(state.live)) {
    state.live = undefined;
    apply('re-measure after an edit (verify)');
    return;
  }
  if (state.draft) {
    // Show that something is happening, then set the word spaces (about a second in a long story).
    setStatus('Setting word spaces…', '', '');
    setTimeout(() => {
      if (!state.live || state.busy) return;
      try {
        if (state.draft) liveUpdate(state.live, settingsFromUI(), false);
        state.draft = false;
      } catch (e) {
        sessionFailed(state.live?.story, e);
        return;
      }
      verify();
    }, 20);
    return;
  }
  try {
    const t0 = Date.now();
    const r = liveVerify(state.live);
    state.lastAction = 'slider';
    state.dragging = false;
    render(r, Date.now() - t0);
  } catch (e) {
    sessionFailed(state.live?.story, e);
  }
}

/** The first few words of a story (reads only its start: the whole text of a long story on every selection is slow). */
function storyStart(story: Any): string {
  let text = '';
  try {
    const n = Number(story.characters.length);
    const c = n ? story.insertionPoints.itemByRange(0, Math.min(n, 120)).texts.item(0).contents : '';
    text = Array.isArray(c) ? c.join('') : String(c);
  } catch {
    /* empty story */
  }
  return text.replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ');
}

/** The story line: its first words and the paragraphs Preview works on; the estimate under the buttons. */
function showTarget(story: Any): void {
  const words = storyStart(story);
  const preview = state.preview?.storyId === story.id ? state.preview : undefined;
  const selected = selectedParagraphs(story);
  const scope = selected ? `Selected ${scopeText(selected)}` : preview ? `Preview on ${scopeText(preview)}` : `Preview takes ${scopeText(selectionScope(story))}`;
  $('target').textContent = `${words}… · ${scope}`;
  showEstimate(story);
}

function onSelectionChanged(): void {
  // Flatter's own hidden measuring document opens and closes while it works.
  if (state.busy) return;
  const story = targetStory();
  // Nothing selected (Escape to look at the rag): the panel keeps showing the story it works on.
  if (!story && state.live?.story?.isValid) {
    showTarget(state.live.story);
    return;
  }
  if (!story) {
    $('target').textContent = 'Select a text frame or put the cursor in text.';
    showEstimate(undefined);
    showLanguage(undefined);
    updateUnfreezeButton(undefined);
    return;
  }
  showTarget(story);
  showLanguage(story);
  updateUnfreezeButton(story);
  if (state.storyId !== story.id) {
    state.live = undefined;
    state.failed = undefined;
    state.preview = undefined;
    state.storyId = story.id;
    const stored = storedSettings(story);
    if (stored && isFrozen(story)) {
      settingsToUI(stored);
      setStatus(FROZEN_HINT, '', 'Press Unfreeze to change the rag.');
    } else if (stored) {
      settingsToUI(stored);
      setStatus('Flatter is on this story.', '', 'Press Preview to adjust it.');
    } else {
      setStatus('', '');
      $('report').innerHTML = '';
    }
  }
}

/**
 * The selection listener, registered once per panel start. A panel reloaded (UXP Developer Tool) or updated without an
 * InDesign restart left its old listener behind, and InDesign then showed "Script context is not available anymore"
 * on every selection. Each listener carries a label naming its owner (the release or the dev build), so a new start
 * removes its own old one and never another plugin's (listener ids start again after a restart, 2026-11-26).
 */
function listenForSelection(): void {
  const owner = typeof FLATTER_DEV !== 'undefined' && FLATTER_DEV ? 'flatter-dev' : 'flatter';
  try {
    const raw = app.eventListeners.everyItem().getElements();
    for (const l of Array.isArray(raw) ? raw : [raw]) {
      if (l?.isValid && String(l.eventType) === 'afterSelectionChanged' && l.extractLabel('flatter-owner') === owner) l.remove();
    }
  } catch {
    /* nothing to remove */
  }
  const listener = app.addEventListener('afterSelectionChanged', onSelectionChanged);
  try {
    listener.insertLabel('flatter-owner', owner);
  } catch {
    /* the next start cannot clean up; harmless */
  }
}

function init(): void {
  for (const id of ['zone', 'band', 'maxHyph', 'senseBal', 'trackMax', 'wordMax']) {
    $(id).addEventListener('input', onInput);
    $(id).addEventListener('change', onInput);
  }
  for (const id of ['phase', 'mode', 'hyphenation', 'sense', 'continuous', 'tracking', 'showBands']) $(id).addEventListener('change', onInput);
  // The estimate depends on Laufweite (more writes).
  $('tracking').addEventListener('change', () => showEstimate(workingStory()));
  // Preview measures afresh each time (it was Recompute too): five paragraphs measure in well under a second.
  $('preview').addEventListener('click', () => {
    if (state.busy) return;
    state.recovery = undefined;
    clearMeasureCache();
    state.live = undefined;
    state.failed = undefined;
    apply('Preview', true);
  });
  $('remove').addEventListener('click', remove);
  $('applyWhole').addEventListener('click', applyWhole);
  $('cancelWhole').addEventListener('click', () => {
    state.cancelWhole = true;
    $('progressLabel').textContent = 'Cancelling…';
  });
  const setStyle = (style: 'aesthetic' | 'functional') => {
    if (state.style === style) return;
    state.style = style;
    onInput();
  };
  $('styleAesthetic').addEventListener('click', () => setStyle('aesthetic'));
  $('styleFunctional').addEventListener('click', () => setStyle('functional'));
  $('alarmRecheck').addEventListener('click', () => void runSelfCheck(false));
  $('alarmClose').addEventListener('click', hideAlarm);
  $('alarmCopy').addEventListener('click', copyAlarmDetails);
  $('brand').textContent = `Flatter v. ${FLATTER_VERSION}`;
  setTimeout(selfCheckIfNeeded, 1500);
  $('unfreeze').addEventListener('click', unfreeze);
  $('detailsToggle').addEventListener('click', () => {
    state.showDetails = !state.showDetails;
    $('detailsToggle').textContent = state.showDetails ? '▾ Details' : '▸ Details';
    $('details').style.display = state.showDetails && $('details').textContent ? '' : 'none';
  });
  $('report').addEventListener('click', (e: Any) => {
    let el = e.target;
    if (el?.id === 'notesToggle' || el?.parentElement?.id === 'notesToggle') {
      state.showNotes = !state.showNotes;
      if (state.lastResult) renderResult(state.lastResult, state.lastMs, false);
      return;
    }
    while (el && el.id !== 'report' && !el.dataset?.l) el = el.parentElement;
    if (el?.dataset?.l !== undefined) jumpTo(Number(el.dataset.p), Number(el.dataset.l));
  });
  listenForSelection();
  syncLabels();
  onSelectionChanged();
  if (typeof FLATTER_DEV !== 'undefined' && FLATTER_DEV) startDevChannel({
      runSelfCheck,
      showAlarm,
      alarmState,
      setTarget: (story: Any) => {
        devStory = story;
        state.live = undefined;
        state.recovery = undefined;
      },
      apply: () => apply(),
      verify: () => verify(),
      busy: () => state.busy,
      result: () => (state.lastResult ? { asPlanned: `${state.lastResult.linesAsPlanned}/${state.lastResult.linesPlanned}`, action: state.lastAction, meta: String($('meta').textContent ?? '') } : undefined),
    });
}

// The panel starts whatever entrypoints.setup does. 0.6.3 and 0.6.4 gave setup a plugin lifecycle hook (destroy, to
// remove the selection listener on unload) and the panel never started in InDesign 2027: no listener, Apply did
// nothing (2026-11-18). Listeners left behind by reloads only happen with the UXP Developer Tool.
try {
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
} catch {
  /* the panel works without the entry point setup */
}
init();
