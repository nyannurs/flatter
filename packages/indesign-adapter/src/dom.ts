/**
 * Public InDesign operations: check and fix settings, apply, remove. Each runs
 * as one undo step ("Flatter: …") through app.doScript (spike S8).
 */
import { FlatterUserError } from './errors.ts';
import { DEFAULT_MAX_ROUNDS, FlatterSession, type ApplyResult, type ApplySettings } from './apply.ts';
import { asArray, controlLayer, DomPort, indesign, removeBands, TOOTH_LABEL, type Any } from './dom-port.ts';
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
  const alignments = asArray(paras.everyItem().justification).map(String);
  for (let p = 0; p < paras.length; p++) {
    // Centred and right-aligned paragraphs are left alone (ADR-026).
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
  if (isFrozen(story)) throw new FlatterUserError('This story is frozen. Unfreeze it to change the rag.');
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
    const tCheck = Date.now();
    const check = checkSettings(story);
    const timings = { fixSettings: fixMs, prepare: tPlan - tPrep, plan: tSteer - tPlan, steerAndVerify: tCheck - tSteer, check: Date.now() - tCheck };
    return { live: { story, port, session, state, signature: storySignature(story) }, report: { ...result, ms: Date.now() - t0, probes: port.probes, check, timings } };
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
    const r = live.session.verify(live.state.settings.maxRounds ?? DEFAULT_MAX_ROUNDS);
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
/** Remove a story's teeth (and the control layer when it is empty). */
function removeTeeth(doc: Any, story: Any): number {
  const layer = doc.layers.itemByName('Flatter (Steuerung)');
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

export function removeFlatter(story: Any): { teethRemoved: number; settingsRestored: number } {
  return undoable('Flatter: Remove', () => {
    const doc = story.parent;
    // A frozen story first gets its fixed line breaks back out.
    unfreezeInPlace(story);
    const teethRemoved = removeTeeth(doc, story);
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
    return { teethRemoved, settingsRestored };
  });
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
    const state = readState(story);
    if (!state) throw new FlatterUserError('Apply Flatter to this story before freezing it.');
    if (state.frozen) return { breaks: 0, hyphens: 0, linesBefore: 0, linesAfter: 0 };
    story.recompose();
    const text = Array.from(String(story.contents));
    const paraStarts = [0];
    text.forEach((c, k) => {
      if (c === '\r') paraStarts.push(k + 1);
    });
    const paragraphOf = (k: number) => {
      let p = 0;
      while (p + 1 < paraStarts.length && paraStarts[p + 1]! <= k) p++;
      return p;
    };
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
      const p = paragraphOf(e.at - 1);
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
  });
}

/** Take the characters Freeze inserted back out (no undo step of its own). */
function unfreezeInPlace(story: Any): number {
  const state = readState(story);
  const cond = story.parent.conditions.itemByName(FROZEN_CONDITION);
  let removed = 0;
  if (cond.isValid) {
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

/** Unfreeze: remove the fixed line breaks and hyphens Freeze inserted. One undo step. Apply again afterwards. */
export function unfreezeFlatter(story: Any): number {
  return undoable('Flatter: Unfreeze', () => unfreezeInPlace(story));
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
  });
}

/** The story's language name, or "mixed" when its text uses more than one. */
export function storyLanguage(story: Any): string {
  try {
    // Per paragraph: reading every style range (thousands with tracked word spaces) slows later edits.
    const names = [...new Set(asArray(story.paragraphs.everyItem().appliedLanguage).map((l: Any) => String(l?.name ?? l)))];
    return names.length === 1 ? names[0]! : names.length ? 'mixed' : '';
  } catch {
    return '';
  }
}
