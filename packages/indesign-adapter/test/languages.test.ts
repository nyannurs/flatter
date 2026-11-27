import { createHyphenator } from '@flatter/hyphenation';
import type { Item } from '@flatter/core';
import { describe, expect, it } from 'vitest';
import { applyToPort, FlatterSession, indesignNames, isNoLanguage, knownHyphenLanguage, languageOf, MIXED_LANGUAGES, NO_LANGUAGE, paragraphLanguages, rememberLocale, REQUIRED_SETTINGS, type LanguageRun } from '../src/index.ts';
import { FakeInDesign } from './fake-indesign.ts';

const DE = 'German: 2006 Reform';
const EN = 'English: USA';
const de = createHyphenator({ language: 'de' });
const en = createHyphenator({ language: 'en-US' });
const safe = (h: typeof de, w: string) => h.classify(w).filter((p) => p.quality === 'A' || p.quality === 'B').map((p) => p.index);
// The fake dictionary accepts our safe points in the language it is asked in, and nothing in [No Language].
const accepts = (w: string, language: string) => (language === NO_LANGUAGE ? [] : language === EN ? safe(en, w) : safe(de, w));

/** Runs for the text with the given words set in another language. */
function runsFor(text: string, marked: Record<string, string>): LanguageRun[] {
  const chars = [...text];
  const out: LanguageRun[] = [];
  let at = 0;
  for (const [word, language] of Object.entries(marked)) {
    const from = [...text.slice(0, text.indexOf(word))].length;
    if (from > at) out.push({ from: at, to: from, language: DE });
    out.push({ from, to: from + [...word].length, language });
    at = from + [...word].length;
  }
  if (at < chars.length) out.push({ from: at, to: chars.length, language: DE });
  return out;
}

/** The items Flatter built for the fake's first paragraph. */
function itemsOf(fake: FakeInDesign): Item[] {
  const session = new FlatterSession(fake);
  session.prepare();
  return (session as unknown as { work: { items: Item[] }[] }).work[0]!.items;
}

/** The hyphenation points the items offer inside a word (positions after the cut). */
function pointsIn(items: Item[], word: string): number[] {
  const out: number[] = [];
  let k = items.findIndex((it) => it.type === 'box' && it.wordStart && it.wordKey === word.toLowerCase());
  if (k < 0) return out;
  let at = 0;
  for (; k < items.length; k++) {
    const it = items[k]!;
    if (it.type === 'box') at += [...(it.text ?? '')].length;
    if (it.type === 'penalty' && it.flagged) out.push(at);
    if (it.type === 'box' && it.wordEnd) break;
  }
  return out;
}

describe('languages inside a paragraph', () => {
  it('takes the language most letters carry, not the first letter\'s', () => {
    const text = '“Less is more,” sagte der Typograf, und alle stimmten ihm zu.';
    const runs = runsFor(text, { '“Less is more,”': EN });
    expect(paragraphLanguages(runs, [...text], 0).language).toBe(DE);
    expect(paragraphLanguages([{ from: 0, to: 100, language: EN }], [...text], 0)).toEqual({ language: EN });
  });

  it('clips story runs to the paragraph and merges neighbours', () => {
    const runs = [{ from: 0, to: 10, language: DE }, { from: 10, to: 14, language: DE }, { from: 14, to: 20, language: EN }];
    expect(paragraphLanguages(runs, [...'abcdefghij'], 8).runs).toEqual([{ from: 0, to: 6, language: DE }, { from: 6, to: 10, language: EN }]);
    expect(languageOf(runs, DE, 12, 16)).toBe(MIXED_LANGUAGES);
    expect(languageOf(runs, DE, 15, 18)).toBe(EN);
    expect(languageOf(undefined, DE, 15, 18)).toBe(DE);
  });

  const text = 'Im Studio sprach man nur von photographers und Verständlichkeit, von Typografieprogrammen und Layoutentscheidungen, denn alle wollten mitreden.';

  it('hyphenates a word set in English by the English rules, probed in English', () => {
    const fake = new FakeInDesign([text], { measure: 200, accepts, runs: [runsFor(text, { photographers: EN })] });
    const r = applyToPort(fake);
    expect(fake.probes.find((p) => p.language === EN)?.words).toEqual(['photographers']);
    expect(pointsIn(itemsOf(fake), 'photographers')).toEqual(safe(en, 'photographers'));
    expect(safe(en, 'photographers')).not.toEqual(safe(de, 'photographers'));
    expect(r.linesAsPlanned).toBe(r.linesPlanned);
  });

  it('never hyphenates a word in [No Language] or in two languages', () => {
    const runs = runsFor(text, { Typografieprogrammen: NO_LANGUAGE, Layout: EN });
    const fake = new FakeInDesign([text], { measure: 200, accepts, runs: [runs] });
    const items = itemsOf(fake);
    expect(pointsIn(items, 'Typografieprogrammen')).toEqual([]);
    expect(pointsIn(items, 'Layoutentscheidungen')).toEqual([]);
    expect(pointsIn(items, 'Verständlichkeit').length).toBeGreaterThan(0);
  });

  it('gives words in languages without our rules only class C points', () => {
    const fake = new FakeInDesign([text], { measure: 200, accepts: (w) => safe(de, w), runs: [runsFor(text, { Verständlichkeit: 'French' })] });
    const items = itemsOf(fake);
    const k = items.findIndex((it) => it.type === 'box' && it.wordKey === 'verständlichkeit');
    const qualities = items.slice(k).filter((it) => it.type === 'penalty' && it.flagged).slice(0, 2).map((it) => (it as { quality?: string }).quality);
    expect(qualities.length).toBeGreaterThan(0);
    expect(qualities.every((q) => q === 'C')).toBe(true);
  });
});

describe('language names of a non-English InDesign (ADR-039)', () => {
  it('maps names by their locale code', () => {
    rememberLocale('Deutsch: Rechtschreibreform 2006', 'de_DE');
    rememberLocale('Deutsch: Schweiz (Rechtschreibreform 2006)', 'de_CH');
    rememberLocale('Englisch: Großbritannien', 'en_GB');
    rememberLocale('Englisch: USA', 'en_US');
    rememberLocale('[Keine Sprache]', 'en_US_POSIX');
    rememberLocale('Französisch', 'fr_FR');
    expect(knownHyphenLanguage('Deutsch: Rechtschreibreform 2006')).toBe('de');
    expect(knownHyphenLanguage('Deutsch: Schweiz (Rechtschreibreform 2006)')).toBe('de-CH');
    expect(knownHyphenLanguage('Englisch: Großbritannien')).toBe('en-GB');
    expect(knownHyphenLanguage('Englisch: USA')).toBe('en-US');
    expect(knownHyphenLanguage('[Keine Sprache]')).toBeUndefined();
    expect(knownHyphenLanguage('Französisch')).toBeUndefined();
    expect(isNoLanguage('[Keine Sprache]')).toBe(true);
    expect(isNoLanguage('[No Language]')).toBe(true);
    expect(isNoLanguage('Englisch: USA')).toBe(false);
  });

  it('falls back to the name without a locale code', () => {
    expect(knownHyphenLanguage('German: 2006 Reform')).toBe('de');
    expect(knownHyphenLanguage('English: UK')).toBe('en-GB');
    expect(knownHyphenLanguage('Englisch: Vereinigtes Königreich')).toBe('en-GB');
  });
});

describe('composer name of a non-English InDesign (ADR-039)', () => {
  it('checks and fixes the composer by the running InDesign\'s name', () => {
    const composer = REQUIRED_SETTINGS.find((s) => s.attribute === 'composer')!;
    const before = indesignNames.singleLineComposer;
    try {
      indesignNames.singleLineComposer = 'Adobe Ein-Zeilen-Setzer';
      expect(composer.fix('de')).toBe('Adobe Ein-Zeilen-Setzer');
      expect((composer.expected as (v: string, l: string) => boolean)('Adobe Ein-Zeilen-Setzer', 'de')).toBe(true);
      expect((composer.expected as (v: string, l: string) => boolean)('Adobe Single-line Composer', 'de')).toBe(false);
    } finally {
      indesignNames.singleLineComposer = before;
    }
  });
});
