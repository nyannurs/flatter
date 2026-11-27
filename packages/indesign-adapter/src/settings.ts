/**
 * Paragraph settings the plugin needs (plan §5.5, §7.1 and the Phase 0
 * amendments in docs/spike-results.md). Pure description and comparison;
 * reading and writing them happens in dom.ts.
 */

export type SettingValue = string | number | boolean;

export interface RequiredSetting {
  /** InDesign paragraph attribute name. */
  attribute: string;
  /** Expected value; strings are enum names or InDesign names. */
  expected: SettingValue | ((current: SettingValue, language: string) => boolean);
  /** Value to set when fixing, per language family. */
  fix: (language: string) => SettingValue;
  /** Why the plugin needs it, shown in the "Fix settings" diff. */
  reason: string;
  /** Steering cannot work without it. Otherwise it only affects quality. */
  required: boolean;
}

const isGerman = (lang: string) => /German|Deutsch/i.test(lang);

/**
 * InDesign names that depend on InDesign's own language (ADR-039): a German InDesign calls the composer
 * "Adobe Ein-Zeilen-Setzer" and refuses the English name. The DOM layer replaces the English defaults with the names
 * of the running InDesign (`localNames` in dom-port.ts) before any setting is read or written.
 */
export const indesignNames = { singleLineComposer: 'Adobe Single-line Composer' };

/** Fix value for auto leading: the DOM layer replaces it with the size × auto leading % in effect. */
export const FIXED_FROM_AUTO = 'fixed leading (from auto)';

export const REQUIRED_SETTINGS: readonly RequiredSetting[] = [
  { attribute: 'composer', expected: (v) => v === indesignNames.singleLineComposer, fix: () => indesignNames.singleLineComposer, reason: 'The paragraph composer breaks earlier than the teeth allow; steering needs the single-line composer.', required: true },
  { attribute: 'justification', expected: (v) => RAGGED_ALIGNMENTS.has(String(v)), fix: () => 'LEFT_ALIGN', reason: 'Flatter sets ragged text: left- or right-aligned (justified text becomes left-aligned).', required: true },
  { attribute: 'balanceRaggedLines', expected: (v) => v === false || v === 'NO_BALANCING', fix: () => false, reason: 'Balance Ragged Lines fights the planned rhythm.', required: true },
  { attribute: 'hyphenationZone', expected: 0, fix: () => 0, reason: 'A hyphenation zone lets InDesign skip planned hyphenation points.', required: true },
  { attribute: 'hyphenateLastWord', expected: false, fix: () => false, reason: 'Never hyphenate the last word of a paragraph (plan §4.4).', required: false },
  { attribute: 'hyphenateAcrossColumns', expected: false, fix: () => false, reason: 'No hyphen at the end of a column or frame.', required: false },
  { attribute: 'hyphenateAfterFirst', expected: (v) => Number(v) >= 2, fix: () => 2, reason: 'At least 2 letters before a hyphen (Bringhurst).', required: false },
  { attribute: 'hyphenateBeforeLast', expected: (v) => Number(v) >= 3, fix: () => 3, reason: 'At least 3 letters after a hyphen (Bringhurst).', required: false },
  { attribute: 'hyphenateWordsLongerThan', expected: (v) => Number(v) >= 5, fix: () => 5, reason: 'Hyphenate only words of 6 letters or more.', required: false },
  { attribute: 'hyphenateCapitalizedWords', expected: (v, lang) => v === isGerman(lang), fix: (lang) => isGerman(lang), reason: 'German nouns are capitalised and must hyphenate; English capitals are usually names.', required: false },
  { attribute: 'providerHyphenationStyle', expected: (v, lang) => !isGerman(lang) || v === 'HYPH_PREFERRED_AESTHETIC', fix: () => 'HYPH_PREFERRED_AESTHETIC', reason: 'Duden "All" allows divisions like Urins-tinkt; Preferred Aesthetic breaks at word joints (spike S3, ADR-002).', required: false },
  { attribute: 'leading', expected: (v) => typeof v === 'number', fix: () => FIXED_FROM_AUTO, reason: 'Teeth are placed by baseline; auto leading moves baselines when breaks change. Fix settings sets the value auto leading gives now.', required: false },
];

export interface SettingIssue {
  paragraph: number;
  attribute: string;
  current: SettingValue;
  fix: SettingValue;
  reason: string;
  required: boolean;
}

/**
 * Alignments Flatter leaves alone: a centred heading inside a ragged story keeps its alignment and is not planned
 * (ADR-026). Right-aligned text is set ragged on the left since 2026-11-26 (ADR-037).
 */
const KEPT_ALIGNMENTS = new Set(['CENTER_ALIGN']);

export function keepsAlignment(justification: string): boolean {
  return KEPT_ALIGNMENTS.has(justification);
}

/** Ragged alignments Flatter sets as they are; justified ones become left-aligned. */
const RAGGED_ALIGNMENTS = new Set(['LEFT_ALIGN', 'RIGHT_ALIGN', 'TO_BINDING_SIDE', 'AWAY_FROM_BINDING_SIDE']);

/**
 * Whether a paragraph's rag (and Flatter's teeth and strips) is on the left of the line: right-aligned text, and text
 * aligned towards or away from the spine on the page side where that means right-aligned. `rightHand` is the
 * line's page: a right-hand page, or a single-sided one (its spine counts as being on the left).
 */
export function ragOnLeft(justification: string | undefined, rightHand = true): boolean {
  if (justification === 'RIGHT_ALIGN') return true;
  if (justification === 'TO_BINDING_SIDE') return !rightHand;
  if (justification === 'AWAY_FROM_BINDING_SIDE') return rightHand;
  return false;
}

/** Compare one paragraph's current attributes with what the plugin needs. */
export function checkParagraph(paragraph: number, current: Record<string, SettingValue>, language: string): SettingIssue[] {
  const out: SettingIssue[] = [];
  for (const s of REQUIRED_SETTINGS) {
    if (!(s.attribute in current)) continue;
    const v = current[s.attribute]!;
    const ok = typeof s.expected === 'function' ? s.expected(v, language) : v === s.expected;
    if (!ok) out.push({ paragraph, attribute: s.attribute, current: v, fix: s.fix(language), reason: s.reason, required: s.required });
  }
  return out;
}

/** Story and frame level conditions found in spike S6. */
export interface StoryConditions {
  opticalMarginAlignment: boolean;
  /** Any frame of the story ignores text wrap. */
  ignoresWrap: boolean;
  /** "Text wrap only affects text beneath" (textPreferences.zOrderTextWrap). */
  wrapOnlyBeneath: boolean;
  /** The control layer is not the topmost layer. */
  controlLayerNotOnTop: boolean;
  overset: boolean;
}

export function checkStory(c: StoryConditions): string[] {
  const out: string[] = [];
  if (c.opticalMarginAlignment) out.push('Optical margin alignment is on: lines would not break where planned (spike S6). Fix settings turns it off for this story.');
  if (c.ignoresWrap) out.push('A frame of this story ignores text wrap, so the teeth have no effect. Fix settings turns "Ignore Text Wrap" off.');
  if (c.wrapOnlyBeneath && c.controlLayerNotOnTop) out.push('"Text Wrap Only Affects Text Beneath" is on and the Flatter layer is not on top. Fix settings moves the layer to the top.');
  if (c.overset) out.push('The story is overset. Overset text cannot be measured; Flatter sets only the visible part.');
  return out;
}
