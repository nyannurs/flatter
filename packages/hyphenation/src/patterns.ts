/**
 * Liang/TeX hyphenation patterns via the `hyphen` package (ISC).
 * Pattern licences (checked 2026-10-16, see docs/decisions.md ADR-008):
 * de-1996 MIT (generated from the wortliste project), en-gb MIT, en-us
 * permissive notice (G. D. C. Kuiken). Keep the notices when bundling.
 */
import createHyphenator from 'hyphen/hyphen.js';
import dePatterns from 'hyphen/patterns/de-1996.js';
import enGbPatterns from 'hyphen/patterns/en-gb.js';
import enUsPatterns from 'hyphen/patterns/en-us.js';
import type { HyphenationSource } from './types.ts';

// Use the synchronous core directly. The package's per-language entry points also build an
// async hyphenator at load time, which throws in InDesign's UXP runtime (no global object).
const de = { hyphenateSync: createHyphenator(dePatterns) };
const enGb = { hyphenateSync: createHyphenator(enGbPatterns) };
const enUs = { hyphenateSync: createHyphenator(enUsPatterns) };

function source(name: string, engine: { hyphenateSync(t: string, o?: { minWordLength?: number }): string }): HyphenationSource {
  const cache = new Map<string, number[]>();
  return {
    name,
    points(word) {
      let pts = cache.get(word);
      if (!pts) {
        pts = [];
        let index = 0;
        for (const ch of engine.hyphenateSync(word, { minWordLength: 1 })) {
          if (ch === '\u00ad') pts.push(index);
          else index += ch.length;
        }
        cache.set(word, pts);
      }
      return pts;
    },
  };
}

export const germanPatterns = source('TeX patterns de-1996', de);
export const usPatterns = source('TeX patterns en-US', enUs);
export const gbPatterns = source('TeX patterns en-GB', enGb);
