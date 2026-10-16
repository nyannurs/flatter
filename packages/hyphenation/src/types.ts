import type { HyphenClass } from '@flatter/core';

export type HyphenLanguage = 'de' | 'de-CH' | 'en-US' | 'en-GB';

/** A hyphenation point in a bare word: the break comes before word[index]. */
export interface ClassifiedPoint {
  index: number;
  quality: HyphenClass;
  /** Main joint (compound or prefix boundary, Haupttrennstelle). */
  joint: boolean;
  /** Why the point got its class, for the review list (plan §6.4). */
  reasons: string[];
}

/** One independent opinion about where a word may break. */
export interface HyphenationSource {
  name: string;
  /** Break indices in the word (before word[index]), unfiltered by length rules. */
  points(word: string): number[];
}
