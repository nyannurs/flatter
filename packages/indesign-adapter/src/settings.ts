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

/** Fix value for auto leading: the DOM layer replaces it with the size × auto leading % in effect. */
export const FIXED_FROM_AUTO = 'fixed leading (from auto)';

export const REQUIRED_SETTINGS: readonly RequiredSetting[] = [
  { attribute: 'composer', expected: 'Adobe Single-line Composer', fix: () => 'Adobe Single-line Composer', reason: 'The paragraph composer breaks earlier than the teeth allow; steering needs the single-line composer.', required: true },
  { attribute: 'justification', expected: 'LEFT_ALIGN', fix: () => 'LEFT_ALIGN', reason: 'Flatter sets left-aligned ragged text.', required: true },
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
 * Alignments Flatter leaves alone (ADR-026): a centred heading or a right-aligned caption inside a ragged story keeps
 * its alignment and is not planned. Left-aligned and justified paragraphs are set ragged.
 */
const KEPT_ALIGNMENTS = new Set(['CENTER_ALIGN', 'RIGHT_ALIGN', 'TO_BINDING_SIDE', 'AWAY_FROM_BINDING_SIDE']);

export function keepsAlignment(justification: string): boolean {
  return KEPT_ALIGNMENTS.has(justification);
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
