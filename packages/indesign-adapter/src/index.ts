export { itemsFromMeasured, mergePoints, type MeasuredParagraph, type BuildFromMeasuredOptions, type PointSource } from './items.ts';
export { toothFor, slotsForPlan, sameSlot, TOOTH_HEIGHT, X_HEIGHT_SHARE, type LineSlot, type ToothSpec } from './geometry.ts';
export { REQUIRED_SETTINGS, checkParagraph, checkStory, type RequiredSetting, type SettingIssue, type StoryConditions, type SettingValue } from './settings.ts';
export { applyToPort, FlatterSession, hyphenLanguage, type ApplySettings, type ApplyResult, type ParagraphResult } from './apply.ts';
export type { Port, ParagraphData, ReadLine, TrackingSpan } from './port.ts';
// InDesign (UXP) entry points. Importing these outside InDesign is fine; calling them is not.
export { applyFlatter, removeFlatter, checkSettings, settingValue, openSession, liveUpdate, liveVerify, storedSettings, STORY_LABEL, type ApplyReport, type Check, type StoryState, type LiveSession } from './dom.ts';
export { DomPort, controlLayer, CONTROL_LAYER, TOOTH_LABEL, PROBE_LABEL } from './dom-port.ts';
