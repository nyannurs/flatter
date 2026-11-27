/**
 * Public InDesign operations: check and fix settings, apply, remove. Each runs
 * as one undo step ("Flatter: …") through app.doScript (spike S8).
 */
import { FlatterUserError } from './errors.ts';
import { bakeChunks, insertedLength, type BreakWrite, type TrackingWrite } from './bake-chunks.ts';
import { DEFAULT_MAX_ROUNDS, FlatterSession, type ApplyResult, type ApplySettings } from './apply.ts';
import { asArray, CONTROL_LAYER, controlLayer, DomPort, indesign, localNames, readLanguageRuns, removeBands, TOOTH_LABEL, type Any } from './dom-port.ts';
import { paragraphLanguages, rememberLocale } from './languages.ts';
import { alignPrints, paragraphAt, paragraphPrint, remapByParagraph } from './paragraph-match.ts';
import { checkParagraph, checkStory, FIXED_FROM_AUTO, keepsAlignment, REQUIRED_SETTINGS, type SettingIssue, type SettingValue } from './settings.ts';

export const STORY_LABEL = 'flatter';

export interface StoryState {
  version: 1;
  settings: ApplySettings;
  /** Original attribute values per paragraph, restored by Remove. */
  originals: Record<string, Record<string, SettingValue>>;
  /** Story-level originals (optical margin alignment, frames ignoring wrap). */
  storyOriginals: { opticalMarginAlignment?: boolean; ignoreWrap?: Record<string, boolean> };
  /** Base tracking per paragraph before the tracking rescue touched it. */
  tracking?: Record<string, number>;
  appliedAt: string;
  /** Set while the story is frozen (Freeze, plan §6.6): its line breaks are fixed characters. */
  frozen?: { at: string; breaks: number; hyphens: number };
  /**
   * Fingerprint of every paragraph when the record was saved (paragraph-match.ts): the keys of `originals` and
   * `tracking` are paragraph numbers, and paragraphs added or deleted since shift them; readCurrentState maps them back.
   */
  prints?: string[];
}

export interface Check {
  paragraphIssues: SettingIssue[];
  storyIssues: string[];
}

/** Turn whatever the DOM returns (enum objects, numbers, strings) into a comparable value. */
export function settingValue(v: unknown): SettingValue {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return v;
  }
  if (v && typeof v === 'object') {
    const name = (v as { name?: unknown }).name;
    if (typeof name === 'string') return name;
    return String(v);
  }
  return String(v);
}

/**
 * After a failed operation, undo whatever it changed before failing (its own undo step only),
 * so a story is never left with fixed settings but no record of the originals.
 */
function rollBack(name: string, inDoc?: Any): void {
  try {
    // The story's own document: the self-check works in a hidden one while the user's document is active (2026-11-26).
    const doc = inDoc ?? indesign().app.activeDocument;
    if (doc && String(doc.undoName) === name) doc.undo();
  } catch {
    /* nothing to undo */
  }
}

/**
 * Run with every measurement in points, whatever the document's units, and restore the user's setting.
 * Flatter's widths, teeth and tracking are all in points; in a millimetre document InDesign otherwise
 * reports positions in millimetres (found in the user's TestFile, 2026-10-17).
 */
export function inPoints<T>(fn: () => T): T {
  const id = indesign();
  const prefs = id.app.scriptPreferences;
  const before = prefs.measurementUnit;
  if (before === id.MeasurementUnits.POINTS) return fn();
  prefs.measurementUnit = id.MeasurementUnits.POINTS;
  try {
    return fn();
  } finally {
    prefs.measurementUnit = before;
  }
}

/** One undo step of its own; on failure whatever it changed is rolled back. */
function undoable<T>(name: string, fn: () => T, doc?: Any): T {
  return undoableMode(name, 'entire', fn, doc);
}

/** The settings Flatter needs, checked for the whole story or only paragraphs from..to (a preview). */
export function checkSettings(story: Any, only?: { from: number; to: number }): Check {
  localNames();
  return inPoints(() => readSettings(story, only));
}

function readSettings(story: Any, only?: { from: number; to: number }): Check {
  const doc = story.parent;
  const paras = story.paragraphs;
  const issues: SettingIssue[] = [];
  const alignments = asArray(paras.everyItem().justification).map(String);
  // The language most letters carry decides the language-dependent settings, not the first letter's.
  const runs = readLanguageRuns(story);
  const starts = asArray(paras.everyItem().index).map(Number);
  const text = Array.from(String(story.contents));
  const first = only ? Math.max(0, only.from) : 0;
  const last = only ? Math.min(paras.length - 1, only.to) : paras.length - 1;
  for (let p = first; p <= last; p++) {
    // Centred paragraphs are left alone (ADR-026).
    if (keepsAlignment(alignments[p]!)) continue;
    const para = paras.item(p);
    const current: Record<string, SettingValue> = {};
    for (const s of REQUIRED_SETTINGS) {
      try {
        current[s.attribute] = enumName(settingValue(para[s.attribute]), s.attribute);
      } catch {
        /* attribute missing in this version */
      }
    }
    const { language } = paragraphLanguages(runs, text.slice(starts[p]!, starts[p + 1] ?? text.length), starts[p]!);
    issues.push(...checkParagraph(p, current, language));
  }
  const frames = asArray(story.textContainers);
  const layer = doc.layers.itemByName(CONTROL_LAYER);
  const storyIssues = checkStory({
    opticalMarginAlignment: !!story.storyPreferences.opticalMarginAlignment,
    ignoresWrap: frames.some((f: Any) => !!f.textFramePreferences.ignoreWrap),
    wrapOnlyBeneath: !!doc.textPreferences.zOrderTextWrap,
    controlLayerNotOnTop: layer.isValid ? layer.index !== 0 : false,
    overset: !!story.overflows,
  });
  return { paragraphIssues: issues, storyIssues };
}

/** Enum values come back as numbers in UXP; map the ones we compare by name. */
function enumName(v: SettingValue, attribute: string): SettingValue {
  if (typeof v !== 'number') return v;
  const id = indesign();
  const enums: Record<string, Any> = { justification: id.Justification, providerHyphenationStyle: id.HyphenationStyleEnum, leading: id.Leading };
  const e = enums[attribute];
  if (!e) return v;
  for (const k of Object.keys(e)) if (Number(e[k]) === v) return k;
  return v;
}

/** A stored value as InDesign takes it back: enum names become enum values. */
function setValue(attribute: string, v: SettingValue): unknown {
  const id = indesign();
  if (attribute === 'leading' && v === 'AUTO') return id.Leading.AUTO;
  const enums: Record<string, Any> = { justification: id.Justification, providerHyphenationStyle: id.HyphenationStyleEnum, balanceRaggedLines: id.BalanceLinesStyle };
  const e = enums[attribute];
  if (e && typeof v === 'string' && e[v] !== undefined) return e[v];
  return v;
}

function readState(story: Any): StoryState | undefined {
  const s = story.extractLabel(STORY_LABEL);
  if (!s) return undefined;
  try {
    return JSON.parse(s) as StoryState;
  } catch {
    return undefined;
  }
}

/** Every paragraph's fingerprint, in story order (one read). */
function paragraphPrints(story: Any): string[] {
  return asArray(story.paragraphs.everyItem().contents).map((c: Any) => paragraphPrint(String(c)));
}

/**
 * The stored record with its paragraph numbers mapped to today's paragraphs (2026-11-19): after paragraphs were added
 * or deleted, Remove used to give paragraphs their neighbours' originals. `lost` counts stored paragraphs that were not
 * found again (deleted, or their start rewritten); their originals are dropped. Records saved before fingerprints
 * existed are used as they are.
 */
function readCurrentState(story: Any): { state: StoryState; lost: number } | undefined {
  const state = readState(story);
  if (!state) return undefined;
  if (!state.prints) return { state, lost: 0 };
  const now = paragraphPrints(story);
  if (now.length === state.prints.length && now.every((p, k) => p === state.prints![k])) return { state, lost: 0 };
  const map = alignPrints(state.prints, now);
  const originals = remapByParagraph(state.originals, map);
  const tracking = remapByParagraph(state.tracking, map);
  state.originals = originals.record;
  if (state.tracking) state.tracking = tracking.record;
  state.prints = now;
  return { state, lost: originals.lost + tracking.lost };
}

/** Fix the settings the plugin needs, remembering the originals for Remove. */
/**
 * Fix the settings Flatter needs and record the originals for Remove. A preview fixes only its own paragraphs
 * (2026-11-26: a preview on five paragraphs made a whole justified story left-aligned); Apply to whole story all.
 */
function fixSettingsInPlace(story: Any, state: StoryState, only?: { from: number; to: number }): void {
  const { paragraphIssues } = checkSettings(story, only);
  const paras = story.paragraphs;
  for (const issue of paragraphIssues) {
    const key = String(issue.paragraph);
    const orig = (state.originals[key] ??= {});
    if (!(issue.attribute in orig)) orig[issue.attribute] = issue.current;
    const para = paras.item(issue.paragraph);
    para[issue.attribute] = issue.fix === FIXED_FROM_AUTO ? (Number(para.pointSize) * Number(para.autoLeading)) / 100 : setValue(issue.attribute, issue.fix);
  }
  if (story.storyPreferences.opticalMarginAlignment) {
    state.storyOriginals.opticalMarginAlignment ??= true;
    story.storyPreferences.opticalMarginAlignment = false;
  }
  for (const f of asArray(story.textContainers)) {
    if (f.textFramePreferences.ignoreWrap) {
      (state.storyOriginals.ignoreWrap ??= {})[String(f.id)] = true;
      f.textFramePreferences.ignoreWrap = false;
    }
  }
}

export interface ApplyReport extends ApplyResult {
  ms: number;
  probes: number;
  /** Where the time went, in ms. */
  timings: { fixSettings: number; prepare: number; plan: number; steerAndVerify: number };
}

/** A story Flatter is working on, kept alive by the panel between slider ticks. */
export interface LiveSession {
  story: Any;
  port: DomPort;
  session: FlatterSession;
  state: StoryState;
  /** The story's text and basic formatting when it was measured (see storySignature). */
  signature: string;
}

/**
 * Text plus the formatting that changes widths, per paragraph. Tracking is left out on purpose: Flatter
 * writes it itself. A different signature means the measurements are out of date.
 */
export function storySignature(story: Any): string {
  try {
    const paras = story.paragraphs.everyItem();
    const parts = [
      String(story.contents),
      asArray(paras.pointSize).join(','),
      asArray(paras.appliedFont).map((f: Any) => String(f?.name ?? f)).join(','),
      asArray(paras.horizontalScale).join(','),
      asArray(paras.kerningMethod).map(String).join(','),
      asArray(paras.appliedLanguage).map((l: Any) => String(l?.name ?? l)).join(','),
      asArray(paras.justification).map(String).join(','),
    ];
    return parts.join('\u0000');
  } catch {
    return '';
  }
}

/**
 * The story was edited (text, size, font, language) since Flatter measured it. The panel then measures
 * again instead of planning with old widths, which set every line wrong (designer's report, 2026-10-27).
 */
export function liveIsStale(live: LiveSession): boolean {
  if (!live.story?.isValid) return true;
  return storySignature(live.story) !== live.signature;
}

function undoableMode<T>(name: string, mode: 'entire' | 'merge', fn: () => T, doc?: Any): T {
  const id = indesign();
  let result: T | undefined;
  let error: unknown;
  let failed = false;
  id.app.doScript(
    () => {
      try {
        result = inPoints(fn);
      } catch (e) {
        error = e;
        failed = true;
      }
    },
    id.ScriptLanguage.UXPSCRIPT,
    [],
    // AUTO_UNDO merges into the previous undo step (spike S9): a whole slider drag is one step.
    mode === 'entire' ? id.UndoModes.ENTIRE_SCRIPT : id.UndoModes.AUTO_UNDO,
    name,
  );
  if (failed) {
    // Ticks merge into the previous step: rolling back would discard the whole Apply.
    if (mode === 'entire') rollBack(name, doc);
    throw error;
  }
  return result as T;
}

/**
 * Fix settings, measure and probe, plan, steer and verify: one undo step "Flatter: Apply".
 * Returns a live session the panel can keep adjusting.
 */
export function openSession(story: Any, settings: ApplySettings = {}, opts: { fixSettings?: boolean; paragraphs?: { from: number; to: number } } = {}): { live: LiveSession; report: ApplyReport } {
  const t0 = Date.now();
  if (isFrozen(story)) throw new FlatterUserError('This story is frozen. Unfreeze it to change the rag.');
  return undoableMode('Flatter: Preview', 'entire', () => {
    const doc = story.parent;
    const state: StoryState = readCurrentState(story)?.state ?? { version: 1, settings, originals: {}, storyOriginals: {}, appliedAt: '' };
    state.settings = settings;
    const tFix = Date.now();
    if (opts.fixSettings !== false) fixSettingsInPlace(story, state, opts.paragraphs);
    const fixMs = Date.now() - tFix;
    const layer = controlLayer(doc);
    const port = new DomPort(doc, story, layer);
    // A preview on selected paragraphs: only those are planned and steered.
    if (opts.paragraphs) port.only = opts.paragraphs;
    // Measure without the tracking an earlier Apply added.
    if (state.tracking) port.resetTracking(state.tracking);
    // A story duplicated from a Flatter story carries its tracking but not its record.
    if (settings.tracking?.enabled) port.resetLeftoverTracking();
    const session = new FlatterSession(port);
    const tPrep = Date.now();
    try {
      session.prepare(settings);
    } finally {
      port.dispose();
    }
    const tPlan = Date.now();
    session.plan(settings);
    const tSteer = Date.now();
    session.steer();
    const result = session.verify(settings.maxRounds ?? DEFAULT_MAX_ROUNDS);
    port.dropParkedTeeth();
    saveState(story, state, port);
    const timings = { fixSettings: fixMs, prepare: tPlan - tPrep, plan: tSteer - tPlan, steerAndVerify: Date.now() - tSteer };
    return { live: { story, port, session, state, signature: storySignature(story) }, report: { ...result, ms: Date.now() - t0, probes: port.probes, timings } };
  }, story.parent);
}

/**
 * A slider tick: re-plan with new settings and move the teeth, without reading back.
 * The first tick of a drag opens the undo step "Flatter: Adjust"; later ticks merge into it.
 */
export function liveUpdate(live: LiveSession, settings: ApplySettings, firstOfDrag: boolean): void {
  undoableMode('Flatter: Adjust', firstOfDrag ? 'entire' : 'merge', () => {
    live.session.plan(settings);
    try {
      live.session.steer();
    } catch {
      // Cmd+Z took back teeth or strips the port still remembers: find them again and steer once more (2026-11-26).
      live.port.forgetObjects();
      live.session.steer();
    }
    live.state.settings = settings;
  }, live.story.parent);
}

/** After a pause: read back, re-plan refused points, move misplaced teeth. Merges into the current step. */
export function liveVerify(live: LiveSession): ApplyResult {
  return undoableMode('Flatter: Adjust', 'merge', () => {
    const r = live.session.verify(live.state.settings.maxRounds ?? DEFAULT_MAX_ROUNDS);
    live.port.dropParkedTeeth();
    saveState(live.story, live.state, live.port);
    return r;
  }, live.story.parent);
}

function saveState(story: Any, state: StoryState, port: DomPort): void {
  if (Object.keys(port.baseTracking).length) state.tracking = { ...state.tracking, ...port.baseTracking };
  state.appliedAt = new Date().toISOString();
  state.prints = paragraphPrints(story);
  story.insertLabel(STORY_LABEL, JSON.stringify(state));
}

/** Set a story in strict alternating rag. One undo step. */
export function applyFlatter(story: Any, settings: ApplySettings = {}, opts: { fixSettings?: boolean } = {}): ApplyReport {
  return openSession(story, settings, opts).report;
}

/** The story Flatter last stored settings for, if any. */
export function storedSettings(story: Any): ApplySettings | undefined {
  return readState(story)?.settings;
}

/** Remove a story's teeth (and the control layer when it is empty). */
function removeTeeth(doc: Any, story: Any): number {
  const layer = doc.layers.itemByName(CONTROL_LAYER);
  let removed = 0;
  if (!layer.isValid) return 0;
  for (const it of asArray(layer.pageItems.everyItem().getElements())) {
    if (it.extractLabel(TOOTH_LABEL) === String(story.id)) {
      it.remove();
      removed++;
    }
  }
  if (Number(layer.pageItems.length) === 0) layer.remove();
  return removed;
}

/** Remove Flatter from a story: teeth, label, and every setting it changed. One undo step. */
export function removeFlatter(story: Any): { teethRemoved: number; settingsRestored: number; paragraphsNotFound: number } {
  return undoable('Flatter: Remove', () => {
    const doc = story.parent;
    // Paragraphs found again first (before Unfreeze saves the mapped record), then the fixed line breaks go.
    const current = readCurrentState(story);
    const state = current?.state;
    unfreezeInPlace(story, state);
    const teethRemoved = removeTeeth(doc, story);
    removeBands(doc, String(story.id));
    let settingsRestored = 0;
    if (state) {
      const paras = story.paragraphs;
      for (const [p, attrs] of Object.entries(state.originals)) {
        const para = paras.item(Number(p));
        if (!para.isValid) continue;
        // One setting InDesign does not take back must not stop the others (2026-11-26).
        for (const [a, v] of Object.entries(attrs)) {
          try {
            para[a] = setValue(a, v);
            settingsRestored++;
          } catch {
            /* left as Flatter set it */
          }
        }
      }
      for (const [p, t] of Object.entries(state.tracking ?? {})) {
        const para = paras.item(Number(p));
        if (para.isValid) para.texts.item(0).tracking = t;
      }
      if (state.storyOriginals.opticalMarginAlignment) story.storyPreferences.opticalMarginAlignment = true;
      for (const f of asArray(story.textContainers)) if (state.storyOriginals.ignoreWrap?.[String(f.id)]) f.textFramePreferences.ignoreWrap = true;
    }
    story.insertLabel(STORY_LABEL, '');
    return { teethRemoved, settingsRestored, paragraphsNotFound: current?.lost ?? 0 };
  }, story.parent);
}

/** Condition that marks the characters Freeze inserts, so Unfreeze removes exactly those. */
export const FROZEN_CONDITION = 'Flatter frozen';

/** The story is frozen: its line breaks are fixed characters (see freezeFlatter). */
export function isFrozen(story: Any): boolean {
  return !!readState(story)?.frozen;
}

/**
 * Freeze (plan §6.6): fix the current line breaks in the text, for hand-off to a computer whose
 * InDesign may hyphenate differently. Every visible line that does not already end a paragraph gets a
 * forced line break; a line InDesign hyphenated (or broke at a discretionary hyphen) also gets a real
 * hyphen. Both carry the condition "Flatter frozen". Teeth and band strips are removed; tracking stays.
 * Overset lines are left alone. One undo step.
 */
export function freezeFlatter(story: Any): { breaks: number; hyphens: number; linesBefore: number; linesAfter: number } {
  return undoable('Flatter: Freeze', () => {
    const doc = story.parent;
    const id = indesign();
    // Paragraph numbers as they are now (paragraphs added or deleted since Apply), for the base tracking below.
    const state = readCurrentState(story)?.state;
    if (!state) throw new FlatterUserError('Apply Flatter to this story before freezing it.');
    if (state.frozen) return { breaks: 0, hyphens: 0, linesBefore: 0, linesAfter: 0 };
    story.recompose();
    const text = Array.from(String(story.contents));
    const paraStarts = [0];
    text.forEach((c, k) => {
      if (c === '\r') paraStarts.push(k + 1);
    });
    // Where each visible line ends (index of the next line's first character), read per frame.
    const ends: { at: number; hyphen: boolean }[] = [];
    let linesBefore = 0;
    for (const container of asArray(story.textContainers)) {
      const lines = container.lines;
      const n = Number(lines.length);
      if (!n) continue;
      linesBefore += n;
      const lengths = asArray(lines.everyItem().contents).map((c: Any) => Array.from(String(c)).length);
      let at = Number(lines.item(0).characters.item(0).index);
      for (let i = 0; i < n; i++) {
        at += lengths[i]!;
        const last = text[at - 1] ?? '';
        const next = text[at];
        // Story end, paragraph end, or a break that is already there: nothing to fix.
        if (next === undefined || last === '\r' || last === '\n' || /[\u0003\u0004\u0018\u0019]/.test(last)) continue;
        const hyphen = last === '\u00AD' || (/\p{L}/u.test(last) && /\p{L}/u.test(next));
        ends.push({ at, hyphen });
      }
    }
    let cond = doc.conditions.itemByName(FROZEN_CONDITION);
    if (!cond.isValid) cond = doc.conditions.add({ name: FROZEN_CONDITION });
    cond.visible = true;
    let hyphens = 0;
    // From the end backwards, so earlier positions stay valid.
    for (const e of ends.reverse()) {
      const p = paragraphAt(paraStarts, e.at - 1);
      const base = state.tracking?.[String(p)] ?? Number(story.characters.item(Math.max(0, e.at - 1)).tracking);
      story.insertionPoints.item(e.at).contents = id.SpecialCharacters.FORCED_LINE_BREAK;
      if (e.hyphen) {
        story.insertionPoints.item(e.at).contents = '-';
        hyphens++;
      }
      const inserted = story.characters.itemByRange(e.at, e.at + (e.hyphen ? 1 : 0));
      inserted.applyConditions([cond], true);
      // No tracking after the line's last glyph: InDesign counts it when fitting the line.
      inserted.tracking = base;
    }
    // The fixed breaks hold the lines now: teeth and strips go.
    removeTeeth(doc, story);
    removeBands(doc, String(story.id));
    story.recompose();
    let linesAfter = 0;
    for (const container of asArray(story.textContainers)) linesAfter += Number(container.lines.length);
    state.frozen = { at: new Date().toISOString(), breaks: ends.length, hyphens };
    story.insertLabel(STORY_LABEL, JSON.stringify(state));
    return { breaks: ends.length, hyphens, linesBefore, linesAfter };
  }, story.parent);
}

export interface WholeStoryResult {
  paragraphs: number;
  lines: number;
  breaks: number;
  hyphens: number;
  missed: number;
  ms: number;
  timings: Record<string, number>;
}

/** Where a Set whole story job stands, for the panel's progress bar. */
export interface WholeStoryProgress {
  phase: 'measuring' | 'writing' | 'checking' | 'done';
  /** Write chunks done and in total (0 of 0 until measuring is done). */
  done: number;
  total: number;
  /** Paragraphs Flatter sets (known after measuring). */
  paragraphs: number;
}

/**
 * Set whole story as a job of steps (2026-11-26, ADR-036): every paragraph with these settings, written as fixed line
 * breaks (frozen), without the live steering that makes long stories slow (ADR-032). Each `step()` is one InDesign
 * script call, so the panel can redraw a progress bar (and offer Cancel) between steps. The first step opens the undo
 * step "Flatter: Set whole story" (unfreeze, settings, measuring, planning); the write chunks and the final check merge
 * into it, so one Cmd+Z undoes everything. Text edited between steps (the document stays usable) stops the job and
 * rolls it back: the planned positions would no longer fit.
 */
export interface WholeStoryJob {
  /** Run the next step. Returns true when the job is finished (then `result` is set). Throws after rolling back. */
  step(): boolean;
  /** Undo everything written so far (between steps). True when the story is exactly as before. */
  cancel(): boolean;
  progress(): WholeStoryProgress;
  result?: WholeStoryResult;
}

const WHOLE_STORY_UNDO = 'Flatter: Set whole story';

export function startWholeStory(story: Any, settings: ApplySettings = {}): WholeStoryJob {
  const t0 = Date.now();
  const timings: Record<string, number> = {};
  let phase: WholeStoryProgress['phase'] = 'measuring';
  let port: DomPort | undefined;
  let state: StoryState | undefined;
  let list: ReturnType<FlatterSession['bakeList']> = [];
  let chunks: { breaks?: BreakWrite[]; tracking?: TrackingWrite[] }[] = [];
  let next = 0;
  let expectedLength = 0;
  let breaks = 0;
  let tWrite = 0;
  let trackingWrites = 0;

  let opened = false;
  /**
   * Take back what the job wrote after its first step: undo its step when it is still the document's last one, else
   * (something was done in between) remove the inserted characters by their condition, as Unfreeze does.
   */
  const takeBack = (): boolean => {
    if (!opened) return true;
    opened = false;
    const doc = story.parent;
    if (String(doc.undoName) === WHOLE_STORY_UNDO) {
      doc.undo();
      return true;
    }
    undoable('Flatter: Clean up', () => {
      const current = readCurrentState(story)?.state;
      if (!current) return;
      current.frozen = { at: '', breaks: 0, hyphens: 0 };
      unfreezeInPlace(story, current);
    }, doc);
    return false;
  };
  const fail = (e: unknown): never => {
    phase = 'done';
    // A failed first step rolled its own undo step back (undoable).
    takeBack();
    throw e;
  };

  const measure = (): void => {
    undoable(WHOLE_STORY_UNDO, () => {
      const doc = story.parent;
      unfreezeInPlace(story);
      state = readCurrentState(story)?.state ?? { version: 1, settings, originals: {}, storyOriginals: {}, appliedAt: '' };
      // Tracking from an earlier rag back to the base first: everything after (settings, measuring, inserting the
      // breaks) is several times slower in text split into thousands of tracking ranges (2026-11-19).
      resetTrackingTo(story, state.tracking);
      state.settings = settings;
      delete state.frozen;
      const tFix = Date.now();
      fixSettingsInPlace(story, state);
      // A live rag (a preview) gives way: its teeth and strips go, its tracking is reset before measuring.
      removeTeeth(doc, story);
      removeBands(doc, String(story.id));
      port = new DomPort(doc, story, controlLayer(doc));
      // The tracking was reset to these bases above (resetTrackingTo): only record them, no second round of writes.
      if (state.tracking) port.baseTracking = { ...state.tracking };
      if (settings.tracking?.enabled) port.resetLeftoverTracking();
      const session = new FlatterSession(port);
      const tPrep = Date.now();
      try {
        session.prepare(settings);
      } finally {
        port.dispose();
      }
      const tPlan = Date.now();
      session.plan(settings);
      list = session.bakeList();
      let cond = doc.conditions.itemByName(FROZEN_CONDITION);
      if (!cond.isValid) cond = doc.conditions.add({ name: FROZEN_CONDITION });
      cond.visible = true;
      const writes = port.bakeWrites(list);
      const split = bakeChunks(writes.tracking, writes.breaks);
      chunks = [...split.breaks.map((b) => ({ breaks: b })), ...split.tracking.map((t) => ({ tracking: t }))];
      breaks = writes.breaks.length;
      trackingWrites = writes.tracking.length;
      expectedLength = Number(story.characters.length);
      // The record now, not only at the end: if the job stops half-way, Remove still finds the originals.
      saveState(story, state, port);
      Object.assign(timings, { fixSettings: tPrep - tFix, prepare: tPlan - tPrep, plan: Date.now() - tPlan });
    }, story.parent);
    opened = true;
    phase = chunks.length ? 'writing' : 'checking';
    tWrite = Date.now();
  };

  const write = (): void => {
    const chunk = chunks[next]!;
    if (!story.isValid || Number(story.characters.length) !== expectedLength) {
      throw new FlatterUserError('The text changed while Flatter was setting the whole story. Press Apply to whole story again.');
    }
    // Something else became the last undo step (an edit, Cmd+Z): the next chunk would merge into it (2026-11-26).
    if (String(story.parent.undoName) !== WHOLE_STORY_UNDO) {
      throw new FlatterUserError('The document changed while Flatter was setting the whole story. Press Apply to whole story again.');
    }
    port!.writeChunk(chunk, FROZEN_CONDITION);
    expectedLength += chunk.breaks ? insertedLength(chunk.breaks) : 0;
    next++;
    if (next === chunks.length) {
      phase = 'checking';
      timings.write = Date.now() - tWrite;
    }
  };

  const check = (): WholeStoryResult =>
    undoableMode(WHOLE_STORY_UNDO, 'merge', () => {
      const tCheck = Date.now();
      // Lines InDesign broke on its own: every visible line should end at a forced break or a paragraph end.
      story.recompose();
      const text = Array.from(String(story.contents));
      // Paragraph number of every character, to look only at the paragraphs Flatter set (not centred heads).
      const planned = new Set(list.map((p) => p.index));
      const paragraphOf: number[] = [];
      let para = 0;
      for (const c of text) {
        paragraphOf.push(para);
        if (c === '\r') para++;
      }
      let lines = 0;
      let missed = 0;
      for (const container of asArray(story.textContainers)) {
        const n = Number(container.lines.length);
        if (!n) continue;
        const lengths = asArray(container.lines.everyItem().contents).map((c: Any) => Array.from(String(c)).length);
        let at = Number(container.lines.item(0).characters.item(0).index);
        for (const len of lengths) {
          at += len;
          if (!planned.has(paragraphOf[at - 1] ?? -1)) continue;
          lines++;
          const last = text[at - 1] ?? '';
          if (text[at] !== undefined && !/[\r\n\u2028\u0003\u0004\u0018\u0019]/.test(last)) missed++;
        }
      }
      const hyphens = list.reduce((s, p) => s + p.breaks.filter((b) => b.hyphen).length, 0);
      state!.frozen = { at: new Date().toISOString(), breaks, hyphens };
      saveState(story, state!, port!);
      Object.assign(timings, { trackingWrites, chunks: chunks.length, check: Date.now() - tCheck });
      return { paragraphs: list.length, lines, breaks, hyphens, missed, ms: Date.now() - t0, timings };
    }, story.parent);

  const job: WholeStoryJob = {
    step() {
      try {
        if (phase === 'measuring') measure();
        else if (phase === 'writing') write();
        else if (phase === 'checking') {
          job.result = check();
          phase = 'done';
          opened = false;
        }
      } catch (e) {
        // measure() rolled its own undo step back already; later steps merged into it.
        fail(e);
      }
      return phase === 'done';
    },
    cancel() {
      phase = 'done';
      return takeBack();
    },
    progress: () => ({ phase, done: next, total: chunks.length, paragraphs: list.length }),
  };
  return job;
}

/** Set whole story in one go (all steps of startWholeStory): tests, the self-check and scripts. */
export function setWholeStory(story: Any, settings: ApplySettings = {}): WholeStoryResult {
  const job = startWholeStory(story, settings);
  while (!job.step()) {
    /* next step */
  }
  return job.result!;
}

/** Take the characters Freeze inserted back out (no undo step of its own). */
function unfreezeInPlace(story: Any, given?: StoryState): number {
  const state = given ?? readCurrentState(story)?.state;
  const cond = story.parent.conditions.itemByName(FROZEN_CONDITION);
  let removed = 0;
  if (cond.isValid && state?.frozen) {
    // Tracking back to each paragraph's base first: removing characters from text split into thousands of tracking
    // ranges cost about 30 ms each, from whole paragraphs a few (2026-11-19).
    resetTrackingTo(story, state.tracking);
    removed = removeByCondition(story, cond);
  }
  // The per-character fallback only for a frozen story whose GREP change removed nothing: it reads every '-' and
  // line break, and ran for every story once the condition existed in a document (2026-11-26).
  if (cond.isValid && removed === 0 && state?.frozen) {
    const text = Array.from(String(story.contents));
    for (let k = text.length - 1; k >= 0; k--) {
      if (text[k] !== '\n' && text[k] !== '-') continue;
      const ch = story.characters.item(k);
      const names = asArray(ch.appliedConditions).map((c: Any) => String(c.name));
      if (names.includes(FROZEN_CONDITION)) {
        ch.remove();
        removed++;
      }
    }
  }
  if (state?.frozen) {
    delete state.frozen;
    story.insertLabel(STORY_LABEL, JSON.stringify(state));
  }
  return removed;
}

/** Each recorded paragraph's tracking back to its base (whole paragraphs, one write each). */
function resetTrackingTo(story: Any, base: Record<string, number> | undefined): void {
  for (const [p, t] of Object.entries(base ?? {})) {
    const para = story.paragraphs.item(Number(p));
    if (para.isValid) para.texts.item(0).tracking = t;
  }
}

/**
 * Remove every character of the story that carries this condition with one GREP change (the user's Find/Change GREP
 * settings are put back afterwards). Returns how many characters went, or 0 when the change did not run.
 */
function removeByCondition(story: Any, cond: Any): number {
  const app = indesign().app;
  const NOTHING = indesign().NothingEnum.NOTHING;
  const saved = { find: app.findGrepPreferences.properties, change: app.changeGrepPreferences.properties };
  const before = Number(story.characters.length);
  try {
    app.findGrepPreferences = NOTHING;
    app.changeGrepPreferences = NOTHING;
    app.findGrepPreferences.findWhat = '[\\n-]';
    app.findGrepPreferences.appliedConditions = [cond];
    app.changeGrepPreferences.changeTo = '';
    story.changeGrep();
    return before - Number(story.characters.length);
  } catch {
    return 0;
  } finally {
    app.findGrepPreferences = NOTHING;
    app.changeGrepPreferences = NOTHING;
    for (const [prefs, props] of [[app.findGrepPreferences, saved.find], [app.changeGrepPreferences, saved.change]] as const) {
      for (const [k, v] of Object.entries(props ?? {})) {
        try {
          prefs[k] = v;
        } catch {
          /* read-only or not applicable */
        }
      }
    }
  }
}

/** Unfreeze: remove the fixed line breaks and hyphens Freeze inserted. One undo step. Apply again afterwards. */
export function unfreezeFlatter(story: Any): number {
  return undoable('Flatter: Unfreeze', () => unfreezeInPlace(story), story.parent);
}

/** The languages the panel's buttons set (InDesign language names). */
export const LANGUAGES = { de: 'German: 2006 Reform', en: 'English: USA' } as const;

/**
 * Set the language of whole stories (every linked frame). One undo step "Flatter: Language".
 * The language decides hyphenation (ours and InDesign's) and some required settings, so a story Flatter
 * works on must be applied again afterwards.
 */
export function setStoryLanguage(stories: readonly Any[], language: string): number {
  return undoable('Flatter: Language', () => {
    for (const story of stories) story.texts.item(0).appliedLanguage = language;
    return stories.length;
  }, stories[0]?.parent);
}

/** The story's language name, or "mixed" when its text uses more than one. */
export function storyLanguage(story: Any): string {
  try {
    // Per paragraph: reading every style range (thousands with tracked word spaces) slows later edits.
    const languages = asArray(story.paragraphs.everyItem().appliedLanguage);
    const names = [...new Set(languages.map((l: Any) => String(l?.name ?? l)))];
    // Locale codes for the panel's language note (names follow InDesign's own language, ADR-039).
    for (const name of names) {
      try {
        const l = languages.find((x: Any) => String(x?.name ?? x) === name);
        if (l?.icuLocaleName !== undefined) rememberLocale(name, String(l.icuLocaleName));
      } catch {
        /* no locale code */
      }
    }
    return names.length === 1 ? names[0]! : names.length ? 'mixed' : '';
  } catch {
    return '';
  }
}
