import type { HyphenClass, Item } from '../src/index.ts';

/** Simple proportional metrics: 5 pt per character, narrow and wide letters differ. */
export function mono(text: string): number {
  let w = 0;
  for (const c of text) {
    if (c === ' ') w += 2.5;
    else if (/[il.,'’:;!|]/.test(c)) w += 2.5;
    else if (/[mwMW]/.test(c)) w += 7.5;
    else w += 5;
  }
  return w;
}

/** Hyphenator that offers a point every three letters, all of the given class. */
export function every3(quality: HyphenClass = 'B') {
  return (word: string) => {
    const pts = [];
    for (let i = 3; i < word.length - 2; i += 3) pts.push({ index: i, quality });
    return pts;
  };
}

/** Build items by hand: words as boxes separated by spaces, '|' marks a hyphenation point. */
export function words(spec: string, opts: { char?: number; space?: number; hyphen?: number; quality?: HyphenClass } = {}): Item[] {
  const char = opts.char ?? 5;
  const space = opts.space ?? 2.5;
  const hyphen = opts.hyphen ?? 3;
  const items: Item[] = [];
  spec.split(' ').forEach((word, wi) => {
    if (wi > 0) items.push({ type: 'glue', width: space });
    const parts = word.split('|');
    parts.forEach((part, pi) => {
      items.push({
        type: 'box',
        width: part.length * char,
        text: part,
        wordKey: word.replace(/\|/g, '').toLowerCase(),
        ...(pi === 0 ? { wordStart: true } : {}),
        ...(pi === parts.length - 1 ? { wordEnd: true } : {}),
      });
      if (pi < parts.length - 1) items.push({ type: 'penalty', width: hyphen, flagged: true, quality: opts.quality ?? 'B' });
    });
  });
  return items;
}

export const GERMAN_SAMPLE =
  'Der Flattersatz ist eine Satzart, bei der die Zeilen unterschiedlich lang sind und am rechten Rand frei auslaufen. ' +
  'Ein guter Flattersatz entsteht nicht von selbst: Die Setzerin muss den Rhythmus der Zeilen beobachten, ungünstige ' +
  'Trennungen vermeiden und darauf achten, dass keine Treppen, Löcher oder Bäuche entstehen. Gerade in deutschen Texten ' +
  'mit ihren langen Zusammensetzungen wie Donaudampfschifffahrtsgesellschaft oder Rechtschreibreform ist das eine ' +
  'anspruchsvolle Aufgabe.';
