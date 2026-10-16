/**
 * Curated lists (plan §5.2 source 3). Notation as in the golden corpora:
 * "=" marks a main joint (class A), "-" a secondary point (class B), and a
 * leading "!" means the word is never hyphenated.
 */

/**
 * Exceptions override every source: only the listed points are used, every
 * other candidate is vetoed. Use them for words the sources get wrong or where
 * an orthographically allowed point distorts the meaning.
 */
export const EXCEPTIONS: Record<'de' | 'en-US' | 'en-GB', readonly string[]> = {
  de: [
    'Ur=instinkt', // never Urin-stinkt
    'Druck=erzeug-nis', // never Drucker-zeugnis
    'be=inhal-ten', // never bein-halten
    'An=alpha-bet', // never Anal-phabet
    'Bauch=inhalt', // never Bau-chinhalt or Bauchin-halt
    'Spie-gel=ei', // never Spiege-lei
    'Häus-chen', // never Häu-schen
    'Mäd-chen',
    'Fei-er=abend', // never Feiera-bend
    'Bio=müll', // never Bi-omüll
    'Blu-men=topf=erde', // never Blumento-pferde
    'Ge-burts=tag', // never Geburt-stag
    'Ver=sand=ab-tei-lung',
  ],
  // Merriam-Webster divisions where both pattern sets also accept a British-style point.
  'en-US': ['def-i-ni-tion', 'ma-te-ri-al'],
  // Oxford divisions where both pattern sets also accept a US-style point.
  'en-GB': ['docu-ment', 'popu-la-tion', 'holi-day', 'defin-ition', 'typo-graphy', 'pos-ition'],
};

/**
 * Words with more than one reading. Only points shared by every reading are
 * trusted; the others become class C (listed for review, never used in Safe mode).
 */
export const AMBIGUOUS: Record<'de' | 'en', readonly string[][]> = {
  de: [
    ['Wach=stu-be', 'Wachs=tu-be'],
    ['Stau=be-cken', 'Staub=ecken'],
    ['Spar=gel-der', 'Spar-gel=der'],
    ['Mu-sik=er-le-ben', 'Mu-si-ker=le-ben'],
    ['Erb=in-for-ma-tion', 'Erbin=for-ma-tion'],
    ['Lach=sal-ve', 'Lachs=al-ve'],
  ],
  en: [
    // Homographs that divide differently by meaning (plan §5.1).
    ['rec-ord', 're-cord'],
    ['pres-ent', 'pre-sent'],
    ['proj-ect', 'pro-ject'],
    ['prog-ress', 'pro-gress'],
    ['prod-uce', 'pro-duce'],
    ['ref-use', 're-fuse'],
    ['des-ert', 'de-sert'],
    ['min-ute', 'mi-nute'],
    ['in-va-lid', 'in-val-id'],
    ['re-bel', 'reb-el'],
  ],
};

/** English divisions that mislead the reader (plan §5.1). Index = break before word[index]. */
export const MISLEADING_EN: Record<string, readonly number[]> = {
  therapist: [3], // the-rapist
  therapists: [3],
  manslaughter: [4], // mans-laughter
  legend: [3], // leg-end
  legends: [3],
  reinstate: [4], // rein-state
  earnest: [3], // ear-nest
  father: [3], // fat-her
  reappear: [4], // reap-pear
  misled: [2], // mi-sled
  nowhere: [3], // now-here
  analysis: [4], // anal-ysis
  analyst: [4],
  notable: [3], // not-able
  coworker: [3], // cow-orker
  therein: [3], // the-rein
  together: [5], // toget-her
  pigeon: [3], // pig-eon
};

export interface ParsedNotation {
  word: string;
  points: number[];
  joints: number[];
  never: boolean;
}

export function parseNotation(s: string): ParsedNotation {
  const never = s.startsWith('!');
  const body = never ? s.slice(1) : s;
  let word = '';
  const points: number[] = [];
  const joints: number[] = [];
  for (const ch of body) {
    if (ch === '-' || ch === '=') {
      points.push(word.length);
      if (ch === '=') joints.push(word.length);
    } else word += ch;
  }
  return { word, points, joints, never };
}
