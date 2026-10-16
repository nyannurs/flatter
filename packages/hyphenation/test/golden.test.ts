/**
 * Golden corpora (plan §9 Phase 2): every point the hyphenator would use in
 * Safe mode (class A or B) must be an acceptable division, and every class A
 * point must be a main joint. CI must pass 100 %.
 */
import { describe, expect, it } from 'vitest';
import { createHyphenator, render, type HyphenLanguage } from '../src/index.ts';
import { readCorpus } from './corpus.ts';

const CORPORA: [string, HyphenLanguage][] = [
  ['de', 'de'],
  ['en-US', 'en-US'],
  ['en-GB', 'en-GB'],
];

for (const [file, language] of CORPORA) {
  describe(`golden corpus ${file}`, () => {
    const entries = readCorpus(file);
    const h = createHyphenator({ language });

    it('has at least 300 entries', () => {
      expect(entries.length).toBeGreaterThanOrEqual(300);
    });

    it('never uses a point outside the acceptable divisions', () => {
      const failures: string[] = [];
      for (const e of entries) {
        const safe = h.classify(e.word).filter((p) => p.quality === 'A' || p.quality === 'B');
        for (const p of safe) {
          if (!e.allowed.includes(p.index)) {
            failures.push(`line ${e.line}: ${render(e.word, [p.index])} (class ${p.quality}; ${p.reasons.join('; ')}) — corpus: ${render(e.word, e.allowed)}`);
          }
        }
      }
      expect(failures).toEqual([]);
    });

    it('marks only main joints as class A', () => {
      const failures: string[] = [];
      for (const e of entries) {
        for (const p of h.classify(e.word)) {
          if (p.quality === 'A' && !e.joints.includes(p.index)) {
            failures.push(`line ${e.line}: ${render(e.word, [p.index])} is class A but not a main joint in ${render(e.word, e.allowed)}`);
          }
        }
      }
      expect(failures).toEqual([]);
    });
  });
}
