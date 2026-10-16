/**
 * Public InDesign operations: check and fix settings, apply, remove. Each runs
 * as one undo step ("Flatter: …") through app.doScript (spike S8).
 */
import { applyToPort, type ApplyResult, type ApplySettings } from './apply.ts';
import { asArray, controlLayer, DomPort, indesign, TOOTH_LABEL, type Any } from './dom-port.ts';
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

function undoable<T>(name: string, fn: () => T): T {
  const id = indesign();
  let result: T | undefined;
  let error: unknown;
  id.app.doScript(
    () => {
      try {
        result = fn();
      } catch (e) {
        error = e;
      }
    },
    id.ScriptLanguage.UXPSCRIPT,
    [],
    id.UndoModes.ENTIRE_SCRIPT,
    name,
  );
  if (error) throw error;
  return result as T;
}

export function checkSettings(story: Any): Check {
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
}

/** Set a story in strict alternating rag. One undo step. */
export function applyFlatter(story: Any, settings: ApplySettings = {}, opts: { fixSettings?: boolean } = {}): ApplyReport {
  const t0 = Date.now();
  return undoable('Flatter: Apply', () => {
    const doc = story.parent;
    const state: StoryState = readState(story) ?? { version: 1, settings, originals: {}, storyOriginals: {}, appliedAt: '' };
    state.settings = settings;
    if (opts.fixSettings !== false) fixSettingsInPlace(story, state);
    const layer = controlLayer(doc);
    const port = new DomPort(doc, story, layer);
    // Measure without the tracking an earlier Apply added.
    if (state.tracking) port.resetTracking(state.tracking);
    let result: ApplyResult;
    try {
      result = applyToPort(port, settings);
    } finally {
      port.dispose();
    }
    if (Object.keys(port.baseTracking).length) state.tracking = { ...port.baseTracking };
    state.appliedAt = new Date().toISOString();
    story.insertLabel(STORY_LABEL, JSON.stringify(state));
    return { ...result, ms: Date.now() - t0, probes: port.probes, check: checkSettings(story) };
  });
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
