import { createHyphenator } from '@flatter/hyphenation';
import { describe, expect, it } from 'vitest';
import { FlatterSession } from '../src/index.ts';
import { FakeInDesign } from './fake-indesign.ts';

const de = createHyphenator({ language: 'de' });
const ourSafe = (w: string) => de.classify(w).filter((p) => p.quality === 'A' || p.quality === 'B').map((p) => p.index);
const DE = [
  'Ein guter Flattersatz entsteht nicht von selbst. Wer Texte linksbündig setzt, überlässt den rechten Rand scheinbar dem Zufall, doch gerade dieser Rand bestimmt, ob eine Seite ruhig oder unruhig wirkt.',
  'In der Wachstube des alten Rathauses lagen die Druckerzeugnisse der vergangenen Woche auf einem Stapel: Flugblätter, Programmhefte und ein\u2028dünnes Verzeichnis der Ausstellungen im Staubecken der ehemaligen Mühle.',
];

describe('Set whole story: the break list', () => {
  for (const settings of [{ zoneShare: 0.2, bandShare: 0.5 }, { zoneShare: 0.2, bandShare: 0.5, tracking: { enabled: true, mode: 'precise' as const, max: 5 }, wordSpaceShare: 0.25 }]) {
    it(`splits every paragraph exactly into its planned lines (${settings.tracking ? 'precise' : 'plain'})`, () => {
      const fake = new FakeInDesign(DE, { measure: 210, accepts: ourSafe, columnLines: 9 });
      const session = new FlatterSession(fake);
      session.prepare(settings);
      session.plan(settings);
      const list = session.bakeList();
      const work = (session as unknown as { work: { data: { chars: string[] }; plan: { lines: { text: string; endsWithHyphen: boolean }[] } }[] }).work;
      list.forEach((p, k) => {
        const chars = work[k]!.data.chars;
        const cuts = [0, ...p.breaks.map((b) => b.at), chars.length];
        // Forced breaks already in the text cut too (no break is listed there).
        const pieces: string[] = [];
        for (let i = 0; i + 1 < cuts.length; i++) pieces.push(...chars.slice(cuts[i], cuts[i + 1]).join('').split('\u2028'));
        const planned = work[k]!.plan.lines.map((l) => l.text.replace(/[\s\u2028]+$/u, '').replace(/-$/, ''));
        expect(pieces.map((t) => t.replace(/\s+$/u, '').replace(/\u00ad$/, ''))).toEqual(planned.map((t) => t.replace(/\u00ad$/, '')));
        // A hyphen exactly where a planned line ends inside a word.
        expect(p.breaks.filter((b) => b.hyphen).length).toBe(work[k]!.plan.lines.filter((l) => l.endsWithHyphen && /\p{L}$/u.test(l.text.replace(/-$/, ''))).length);
        // Tracking only on characters of the paragraph.
        for (const s of p.spans) expect(s.from >= 0 && s.to <= chars.length).toBe(true);
      });
    });
  }
});
