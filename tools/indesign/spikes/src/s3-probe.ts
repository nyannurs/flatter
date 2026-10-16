/**
 * S3: which hyphenation points does InDesign (Duden / Hunspell) accept, and what does it cost to find out?
 * InDesign has no API listing a word's points, so we probe: the word alone in a frame, Single-line
 * Composer, frame narrowed step by step. Each composition reveals the last point that fits; then the
 * frame is narrowed just below that point. Compositions per word = InDesign's points + 1.
 * Pass: probe < 5 ms per word (plan §8), with caching.
 */
import { createHyphenator, render } from '@flatter/hyphenation';
import { asArray, DE_TEXT, EN_TEXT, inNewDocument, textFrame, type Any, type TextSetup } from './lib.ts';

const EXTRA_DE = ['Wachstube', 'Staubecken', 'Urinstinkt', 'Druckerzeugnis', 'beinhalten', 'Analphabet', 'Bauchinhalt', 'Spiegelei', 'Häuschen', 'Feierabend', 'Biomüll', 'gegenüber', 'Programmheft', 'Zusammensetzung', 'Donaudampfschifffahrtsgesellschaft', 'Rechtschreibreform', 'Theater', 'Instinkt', 'Erbinformation', 'Musikerleben'];
const EXTRA_EN = ['therapist', 'manslaughter', 'legend', 'knowledge', 'democracy', 'typography', 'information', 'warehouse', 'caretaker', 'international', 'record', 'present', 'project'];

/** Squeeze InDesign allows before it breaks (spike S2). */
const TOLERANCE = 0.4;

/**
 * Probe "x <word>": the space after x is always a legal break, so InDesign never has to
 * emergency-break the word on line 1. Line 1 ending inside the word means a hyphenation point.
 */
function probeWord(frame: Any, word: string): { points: number[]; compositions: number } {
  const story = frame.parentStory;
  // Replace the text in place so the paragraph settings survive.
  story.texts.item(0).contents = 'x ' + word;
  frame.geometricBounds = [20, 20, 120, 2020];
  const xs: number[] = asArray(story.characters.everyItem().horizontalOffset).map(Number);
  const xe: number[] = asArray(story.characters.everyItem().endHorizontalOffset).map(Number);
  const x0 = xs[0]!;
  const lead = xs[2]! - x0;
  const full = xe[word.length + 1]! - x0;
  const points: number[] = [];
  let limit = full - TOLERANCE - 0.05;
  let compositions = 1;
  while (limit > lead) {
    frame.geometricBounds = [20, 20, 120, 20 + limit];
    compositions++;
    const firstLen = String(story.lines.item(0).contents).length - 2;
    if (firstLen <= 0 || firstLen >= word.length) break;
    points.unshift(firstLen);
    limit = xs[firstLen + 2]! - x0 - TOLERANCE - 0.05;
  }
  return { points, compositions };
}

inNewDocument((doc: Any) => {
  const out: Any = {};
  for (const [lang, texts, extra, hyLang] of [
    ['German: 2006 Reform', DE_TEXT, EXTRA_DE, 'de'],
    ['English: USA', EN_TEXT, EXTRA_EN, 'en-US'],
  ] as const) {
    const words = [...new Set([...texts.join(' ').match(/\p{L}{6,}/gu)!, ...extra])];
    const setup: TextSetup = { language: lang, capitalized: lang.startsWith('German') };
    const frame = textFrame(doc, [20, 20, 120, 2020], 'x-', setup);

    const h = createHyphenator({ language: hyLang });
    const t0 = Date.now();
    let compositions = 0;
    const rows: Any[] = [];
    let ourSafe = 0;
    let ourSafeRefused = 0;
    let indesignPoints = 0;
    let unknownToUs = 0;
    const refused: string[] = [];
    const unknown: string[] = [];
    for (const w of words) {
      const r = probeWord(frame, w);
      compositions += r.compositions;
      const ours = h.classify(w);
      const safe = ours.filter((p) => p.quality === 'A' || p.quality === 'B').map((p) => p.index);
      const known = new Set(ours.map((p) => p.index));
      ourSafe += safe.length;
      for (const i of safe) if (!r.points.includes(i)) { ourSafeRefused++; refused.push(render(w, [i])); }
      indesignPoints += r.points.length;
      for (const i of r.points) if (!known.has(i)) { unknownToUs++; unknown.push(render(w, [i])); }
      rows.push(`${render(w, r.points)}  | ours safe: ${render(w, safe)}`);
    }
    const ms = Date.now() - t0;
    out[lang] = {
      words: words.length,
      msPerWord: +(ms / words.length).toFixed(1),
      compositionsPerWord: +(compositions / words.length).toFixed(2),
      indesignPoints,
      ourSafePoints: ourSafe,
      ourSafeRefusedByInDesign: ourSafeRefused,
      refused,
      indesignPointsUnknownToUs: unknownToUs,

      unknown: unknown.slice(0, 40),
      sample: rows.filter((r) => /Wachstube|Staubecken|Urinstinkt|Druckerzeugnis|beinhalten|Analphabet|Bauchinhalt|Spiegelei|Häuschen|Feierabend|Biomüll|gegenüber|Programmheft|Zusammensetzung|Rechtschreibreform|Theater|Instinkt|therapist|manslaughter|legend|knowledge|democracy|typography|information|record|present/.test(r)),
    };
    frame.remove();
  }
  return out;
});
