/**
 * Flatter panel (plan §6.3, §6.4). Live loop: slider input → debounce → plan
 * on cached measurements → move teeth (one undo step per drag); after a pause,
 * read back and verify.
 */
import { modeLabel, senseMultiplier, type Violation } from '@flatter/core';
import {
  clearMeasureCache,
  liveUpdate,
  liveVerify,
  openSession,
  removeFlatter,
  storedSettings,
  setStoryLanguage,
  storyLanguage,
  freezeFlatter,
  setWholeStory,
  unfreezeFlatter,
  liveIsStale,
  isFrozen,
  selfCheck,
  compatibilityAlarms,
  steeringFailed,
  isUserError,
  type SelfCheckResult,
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
  failed?: { storyId: number; message: string };
  storyId?: number;
  dragging: boolean;
  tickTimer?: ReturnType<typeof setTimeout>;
  verifyTimer?: ReturnType<typeof setTimeout>;
  lastTickMs?: number;
  lastResult?: ApplyResult;
  /** The notes section of the report is open. */
  showNotes?: boolean;
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
}
const state: PanelState = { dragging: false, busy: false, pending: false, style: 'aesthetic', lastAction: '' };

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
    senseBalance: num('senseBal') / 100,
    continuous: checked('continuous'),
    showBands: checked('showBands'),
    style: state.style,
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
  $('senseBal').value = (s.senseBalance ?? 0.5) * 100;
  if (s.continuous !== undefined) $('continuous').checked = s.continuous;
  if (s.showBands !== undefined) $('showBands').checked = s.showBands;
  state.style = s.style ?? 'aesthetic';
  $('tracking').checked = !!s.tracking?.enabled;
  if (s.tracking?.max !== undefined) $('trackMax').value = s.tracking.max;
  if (s.wordSpaceShare !== undefined) $('wordMax').value = Math.round(s.wordSpaceShare * 100);
  syncLabels();
}

/** The story of the current selection: a text frame, or text / insertion point inside one. */
/** Dev channel only: a story to work on instead of the selection (in a hidden throwaway document). */
let devStory: Any | undefined;

export function targetStory(): Any | undefined {
  if (devStory?.isValid) return devStory;
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
    const paragraphOf = (k: number) => {
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid]! <= k) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    };
    return { from: paragraphOf(a), to: paragraphOf(b) };
  } catch {
    return undefined;
  }
}

const scopeKey = (scope: { from: number; to: number } | undefined) => (scope ? `${scope.from}-${scope.to}` : '');

/**
 * The paragraphs Apply and the sliders work on: the selected text's, or else the preview applied last in this story.
 * Deselecting the text to see the rag (Escape) must not turn a slider move into the whole story (2026-11-19).
 */
function workingScope(story: Any): { from: number; to: number } | undefined {
  const selected = selectedParagraphs(story);
  if (selected) return selected;
  const p = state.preview;
  return p && p.storyId === story.id ? { from: p.from, to: p.to } : undefined;
}

/** The story to work on: the selection's, or the live session's when nothing is selected. */
function workingStory(): Any | undefined {
  const story = targetStory();
  if (story) return story;
  return state.live?.story?.isValid ? state.live.story : undefined;
}
const scopeText = (scope: { from: number; to: number }) => (scope.from === scope.to ? `paragraph ${scope.from + 1}` : `paragraphs ${scope.from + 1}–${scope.to + 1}`);

const FROZEN_HINT = 'This story is frozen: its line breaks are fixed in the text.';

/** Freeze / Unfreeze button: label for the target story; off when Flatter is not on the story. */
function updateFreezeButton(story: Any | undefined): void {
  const frozen = !!story && isFrozen(story);
  $('freeze').textContent = frozen ? 'Unfreeze' : 'Freeze';
  $('freeze').disabled = !story || (!frozen && !storedSettings(story));
}

let freezeArmed: ReturnType<typeof setTimeout> | undefined;

/**
 * Freeze fixes the current line breaks in the text (forced line breaks and hyphens, tagged with the
 * condition "Flatter frozen") for hand-off; Unfreeze takes them out and applies the live rag again.
 * Freezing asks for a second click, because editing frozen text needs Unfreeze first.
 */
function freezeToggle(): void {
  const story = targetStory();
  if (!story || state.busy) return;
  if (isFrozen(story)) {
    try {
      const n = unfreezeFlatter(story);
      updateFreezeButton(story);
      state.live = undefined;
      state.failed = undefined;
      // A long story is not set live again by itself (that is what made long stories slow): preview a selection,
      // or set the whole story again.
      const long = Number(story.paragraphs.length) > 40;
      if (long && !selectedParagraphs(story)) {
        setStatus(`Unfrozen: ${n} fixed characters removed.`, 'ok', 'Select a few paragraphs and press Apply to try settings on them, then Set whole story.');
        return;
      }
      setStatus(`Unfrozen: ${n} fixed characters removed.`, 'ok', 'Applying the rag again…');
      apply('Unfreeze');
    } catch (e) {
      fail(e);
    }
    return;
  }
  if (!freezeArmed) {
    setStatus('Freeze fixes every line break in the text.', 'bad', 'For hand-off of the InDesign file. Afterwards the text cannot reflow: to edit it, press Unfreeze first. Click Freeze again to confirm.');
    $('freeze').textContent = 'Confirm Freeze';
    freezeArmed = setTimeout(() => {
      freezeArmed = undefined;
      updateFreezeButton(targetStory());
    }, 6000);
    return;
  }
  clearTimeout(freezeArmed);
  freezeArmed = undefined;
  try {
    const r = freezeFlatter(story);
    state.live = undefined;
    updateFreezeButton(story);
    $('report').innerHTML = '';
    const ok = r.linesAfter === r.linesBefore;
    setStatus(
      ok ? `Frozen: ${r.breaks} line breaks fixed${r.hyphens ? `, ${r.hyphens} hyphens` : ''}.` : `Frozen, but the line count changed (${r.linesBefore} → ${r.linesAfter}).`,
      ok ? 'ok' : 'bad',
      'The teeth and strips are gone; the breaks are characters with the condition "Flatter frozen" (Window → Type & Tables → Conditional Text). Press Unfreeze to change the rag again.',
    );
  } catch (e) {
    fail(e);
  }
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
    apply('language change');
  } else {
    setStatus(`Language set to ${LANGUAGES[lang]} for ${stories.length === 1 ? 'this story' : `${stories.length} stories`}.`, 'ok', 'Press Apply to set the rag.');
  }
  if (others) $('meta').textContent += ` ${others} other selected ${others === 1 ? 'story uses' : 'stories use'} Flatter: select ${others === 1 ? 'it' : 'each'} and press Recompute.`;
}

function syncLabels(): void {
  const share = num('zone') / 100;
  $('modeTag').textContent = modeLabel(share, 1).toUpperCase();
  // Aesthetic: strict long/short bands. Functional: one zone, a fluttering edge, Laufweite as a rescue.
  const functional = state.style === 'functional';
  $('styleAesthetic').selected = !functional;
  $('styleFunctional').selected = functional;
  $('styleHint').textContent = functional
    ? 'Reading first: lines end anywhere in the Flatterzone, break at Sinneinheiten and pauses, no staircases.'
    : 'Strict long, short, long, short.';
  $('bandLabel').textContent = functional ? 'Flutter (% of zone)' : 'Band (% of zone)';
  $('phase').disabled = functional;
  $('continuous').disabled = functional;
  $('continuousHint').textContent = functional ? 'Not used in the functional style.' : 'Continue long/short from one paragraph into the next.';
  $('legendAesthetic').style.display = functional ? 'none' : '';
  $('legendFunctional').style.display = functional ? '' : 'none';
  $('trackingLabel').textContent = functional ? 'Rescue lines with Laufweite' : 'Align line ends exactly';
  $('trackingHint').textContent = functional
    ? 'Letter tracking and word spaces only for lines that would end outside the zone, within the limits below.'
    : 'Per line: letter tracking and word spaces, within the limits below.';
  $('trackMax').disabled = !checked('tracking');
  $('wordMax').disabled = !checked('tracking');
  $('senseBal').disabled = !checked('sense');
  $('senseHint').textContent = senseHint(num('senseBal'));
}

/** Shape ↔ Sense (ADR-025): what the slider position means. */
function senseHint(v: number): string {
  if (v <= 0) return 'Shape only: units of meaning are ignored.';
  if (v >= 100) return 'Sense first: a unit of meaning is never broken, even if the rhythm gives way.';
  if (v === 50) return 'Balanced: units of meaning weigh as usual.';
  const m = senseMultiplier(v / 100);
  return `Units of meaning weigh ×${m < 1 ? m.toFixed(2) : m.toFixed(1)}${v > 50 ? ': the edge may give a little.' : ': the shape comes first.'}`;
}

function setStatus(text: string, kind: 'ok' | 'bad' | 'err' | '' = '', meta = ''): void {
  const el = $('status');
  el.textContent = text;
  el.className = kind;
  $('meta').textContent = meta;
}

function render(r: ApplyResult, ms?: number): void {
  renderResult(r, ms);
  // A preview on a few paragraphs says so, after Apply and after every slider move.
  const p = state.preview;
  if (p && state.scope) $('meta').textContent = `Preview on ${scopeText(p)} (select other text to preview others). Set whole story sets every paragraph with these settings. ${$('meta').textContent}`;
}

function renderResult(r: ApplyResult, ms?: number): void {
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
    `${allGood ? '✓' : '⚠'} ${inRhythm}/${band} visible lines ${state.style === 'functional' ? 'inside the Flatterzone' : 'in rhythm'}`,
    allGood ? 'ok' : 'bad',
    (state.style === 'functional'
      ? worstMiss > 0.05
        ? `Worst line ${worstMiss.toFixed(1)} pt outside the Flatterzone · `
        : 'Every line ends inside the Flatterzone · '
      : `Edges: long lines end within ${longRange.toFixed(1)} pt of each other, short within ${shortRange.toFixed(1)} pt; worst line ${worstMiss.toFixed(1)} pt off its edge · `) +
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
  const storyId = state.live?.story.id as number | undefined;
  if (steeringFailed(r) && storyId !== undefined && state.recovery?.storyId !== storyId) {
    // Lines that do not match their measurements look exactly like this, and Recompute cured every case so far
    // (2026-10-27): measure again once, automatically, before raising the alarm.
    state.recovery = { storyId, first: diagnosis(r) };
    setStatus('Lines did not match the plan. Measuring the story again…', '', '');
    setTimeout(() => recompute('automatic re-measure'), 0);
    return;
  }
  if (state.recovery?.storyId === storyId && !steeringFailed(r)) {
    state.recovery = undefined;
    $('meta').textContent += ' · Measured again automatically: the lines did not match the measurements.';
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
  const message = String((e as Error)?.message ?? e);
  if (isUserError(e)) {
    setStatus('Flatter could not set this story', 'err', `${message} Nothing was changed.`);
    return;
  }
  setStatus('Flatter could not set this story', 'err', 'An unexpected error: see the pink box at the top. Nothing was changed.');
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
export function showAlarm(summary: string, lines: readonly string[], details: string): void {
  $('alarmText').innerHTML = `<div class="alarm-lead">${escapeHtml(summary)}</div>` + lines.map((l) => `<div class="alarm-line">• ${escapeHtml(l)}</div>`).join('');
  $('alarmDetails').value = `${environment()}\n${new Date().toISOString()}\n\n${details}`;
  $('alarm').style.display = 'block';
  $('scroll').scrollTop = 0;
}

function hideAlarm(): void {
  $('alarm').style.display = 'none';
}

export function alarmState(): { visible: boolean; text: string; status: string; version: string } {
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
export function runSelfCheck(auto: boolean): Promise<SelfCheckResult | undefined> {
  return new Promise((resolve) => {
    if (state.busy) {
      if (!auto) setStatus('Flatter is busy. Try the self-check again in a moment.', 'bad');
      resolve(undefined);
      return;
    }
    state.busy = true;
    setStatus(`Checking Flatter with InDesign ${String(app.version)}…`, '', auto ? 'This runs once after each InDesign or Flatter update and takes a few seconds.' : 'Takes a few seconds.');
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
        state.busy = false;
      }
      resolve(result);
    }, 50);
  });
}

/** After an InDesign or Flatter update (or a failed check), check again once. */
function selfCheckIfNeeded(): void {
  const last = loadCheck();
  if (!last || last.indesign !== String(app.version) || last.plugin !== FLATTER_VERSION || !last.ok) void runSelfCheck(true);
}

function copyAlarmDetails(): void {
  const text = String($('alarmDetails').value ?? '');
  try {
    const clip = (navigator as Any).clipboard;
    if (clip?.setContent) void clip.setContent({ 'text/plain': text });
    else if (clip?.writeText) void clip.writeText(text);
    else throw new Error('no clipboard');
    setStatus('Details copied.', 'ok', 'Paste them into a message to the developer.');
  } catch {
    $('alarmDetails').focus();
    $('alarmDetails').select?.();
    setStatus('Press Cmd+C to copy the selected details.', '', '');
  }
}

/** Measure afresh (for example after formatting changed inside a paragraph), then apply. */
function recompute(action: string): void {
  clearMeasureCache();
  state.live = undefined;
  state.failed = undefined;
  apply(action);
}

/** Apply: measure, probe, plan, steer. Shows "Preparing…" first (it can take seconds on long stories). */
function apply(action = 'Apply'): void {
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
  state.busy = true;
  state.failed = undefined;
  setStatus('Preparing…', '', 'Measuring the text and checking hyphenation. This happens once per story.');
  $('report').innerHTML = '';
  // Let the panel paint the status before the long synchronous work starts.
  const scope = workingScope(story);
  setTimeout(() => {
    try {
      const { live, report } = openSession(story, settingsFromUI(), scope ? { paragraphs: scope } : {});
      state.lastAction = action;
      state.live = live;
      state.storyId = story.id;
      state.scope = scopeKey(scope);
      state.preview = scope ? { storyId: story.id, ...scope } : undefined;
      render(report, report.ms);
      updateFreezeButton(story);
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

/**
 * Set whole story: every paragraph with the panel's settings, written as fixed line breaks in one go (frozen), without
 * the live steering that makes long stories slow (2026-11-19).
 */
function setWhole(): void {
  const story = workingStory();
  if (!story) {
    setStatus('Select a text frame first.', 'bad');
    return;
  }
  if (state.busy) return;
  state.busy = true;
  setStatus('Setting the whole story…', '', 'Measuring and planning every paragraph, then writing the line breaks. On a long story this takes a while, and InDesign does not respond until it is done.');
  $('report').innerHTML = '';
  setTimeout(() => {
    try {
      const r = setWholeStory(story, settingsFromUI());
      state.live = undefined;
      state.scope = undefined;
      state.preview = undefined;
      state.failed = undefined;
      state.storyId = story.id;
      updateFreezeButton(story);
      const missed = r.missed ? ` ${r.missed} ${r.missed === 1 ? 'line' : 'lines'} did not fit and broke early.` : '';
      setStatus(`Whole story set and frozen in ${(r.ms / 1000).toFixed(1)} s.`, r.missed ? 'bad' : 'ok', `${r.paragraphs} paragraphs, ${r.lines} lines, ${r.breaks} fixed line breaks (${r.hyphens} with a hyphen).${missed} To change it: Undo, or Unfreeze.`);
    } catch (e) {
      fail(e);
    } finally {
      state.busy = false;
    }
  }, 30);
}

function remove(): void {
  const story = targetStory();
  if (!story) return;
  try {
    const r = removeFlatter(story);
    state.live = undefined;
    state.preview = undefined;
    updateFreezeButton(story);
    const lost = r.paragraphsNotFound ? ` ${r.paragraphsNotFound} stored ${r.paragraphsNotFound === 1 ? 'setting' : 'settings'} of paragraphs that were deleted or whose beginning was rewritten could not be matched and were left as they are.` : '';
    setStatus('Removed', r.paragraphsNotFound ? 'bad' : '', `${r.teethRemoved} teeth removed, ${r.settingsRestored} settings restored.${lost}`);
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
    fail(e);
  }
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
    state.lastAction = 'slider';
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
    updateFreezeButton(undefined);
    return;
  }
  const words = String(story.contents).replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ');
  const selected = selectedParagraphs(story);
  const preview = state.preview?.storyId === story.id ? state.preview : undefined;
  $('target').textContent = selected ? `Story: ${words}… · Selected: ${scopeText(selected)}` : preview ? `Story: ${words}… · Preview: ${scopeText(preview)}` : `Story: ${words}…`;
  showLanguage(story);
  updateFreezeButton(story);
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
      setStatus('Flatter is applied to this story.', '', 'Move a slider or press Recompute to work on it.');
    } else {
      setStatus('', '');
      $('report').innerHTML = '';
    }
  }
}

function init(): void {
  for (const id of ['zone', 'band', 'maxHyph', 'senseBal', 'trackMax', 'wordMax']) {
    $(id).addEventListener('input', onInput);
    $(id).addEventListener('change', onInput);
  }
  for (const id of ['phase', 'mode', 'hyphenation', 'sense', 'continuous', 'tracking', 'showBands']) $(id).addEventListener('change', onInput);
  $('apply').addEventListener('click', () => apply());
  $('recompute').addEventListener('click', () => {
    state.recovery = undefined;
    recompute('Recompute');
  });
  $('apply').addEventListener('click', () => {
    state.failed = undefined;
  });
  $('remove').addEventListener('click', remove);
  $('setWhole').addEventListener('click', setWhole);
  const setStyle = (style: 'aesthetic' | 'functional') => {
    if (state.style === style) return;
    state.style = style;
    onInput();
  };
  $('styleAesthetic').addEventListener('click', () => setStyle('aesthetic'));
  $('styleFunctional').addEventListener('click', () => setStyle('functional'));
  $('selfcheck').addEventListener('click', () => void runSelfCheck(false));
  $('alarmRecheck').addEventListener('click', () => void runSelfCheck(false));
  $('alarmClose').addEventListener('click', hideAlarm);
  $('alarmCopy').addEventListener('click', copyAlarmDetails);
  $('version').textContent = `Flatter ${FLATTER_VERSION}`;
  $('brandVersion').textContent = FLATTER_VERSION;
  setTimeout(selfCheckIfNeeded, 1500);
  $('freeze').addEventListener('click', freezeToggle);
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
