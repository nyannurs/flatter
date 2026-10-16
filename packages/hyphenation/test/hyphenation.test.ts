import { describe, expect, it } from 'vitest';
import { analyseGerman, createHyphenator, neverHyphenateToken, render, syllabifyPart } from '../src/index.ts';

const de = createHyphenator({ language: 'de' });
const us = createHyphenator({ language: 'en-US' });
const gb = createHyphenator({ language: 'en-GB' });
const safe = (h: typeof de, w: string) => render(w, h.classify(w).filter((p) => p.quality === 'A' || p.quality === 'B').map((p) => p.index));
const cls = (h: typeof de, w: string, i: number) => h.classify(w).find((p) => p.index === i)?.quality;

describe('German rules (Regelwerk 2006)', () => {
  it('keeps ck together and lets st divide', () => {
    expect(syllabifyPart('zucker')).toEqual([2]);
    expect(syllabifyPart('kiste')).toEqual([3]);
  });

  it('never separates a single vowel at the edge of a word or word part', () => {
    expect(analyseGerman('Abend').points).toEqual([]);
    expect(analyseGerman('Kleie').points).toEqual([]);
    expect(safe(de, 'Feierabend')).toBe('Fei-er-abend');
    expect(cls(de, 'Feierabend', 6)).not.toBe('A');
    expect(safe(de, 'Biomüll')).toBe('Bio-müll');
  });

  it('marks compound and prefix joints as class A', () => {
    expect(cls(de, 'Rechtschreibreform', 5)).toBe('A');
    expect(cls(de, 'gegenüber', 5)).toBe('A');
    expect(cls(de, 'gegenüber', 2)).toBe('B');
  });

  it('allows both divisions of consonant + l/r in foreign words (§ 112)', () => {
    const pts = analyseGerman('Programm').points;
    expect(pts).toContain(3);
    expect(pts).toContain(4);
    expect(analyseGerman('Zeugnis').points).toEqual([4]);
  });

  it('never offers ch or ck splits', () => {
    for (const w of ['Bauchinhalt', 'Kuchenteller', 'Zuckerdose']) {
      for (const p of de.classify(w)) {
        const pair = w.slice(p.index - 1, p.index + 1).toLowerCase();
        if (pair === 'ch' || pair === 'ck') expect(p.quality).toBe('X');
      }
    }
  });
});

describe('consensus classes', () => {
  it('trusts only points both sources accept', () => {
    // The patterns allow Bau-chinhalt; the rules and the exception list do not.
    expect(cls(de, 'Bauchinhalt', 3)).toBe('X');
    expect(safe(de, 'Bauchinhalt')).toBe('Bauch-inhalt');
  });

  it('applies exceptions over every source', () => {
    expect(safe(de, 'Urinstinkt')).toBe('Ur-instinkt');
    expect(cls(de, 'Urinstinkt', 4)).toBeUndefined(); // Urin-stinkt is never offered
    expect(cls(de, 'Urinstinkt', 5)).toBe('X'); // Urins-tinkt: the rules allow it, the exception vetoes it
    expect(safe(de, 'Druckerzeugnis')).toBe('Druck-erzeug-nis');
    expect(safe(de, 'beinhalten')).toBe('be-inhal-ten');
  });

  it('gives no trusted point at the joints of ambiguous words', () => {
    expect(safe(de, 'Staubecken')).toBe('Staubecken');
    expect(safe(de, 'Wachstube')).toBe('Wachstube');
    for (const p of de.classify('Musikerleben')) if (p.index === 5 || p.index === 7) expect(p.quality).not.toMatch(/[AB]/);
  });

  it('accepts user exceptions', () => {
    const h = createHyphenator({ language: 'de', exceptions: ['Flat-ter=satz=re-gel'] });
    expect(safe(h, 'Flattersatzregel')).toBe('Flat-ter-satz-re-gel');
  });

  it('lets an injected authority replace the patterns (InDesign probe, plan §5.4)', () => {
    const h = createHyphenator({ language: 'de', authority: { name: 'InDesign', points: () => [] } });
    expect(h.classify('Flattersatz').every((p) => p.quality !== 'A' && p.quality !== 'B')).toBe(true);
  });
});

describe('English', () => {
  it('vetoes misleading divisions', () => {
    expect(cls(us, 'therapist', 3) ?? 'X').toBe('X');
    expect(safe(us, 'manslaughter')).not.toContain('mans-');
    expect(safe(us, 'legend')).toBe('legend');
  });

  it('trusts only points US and UK practice share', () => {
    expect(safe(us, 'knowledge')).toBe('knowledge');
    expect(safe(gb, 'knowledge')).toBe('knowledge');
  });

  it('gives homographs no trusted point where readings differ', () => {
    expect(safe(us, 'record')).toBe('record');
    expect(safe(us, 'present')).toBe('present');
  });

  it('keeps short word parts whole in British English only', () => {
    expect(safe(gb, 'international')).not.toMatch(/^in-/);
    expect(cls(us, 'international', 2)).toBe('B');
  });

  it('does not hyphenate capitalised words (proper names)', () => {
    expect(safe(us, 'Washington')).toBe('Washington');
  });
});

describe('never-hyphenate tokens', () => {
  it('recognises URLs, e-mail, numbers, code and abbreviations', () => {
    for (const t of ['https://example.org', 'name@example.org', '2026', 'iPhone15', 'snake_case', 'camelCase', 'UNESCO', 'z.B.', 'www.example']) {
      expect(neverHyphenateToken(t), t).toBe(true);
    }
    for (const t of ['Flattersatz', 'Wort,', '„Zeile“']) expect(neverHyphenateToken(t), t).toBe(false);
  });
});

describe('inflected forms of listed words', () => {
  it('applies exceptions to plurals and other endings', () => {
    expect(safe(de, 'Urinstinkte')).toBe('Ur-instinkte');
    expect(safe(de, 'Druckerzeugnisse')).toMatch(/^Druck-erzeug-nis/);
    expect(safe(de, 'Druckerzeugnisse')).not.toMatch(/Drucker-/);
  });

  it('applies ambiguity to inflected forms', () => {
    expect(safe(de, 'Wachstuben')).not.toMatch(/Wach-|Wachs-/);
  });
});
