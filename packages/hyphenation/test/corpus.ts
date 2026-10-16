import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseNotation } from '../src/index.ts';

export interface CorpusEntry {
  word: string;
  allowed: number[];
  joints: number[];
  note: string;
  line: number;
}

export function readCorpus(name: string): CorpusEntry[] {
  const path = resolve(import.meta.dirname, `../../../test/hyphenation/${name}.tsv`);
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((text, i) => ({ text, line: i + 1 }))
    .filter(({ text }) => text.trim() !== '' && !text.startsWith('#'))
    .map(({ text, line }) => {
      const [word, division, note] = text.split('\t');
      if (!word || !division) throw new Error(`${name}.tsv line ${line}: expected word<TAB>division`);
      const parsed = parseNotation(division);
      if (parsed.word !== word) throw new Error(`${name}.tsv line ${line}: division "${division}" does not spell "${word}"`);
      return { word, allowed: parsed.points, joints: parsed.joints, note: note ?? '', line };
    });
}
