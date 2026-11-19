/**
 * Consensus classification (plan §5.3).
 *
 *   A  authority and second opinion agree, and the point is a main joint
 *   B  authority and second opinion agree
 *   C  only one source accepts it, or the word is ambiguous there
 *   X  vetoed by a hard rule, an exception or the misleading-split list
 *
 * Until InDesign can be probed (spike S3), the TeX patterns stand in as the
 * authority. German's second opinion is the rule-based syllabifier; English
 * uses the other variety's patterns, so only points both US and UK practice
 * accept count as agreed.
 */
import type { HyphenationPoint } from '@flatter/core';
import { analyseGerman } from './german.ts';
import { britishWholeParts, englishJoints } from './english.ts';
import { AMBIGUOUS, EXCEPTIONS, MISLEADING_EN, parseNotation, type ParsedNotation } from './lists.ts';
import { gbPatterns, germanPatterns, usPatterns } from './patterns.ts';
import type { ClassifiedPoint, HyphenationSource, HyphenLanguage } from './types.ts';

export interface HyphenatorOptions {
  language: HyphenLanguage;
  /** Letters that must stay before a hyphen. Default 2 (Bringhurst, plan §5.5). */
  minBefore?: number;
  /** Letters carried to the next line. Default 3. */
  minAfter?: number;
  /** Shortest word that is hyphenated at all. Default 6 (plan §5.5). */
  minWordLength?: number;
  /** Default: on for German (nouns), off for English (proper names). */
  hyphenateCapitalized?: boolean;
  /** Replace the stand-in authority, e.g. with points probed from InDesign. */
  authority?: HyphenationSource;
  /** Replace the default second opinion. */
  opinion?: HyphenationSource;
  /** Extra exceptions in "=" / "-" notation (user or document dictionary). */
  exceptions?: readonly string[];
}

export interface Hyphenator {
  language: HyphenLanguage;
  /** Every candidate point with its class and the reasons. Empty for words that are never hyphenated. */
  classify(word: string): ClassifiedPoint[];
  /** Points for the solver's text builder (all classes; the solver enforces Safe/Normal). */
  points(word: string): HyphenationPoint[];
}

const VOWEL = /^[aeiouäöüy]$/i;
const LETTERS_ONLY = /^\p{L}+$/u;

export function createHyphenator(opts: HyphenatorOptions): Hyphenator {
  const lang = opts.language;
  const german = lang.startsWith('de');
  const family = german ? 'de' : 'en';
  const minBefore = opts.minBefore ?? 2;
  const minAfter = opts.minAfter ?? 3;
  const minWordLength = opts.minWordLength ?? 6;
  const hyphenateCapitalized = opts.hyphenateCapitalized ?? german;
  const authority = opts.authority ?? (german ? germanPatterns : lang === 'en-GB' ? gbPatterns : usPatterns);
  const opinion: HyphenationSource =
    opts.opinion ??
    (german
      ? { name: 'German rules (Regelwerk 2006)', points: (w) => analyseGerman(w).points }
      : lang === 'en-GB'
        ? usPatterns
        : gbPatterns);

  const exceptions = new Map<string, ParsedNotation>();
  for (const e of [...EXCEPTIONS[german ? 'de' : lang === 'en-GB' ? 'en-GB' : 'en-US'], ...(opts.exceptions ?? [])]) {
    const parsed = parseNotation(e);
    exceptions.set(normalise(parsed.word, lang), parsed);
  }
  const ambiguous = new Map<string, ParsedNotation[]>();
  for (const readings of AMBIGUOUS[family]) {
    const parsed = readings.map(parseNotation);
    ambiguous.set(normalise(parsed[0]!.word, lang), parsed);
  }
  const cache = new Map<string, ClassifiedPoint[]>();

  function classify(word: string): ClassifiedPoint[] {
    const hit = cache.get(word);
    if (hit) return hit;
    const result = compute(word);
    cache.set(word, result);
    return result;
  }

  function compute(word: string): ClassifiedPoint[] {
    if (!LETTERS_ONLY.test(word)) return [];
    // Plan §5.1: camelCase identifiers and words in capitals (abbreviations) get no points of our own.
    if (neverHyphenateToken(word)) return [];
    const key = normalise(word, lang);
    const n = word.length;
    const points = new Map<number, ClassifiedPoint>();
    const get = (index: number) => {
      let p = points.get(index);
      if (!p) {
        p = { index, quality: 'C', joint: false, reasons: [] };
        points.set(index, p);
      }
      return p;
    };
    const veto = (index: number, reason: string) => {
      const p = get(index);
      p.quality = 'X';
      p.reasons.push(reason);
    };

    // Listed words also match their inflected forms (Urinstinkte, Druckerzeugnisse, Wachstuben).
    const listed = <T,>(map: Map<string, T>) => lookupInflected(map, key, german ? DE_ENDINGS : EN_ENDINGS);
    const exceptionHit = listed(exceptions);
    const exception = exceptionHit?.value;
    const auth = authority.points(word);
    const opin = opinion.points(word);
    let joints: number[] = [];
    let ambiguousJoints: number[] = [];

    // Consensus of the two sources.
    if (german) {
      const a = analyseGerman(word);
      joints = a.joints;
      ambiguousJoints = a.ambiguousJoints;
    } else {
      joints = englishJoints(word);
    }
    const authSet = new Set(auth);
    const opinSet = new Set(opin);
    for (const i of new Set([...auth, ...opin])) {
      const p = get(i);
      if (authSet.has(i) && opinSet.has(i)) {
        p.joint = joints.includes(i) && !ambiguousJoints.includes(i);
        p.quality = p.joint ? 'A' : 'B';
        p.reasons.push(p.joint ? 'both sources agree; main joint' : 'both sources agree');
      } else {
        p.quality = 'C';
        p.reasons.push(`only ${authSet.has(i) ? authority.name : opinion.name} allows it`);
      }
      if (ambiguousJoints.includes(i)) {
        p.quality = 'C';
        p.joint = false;
        p.reasons.push('the word splits into parts in more than one way here');
      }
    }

    if (exception && exceptionHit) {
      // The exception decides every point inside the listed word; the ending keeps the consensus.
      const len = exceptionHit.length;
      for (const p of points.values()) {
        if (p.index < len && !exception.points.includes(p.index)) {
          p.quality = 'X';
          p.joint = false;
          p.reasons.push('not in the exception list');
        }
      }
      for (const i of exception.points) {
        const p = get(i);
        p.joint = exception.joints.includes(i);
        p.quality = p.joint ? 'A' : 'B';
        p.reasons = ['exception list'];
      }
      if (exception.never) for (const p of points.values()) p.quality = 'X';
    } else {
      const readingsHit = listed(ambiguous);
      if (readingsHit) {
        const readings = readingsHit.value;
        const len = readingsHit.length;
        const shared = readings.map((r) => new Set(r.points)).reduce((acc, s) => new Set([...acc].filter((x) => s.has(x))));
        const anyJoint = new Set(readings.flatMap((r) => r.joints));
        const forms = readings.map((r) => render(r.word, r.points)).join(' / ');
        for (const p of points.values()) {
          if (p.quality === 'X' || p.index >= len) continue;
          // Only points every reading shares, and that are a joint in none of them, stay neutral.
          if (!shared.has(p.index) || anyJoint.has(p.index)) {
            p.quality = 'C';
            p.joint = false;
            p.reasons.push(`ambiguous word: ${forms}`);
          }
        }
      }
    }

    // Hard rules: never relaxed, independent of any dictionary.
    for (const p of [...points.values()]) {
      const i = p.index;
      if ([...word].length < minWordLength) veto(i, `word shorter than ${minWordLength} letters`);
      if (i < minBefore || n - i < minAfter) veto(i, `fewer than ${minBefore} letters before or ${minAfter} after the hyphen`);
      if (german) {
        const pair = word.slice(i - 1, i + 1).toLowerCase();
        if (pair === 'ck') veto(i, 'ck is never divided');
        if (pair === 'ch') veto(i, 'ch is never divided');
        if ((i === 1 && VOWEL.test(word[0]!)) || (i === n - 1 && VOWEL.test(word[n - 1]!))) veto(i, 'single vowel at the start or end of a word');
        const partJoints = exception ? exception.joints : joints;
        for (const j of partJoints) {
          if (Math.abs(j - i) === 1 && VOWEL.test(word[Math.min(i, j)]!)) veto(i, 'single vowel at the edge of a word part');
        }
      } else {
        // Own entries only: words like "constructor" would otherwise find Object.prototype members (crashed Apply).
        if (Object.hasOwn(MISLEADING_EN, key) && MISLEADING_EN[key]!.includes(i)) veto(i, 'misleading division');
        if (lang === 'en-GB' && !exception && p.quality !== 'X') {
          const inside = britishWholeParts(word).find(([a, b]) => i > a && i < b);
          if (inside) {
            p.quality = 'C';
            p.joint = false;
            p.reasons.push(`British practice keeps "${word.slice(inside[0], inside[1])}" whole`);
          }
        }
      }
      if (!hyphenateCapitalized && word[0] !== word[0]!.toLowerCase()) veto(i, 'capitalised word (proper name)');
    }

    return [...points.values()].sort((a, b) => a.index - b.index);
  }

  return {
    language: lang,
    classify,
    points: (word) => classify(word).map((p) => ({ index: p.index, quality: p.quality })),
  };
}

function normalise(word: string, lang: HyphenLanguage): string {
  const lower = word.toLowerCase();
  return lang === 'de-CH' ? lower.replace(/ß/g, 'ss') : lower;
}

/** Word with hyphens at the given points, for messages and the review list. */
export function render(word: string, points: readonly number[]): string {
  let s = '';
  for (let i = 0; i < word.length; i++) {
    if (points.includes(i)) s += '-';
    s += word[i];
  }
  return s;
}

/** Tokens that must never be hyphenated automatically (plan §5.1). */
export function neverHyphenateToken(token: string): boolean {
  if (/[0-9]/.test(token)) return true; // numbers, dates, model names
  if (/[@/\\]|:\/\/|^www\./i.test(token)) return true; // e-mail, URLs, paths
  if (/[_{}<>=#$%^&*|~`]/.test(token)) return true; // code
  if (/\p{Ll}\p{Lu}/u.test(token)) return true; // camelCase identifiers
  const core = token.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
  if (core.length > 1 && core === core.toUpperCase()) return true; // abbreviations, all caps
  if (/\p{L}\.\p{L}/u.test(token)) return true; // z.B., e.g.
  return false;
}

const DE_ENDINGS = ['', 'e', 'en', 'n', 's', 'es', 'er', 'ern', 'se', 'sen', 'ses', 'nen'];
const EN_ENDINGS = ['', 's', 'es', 'ed', 'd', 'ing', 'er', 'ers', 'ly'];

/** Find a listed word that equals the key or the key minus an inflectional ending. */
function lookupInflected<T>(map: Map<string, T>, key: string, endings: readonly string[]): { value: T; length: number } | undefined {
  for (const e of endings) {
    if (!key.endsWith(e)) continue;
    const stem = key.slice(0, key.length - e.length);
    const value = map.get(stem);
    if (value !== undefined) return { value, length: stem.length };
  }
  return undefined;
}
