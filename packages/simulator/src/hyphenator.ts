/**
 * Language choices for the simulator. Hyphenation itself comes from
 * @flatter/hyphenation: patterns plus a second opinion, classes A/B/C/X.
 */
import type { Language } from '@flatter/core';
import type { HyphenLanguage } from '@flatter/hyphenation';

export type SimLanguage = HyphenLanguage;

export const SIM_LANGUAGES: Record<SimLanguage, string> = {
  de: 'Deutsch (2006)',
  'de-CH': 'Deutsch, Schweiz (2006)',
  'en-US': 'English (US)',
  'en-GB': 'English (UK)',
};

export function coreLanguage(lang: SimLanguage): Language {
  return lang.startsWith('de') ? 'de' : 'en';
}
