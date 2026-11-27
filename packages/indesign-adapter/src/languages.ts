/**
 * Languages inside a paragraph (2026-11-02). InDesign reports a paragraph's language from its first character, so a
 * German paragraph that opens with an English quote looked English as a whole. Here the paragraph's language is the
 * one most of its letters carry, and every word keeps its own. Pure: no InDesign APIs, tested in Node.
 */

/** A stretch of text in one language: [from, to) character indices, InDesign language name. */
export interface LanguageRun {
  from: number;
  to: number;
  language: string;
}

/** InDesign's name for text that is never hyphenated or spell-checked. */
export const NO_LANGUAGE = '[No Language]';
/** A word whose letters carry more than one language. */
export const MIXED_LANGUAGES = 'mixed';

/**
 * Language names are InDesign's display names and follow InDesign's own language ("Deutsch: Rechtschreibreform 2006",
 * "[Keine Sprache]"), so the DOM layer also records each name's locale code (2026-11-27, ADR-039). [No Language] has
 * the code en_US_POSIX.
 */
const locales = new Map<string, string>();
const NO_LANGUAGE_LOCALE = 'en_US_POSIX';

export function rememberLocale(name: string, locale: string): void {
  if (name && locale) locales.set(name, locale);
}

export function localeOf(name: string): string | undefined {
  return locales.get(name);
}

/** Text InDesign never hyphenates: [No Language], under whatever name this InDesign gives it. */
export function isNoLanguage(name: string): boolean {
  return name === NO_LANGUAGE || locales.get(name) === NO_LANGUAGE_LOCALE;
}

const LETTER = /\p{L}/u;

/**
 * The runs of one paragraph, relative to its start, and the language most of its letters carry (the first run's
 * when it has no letters). `runs` is only returned when the paragraph uses more than one language.
 */
export function paragraphLanguages(storyRuns: readonly LanguageRun[], chars: readonly string[], start: number): { language: string; runs?: LanguageRun[] } {
  const end = start + chars.length;
  const runs: LanguageRun[] = [];
  for (const r of storyRuns) {
    if (r.to <= start || r.from >= end) continue;
    const from = Math.max(r.from, start) - start;
    const to = Math.min(r.to, end) - start;
    const prev = runs[runs.length - 1];
    if (prev && prev.language === r.language && prev.to === from) prev.to = to;
    else runs.push({ from, to, language: r.language });
  }
  if (!runs.length) return { language: NO_LANGUAGE };
  const letters = new Map<string, number>();
  for (const r of runs) {
    let n = 0;
    for (let k = r.from; k < r.to; k++) if (LETTER.test(chars[k]!)) n++;
    letters.set(r.language, (letters.get(r.language) ?? 0) + n);
  }
  let language = runs[0]!.language;
  for (const [name, n] of letters) if (n > letters.get(language)!) language = name;
  return letters.size > 1 ? { language, runs } : { language };
}

/** The language of the characters [from, to): one name, or MIXED_LANGUAGES when they carry more than one. */
export function languageOf(runs: readonly LanguageRun[] | undefined, fallback: string, from: number, to: number): string {
  if (!runs) return fallback;
  let found: string | undefined;
  for (const r of runs) {
    if (r.to <= from || r.from >= to) continue;
    if (found !== undefined && found !== r.language) return MIXED_LANGUAGES;
    found = r.language;
  }
  return found ?? fallback;
}
