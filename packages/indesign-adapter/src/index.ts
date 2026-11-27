export { itemsFromMeasured, mergePoints, type MeasuredParagraph, type BuildFromMeasuredOptions, type PointSource } from './items.ts';
export { toothFor, slotsForPlan, sameSlot, bandsFor, mergeBands, textArea, type Indents, type ToothSide, TOOTH_HEIGHT, X_HEIGHT_SHARE, type BandSpec, type LineSlot, type ToothSpec } from './geometry.ts';
export { REQUIRED_SETTINGS, indesignNames, checkParagraph, checkStory, keepsAlignment, ragOnLeft, type RequiredSetting, type SettingIssue, type StoryConditions, type SettingValue } from './settings.ts';
export { applyToPort, compatibilityAlarms, steeringFailed, sameWordPoints, FlatterSession, hyphenLanguage, knownHyphenLanguage, type ApplySettings, type ApplyResult, type ParagraphResult } from './apply.ts';
export type { Port, ParagraphData, ReadLine, TrackingSpan } from './port.ts';
export { paragraphPrint, alignPrints, remapByParagraph, paragraphAt } from './paragraph-match.ts';
export { bakeChunks, insertedLength, breakLength, CHUNK_SIZE, type BakeChunks, type BreakWrite, type TrackingWrite } from './bake-chunks.ts';
export { predictSlots, type FlowParagraph, type Narrow } from './flow.ts';
export { paragraphLanguages, languageOf, NO_LANGUAGE, MIXED_LANGUAGES, isNoLanguage, rememberLocale, localeOf, type LanguageRun } from './languages.ts';
// InDesign (UXP) entry points. Importing these outside InDesign is fine; calling them is not.
export { applyFlatter, setWholeStory, startWholeStory, type WholeStoryJob, type WholeStoryProgress, type WholeStoryResult, removeFlatter, liveIsStale, storySignature, freezeFlatter, unfreezeFlatter, isFrozen, FROZEN_CONDITION, checkSettings, inPoints, setStoryLanguage, storyLanguage, LANGUAGES, settingValue, openSession, liveUpdate, liveVerify, storedSettings, STORY_LABEL, type ApplyReport, type Check, type StoryState, type LiveSession } from './dom.ts';
export { DomPort, localNames, readLanguageRuns, controlLayer, bandLayer, removeBands, clearMeasureCache, CONTROL_LAYER, BAND_LAYER, TOOTH_LABEL, PROBE_LABEL } from './dom-port.ts';
export { FlatterUserError, isUserError } from './errors.ts';
export { selfCheck, SELF_CHECK_TEXT, type SelfCheck, type SelfCheckResult } from './selfcheck.ts';
