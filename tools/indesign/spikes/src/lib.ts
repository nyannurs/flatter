/**
 * Shared helpers for the Phase 0 spikes. Every spike works in its own new
 * document and closes it without saving, so the user's documents stay untouched.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const require: (m: string) => any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const id: any = require('indesign');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Any = any;
export const app: Any = id.app;

export function result(value: unknown): void {
  app.insertLabel('flatter-result', JSON.stringify(value, null, 1));
}

/** Run a spike body in a fresh hidden document, always closing it without saving. */
export function inNewDocument(body: (doc: Any) => unknown): void {
  const t0 = Date.now();
  const doc = app.documents.add({ showingWindow: false });
  let out: unknown;
  try {
    doc.viewPreferences.horizontalMeasurementUnits = id.MeasurementUnits.POINTS;
    doc.viewPreferences.verticalMeasurementUnits = id.MeasurementUnits.POINTS;
    doc.documentPreferences.pageWidth = 1200;
    doc.documentPreferences.pageHeight = 1600;
    out = body(doc);
  } catch (e) {
    out = { error: String(e), stack: (e as Error).stack };
  } finally {
    doc.close(id.SaveOptions.NO);
  }
  result({ ms: Date.now() - t0, ...(out as object) });
}

export interface TextSetup {
  /** Leave InDesign's default justification ranges (word spacing 80–133 %) in place. */
  defaultSpacing?: boolean;
  font?: string;
  size?: number;
  leading?: number;
  language?: string;
  hyphenation?: boolean;
  composer?: string;
  /** Duden style: HYPH_ALL, HYPH_ALL_BUT_UNAESTHETIC, HYPH_AESTHETIC, HYPH_PREFERRED_AESTHETIC. */
  dudenStyle?: string;
  minBefore?: number;
  minAfter?: number;
  minWord?: number;
  ladder?: number;
  capitalized?: boolean;
}

/** A text frame with the paragraph settings the plugin will enforce (plan §5.5, §7.1). */
export function textFrame(doc: Any, bounds: [number, number, number, number], text: string, s: TextSetup = {}): Any {
  const page = doc.pages.item(0);
  const frame = page.textFrames.add({ geometricBounds: bounds });
  frame.textFramePreferences.insetSpacing = [0, 0, 0, 0];
  frame.textFramePreferences.firstBaselineOffset = id.FirstBaseline.LEADING_OFFSET;
  frame.textFramePreferences.verticalJustification = id.VerticalJustification.TOP_ALIGN;
  frame.contents = text;
  applySetup(frame, s);
  return frame;
}

/** Apply the paragraph settings to all text in a frame. Needed again after replacing the contents. */
export function applySetup(frame: Any, s: TextSetup = {}): void {
  const all = frame.parentStory.texts.item(0);
  const size = s.size ?? 10;
  all.appliedFont = s.font ?? 'Minion Pro\tRegular';
  all.pointSize = size;
  all.leading = s.leading ?? size * 1.3;
  all.appliedLanguage = s.language ?? 'German: 2006 Reform';
  all.justification = id.Justification.LEFT_ALIGN;
  all.composer = s.composer ?? 'Adobe Single-line Composer';
  all.hyphenation = s.hyphenation ?? true;
  all.hyphenateAfterFirst = s.minBefore ?? 2;
  all.hyphenateBeforeLast = s.minAfter ?? 3;
  all.hyphenateWordsLongerThan = s.minWord ?? 6;
  all.hyphenateLadderLimit = s.ladder ?? 0;
  all.hyphenationZone = 0;
  all.hyphenateCapitalizedWords = s.capitalized ?? true;
  all.hyphenateLastWord = true;
  all.hyphenateAcrossColumns = false;
  all.balanceRaggedLines = false;
  all.providerHyphenationStyle = id.HyphenationStyleEnum[s.dudenStyle ?? 'HYPH_PREFERRED_AESTHETIC'];
  all.tracking = 0;
  if (!s.defaultSpacing) {
  // Ragged text must not squeeze: InDesign otherwise uses the minimum word spacing to fit more on a line.
  all.minimumWordSpacing = 100;
  all.desiredWordSpacing = 100;
  all.maximumWordSpacing = 100;
  all.minimumLetterSpacing = 0;
  all.desiredLetterSpacing = 0;
  all.maximumLetterSpacing = 0;
  all.minimumGlyphScaling = 100;
  all.desiredGlyphScaling = 100;
  all.maximumGlyphScaling = 100;
  }
  all.kerningMethod = 'Metrics';
  all.spaceBefore = 0;
  all.spaceAfter = 0;
  all.firstLineIndent = 0;
}

export interface LineInfo {
  text: string;
  /** Story index of the first character. */
  first: number;
  /** Story index of the last character on the line (often the trailing space). */
  last: number;
  start: number;
  /** End of the last visible character (trailing spaces ignored). */
  inkEnd: number;
  /** InDesign's own line end (endHorizontalOffset of the line). */
  lineEnd: number;
  baseline: number;
  /** The line ends inside a word: InDesign hyphenated here. */
  hyphenated: boolean;
}

/** Read all lines of a story with as few DOM calls as possible. */
export function readLines(story: Any): LineInfo[] {
  const chars: string[] = asArray(story.characters.everyItem().contents).map(String);
  const ends: number[] = asArray(story.characters.everyItem().endHorizontalOffset).map(Number);
  const lines = story.lines;
  const n = lines.length;
  if (n === 0) return [];
  const texts: string[] = asArray(lines.everyItem().contents).map(String);
  const starts: number[] = asArray(lines.everyItem().horizontalOffset).map(Number);
  const lineEnds: number[] = asArray(lines.everyItem().endHorizontalOffset).map(Number);
  const baselines: number[] = asArray(lines.everyItem().baseline).map(Number);
  const out: LineInfo[] = [];
  let first = 0;
  for (let i = 0; i < n; i++) {
    const text = texts[i]!;
    const len = text.length;
    const last = first + len - 1;
    let k = last;
    while (k > first && /^\s$/.test(chars[k] ?? '')) k--;
    const lastChar = chars[last] ?? '';
    const nextChar = chars[last + 1] ?? '';
    out.push({
      text,
      first,
      last,
      start: starts[i]!,
      inkEnd: ends[k]!,
      lineEnd: lineEnds[i]!,
      baseline: baselines[i]!,
      hyphenated: /\p{L}/u.test(lastChar) && /\p{L}/u.test(nextChar),
    });
    first += len;
  }
  return out;
}

export function asArray<T>(v: T | T[]): T[] {
  return Array.isArray(v) ? v : [v];
}

export const DE_TEXT = [
  'Ein guter Flattersatz entsteht nicht von selbst. Wer Texte linksbündig setzt, überlässt den rechten Rand scheinbar dem Zufall, doch gerade dieser Rand bestimmt, ob eine Seite ruhig oder unruhig wirkt. Die Zeilen sollen sich in einem erkennbaren Rhythmus abwechseln, ohne dass Treppen, Löcher oder Bäuche entstehen, und die Trennungen müssen stimmen, sonst stolpert der Blick über jede Zeile.',
  'In der Wachstube des alten Rathauses lagen die Druckerzeugnisse der vergangenen Woche auf einem Stapel: Flugblätter, Programmhefte und ein dünnes Verzeichnis der Ausstellungen im Staubecken der ehemaligen Mühle. Niemand hatte sie gelesen. Der Pförtner trank seinen Kaffee mit viel Zucker und wartete auf den Feierabend, während draußen ein Esel geduldig vor der leeren Kiste stand.',
  'Die Rechtschreibreform von 2006 hat das Trennen in einigen Punkten vereinfacht. Das ck bleibt zusammen, das st darf getrennt werden, und bei Zusammensetzungen wie Schifffahrt bleiben alle drei Konsonanten erhalten. Einzelne Vokale am Wortanfang oder am Wortende werden dagegen nicht mehr abgetrennt, weshalb Wörter wie Abend, Ofen oder Biomüll am Zeilenende vollständig stehen bleiben sollten.',
];

export const EN_TEXT = [
  'A good ragged right margin does not happen by accident. When text is set flush left, the right edge seems to be left to chance, yet that edge decides whether a page looks calm or restless. Lines should alternate in a recognisable rhythm without forming staircases, holes or bellies, and every word division has to be correct, or the reader stumbles at the end of each line.',
  'The archive kept a record of every project the studio had ever printed: catalogues, posters, a slim guide to the exhibitions in the old warehouse by the river. Nobody had looked at it for years. The caretaker drank his tea, waited for the evening, and listened to a therapist on the radio explain why ordinary routines are a quiet kind of knowledge.',
  'Some words change their division with their meaning. To record a song is not the same as to keep a record of it, and to present an argument differs from a present wrapped in paper. A careful compositor notices such things at once, while a machine has to be told, and even then it may need a second opinion before it commits.',
];
