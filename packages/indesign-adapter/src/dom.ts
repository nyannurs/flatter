/**
 * Public InDesign operations: check and fix settings, apply, remove. Each runs
 * as one undo step ("Flatter: …") through app.doScript (spike S8).
 */
import { FlatterSession, type ApplyResult, type ApplySettings } from './apply.ts';
import { asArray, controlLayer, DomPort, indesign, removeBands, TOOTH_LABEL, type Any } from './dom-port.ts';
import { checkParagraph, checkStory, FIXED_FROM_AUTO, REQUIRED_SETTINGS, type SettingIssue, type SettingValue } from './settings.ts';

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
function rollBack(name: string): void {
  try {
    const doc = indesign().app.activeDocument;
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

function undoable<T>(name: string, fn: () => T): T {
  const id = indesign();
  let result: T | undefined;
  let error: unknown;
  id.app.doScript(
    () => {
      try {
        result = inPoints(fn);
      } catch (e) {
        error = e;
      }
    },
    id.ScriptLanguage.UXPSCRIPT,
    [],
    id.UndoModes.ENTIRE_SCRIPT,
    name,
  );
  if (error) {
    rollBack(name);
    throw error;
  }
  return result as T;
}

export function checkSettings(story: Any): Check {
  return inPoints(() => readSettings(story));
}

function readSettings(story: Any): Check {
  const doc = story.parent;
  const paras = story.paragraphs;
  const issues: SettingIssue[] = [];
  for (let p = 0; p < paras.length; p++) {
    const para = paras.item(p);
    const current: Record<string, SettingValue> = {};
    for (const s of REQUIRED_SETTINGS) {
      try {
        current[s.attribute] = enumName(settingValue(para[s.attribute]), s.attribute);
      } catch {
        /* attribute missing in this version */
      }
    }
    issues.push(...checkParagraph(p, current, String(para.appliedLanguage.name)));
  }
  const frames = asArray(story.textContainers);
  const layer = doc.layers.itemByName('Flatter (Steuerung)');
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

function setValue(attribute: string, v: SettingValue): unknown {
  const id = indesign();
  if (attribute === 'leading' && v === 'AUTO') return id.Leading.AUTO;
  if (attribute === 'justification' && typeof v === 'string') return id.Justification[v];
  if (attribute === 'providerHyphenationStyle' && typeof v === 'string') return id.HyphenationStyleEnum[v];
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

/** Fix the settings the plugin needs, remembering the originals for Remove. */
function fixSettingsInPlace(story: Any, state: StoryState): void {
  const { paragraphIssues } = checkSettings(story);
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
  check: Check;
  /** Where the time went, in ms. */
  timings: { fixSettings: number; prepare: number; plan: number; steerAndVerify: number; check: number };
}

/** A story Flatter is working on, kept alive by the panel between slider ticks. */
export interface LiveSession {
  story: Any;
  port: DomPort;
  session: FlatterSession;
  state: StoryState;
}

function undoableMode<T>(name: string, mode: 'entire' | 'merge', fn: () => T): T {
  const id = indesign();
  let result: T | undefined;
  let error: unknown;
  id.app.doScript(
    () => {
      try {
        result = inPoints(fn);
      } catch (e) {
        error = e;
      }
    },
    id.ScriptLanguage.UXPSCRIPT,
    [],
    // AUTO_UNDO merges into the previous undo step (spike S9): a whole slider drag is one step.
    mode === 'entire' ? id.UndoModes.ENTIRE_SCRIPT : id.UndoModes.AUTO_UNDO,
    name,
  );
  if (error) {
    // Ticks merge into the previous step: rolling back would discard the whole Apply.
    if (mode === 'entire') rollBack(name);
    throw error;
  }
  return result as T;
}

/**
 * Fix settings, measure and probe, plan, steer and verify: one undo step "Flatter: Apply".
 * Returns a live session the panel can keep adjusting.
 */
export function openSession(story: Any, settings: ApplySettings = {}, opts: { fixSettings?: boolean } = {}): { live: LiveSession; report: ApplyReport } {
  const t0 = Date.now();
  return undoableMode('Flatter: Apply', 'entire', () => {
    const doc = story.parent;
    const state: StoryState = readState(story) ?? { version: 1, settings, originals: {}, storyOriginals: {}, appliedAt: '' };
    state.settings = settings;
    const tFix = Date.now();
    if (opts.fixSettings !== false) fixSettingsInPlace(story, state);
    const fixMs = Date.now() - tFix;
    const layer = controlLayer(doc);
    const port = new DomPort(doc, story, layer);
    // Measure without the tracking an earlier Apply added.
    if (state.tracking) port.resetTracking(state.tracking);
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
    const result = session.verify(settings.maxRounds ?? 6);
    port.dropParkedTeeth();
    saveState(story, state, port);
    const tCheck = Date.now();
    const check = checkSettings(story);
    const timings = { fixSettings: fixMs, prepare: tPlan - tPrep, plan: tSteer - tPlan, steerAndVerify: tCheck - tSteer, check: Date.now() - tCheck };
    return { live: { story, port, session, state }, report: { ...result, ms: Date.now() - t0, probes: port.probes, check, timings } };
  });
}

/**
 * A slider tick: re-plan with new settings and move the teeth, without reading back.
 * The first tick of a drag opens the undo step "Flatter: Adjust"; later ticks merge into it.
 */
export function liveUpdate(live: LiveSession, settings: ApplySettings, firstOfDrag: boolean): void {
  undoableMode('Flatter: Adjust', firstOfDrag ? 'entire' : 'merge', () => {
    live.session.plan(settings);
    live.session.steer();
    live.state.settings = settings;
  });
}

/** After a pause: read back, re-plan refused points, move misplaced teeth. Merges into the current step. */
export function liveVerify(live: LiveSession): ApplyResult {
  return undoableMode('Flatter: Adjust', 'merge', () => {
    const r = live.session.verify(live.state.settings.maxRounds ?? 6);
    live.port.dropParkedTeeth();
    saveState(live.story, live.state, live.port);
    return r;
  });
}

function saveState(story: Any, state: StoryState, port: DomPort): void {
  if (Object.keys(port.baseTracking).length) state.tracking = { ...state.tracking, ...port.baseTracking };
  state.appliedAt = new Date().toISOString();
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

/** Remove Flatter from a story: teeth, label, and every setting it changed. One undo step. */
export function removeFlatter(story: Any): { teethRemoved: number; settingsRestored: number } {
  return undoable('Flatter: Remove', () => {
    const doc = story.parent;
    const layer = doc.layers.itemByName('Flatter (Steuerung)');
    let teethRemoved = 0;
    if (layer.isValid) {
      for (const it of asArray(layer.pageItems.everyItem().getElements())) {
        if (it.extractLabel(TOOTH_LABEL) === String(story.id)) {
          it.remove();
          teethRemoved++;
        }
      }
    }
    removeBands(doc, String(story.id));
    const state = readState(story);
    let settingsRestored = 0;
    if (state) {
      const paras = story.paragraphs;
      for (const [p, attrs] of Object.entries(state.originals)) {
        const para = paras.item(Number(p));
        if (!para.isValid) continue;
        for (const [a, v] of Object.entries(attrs)) {
          para[a] = setValue(a, v);
          settingsRestored++;
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
    if (layer.isValid && layer.pageItems.length === 0) layer.remove();
    return { teethRemoved, settingsRestored };
  });
}
