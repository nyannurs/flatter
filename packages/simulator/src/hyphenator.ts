/**
 * Stand-in hyphenator: Liang patterns from the `hyphen` package.
 *
 * This is ONE source, so in the real plugin its points could never reach
 * class A or B on their own (plan §5.3). The simulator labels them B so the
 * solver can use them; Phase 2 replaces this with the consensus module.
 */
import type { HyphenationPoint, Language } from '@flatter/core';
import de from 'hyphen/de-1996/index.js';
import enGb from 'hyphen/en-gb/index.js';
import enUs from 'hyphen/en-us/index.js';

export type SimLanguage = 'de' | 'de-CH' | 'en-US' | 'en-GB';

export const SIM_LANGUAGES: Record<SimLanguage, string> = {
  de: 'Deutsch (2006)',
  'de-CH': 'Deutsch, Schweiz (2006)',
  'en-US': 'English (US)',
  'en-GB': 'English (UK)',
};

export function coreLanguage(lang: SimLanguage): Language {
  return lang.startsWith('de') ? 'de' : 'en';
}

export function patternHyphenator(lang: SimLanguage): (word: string) => HyphenationPoint[] {
  const engine = lang.startsWith('de') ? de : lang === 'en-GB' ? enGb : enUs;
  const cache = new Map<string, HyphenationPoint[]>();
  return (word) => {
    let pts = cache.get(word);
    if (!pts) {
      pts = [];
      let index = 0;
      for (const ch of engine.hyphenateSync(word, { minWordLength: 1 })) {
        if (ch === '\u00ad') pts.push({ index, quality: 'B' });
        else index += ch.length;
      }
      cache.set(word, pts);
    }
    return pts;
  };
}
