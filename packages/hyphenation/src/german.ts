/**
 * Rule-based German syllabification after the Amtliches Regelwerk 2006,
 * Teil F (§§ 107–113), combined with a lexicon-based compound and prefix
 * splitter. This is the independent second opinion for German (plan §5.2),
 * and the source of main joints (class A).
 *
 * Rules implemented:
 * - Compounds and prefixed words divide at their parts (§ 111).
 * - Within a part: one consonant between vowels goes to the new line; of
 *   several consonants, only the last goes (§ 110). ch, ck, sch, ph, th, rh,
 *   sh and qu count as one consonant (§ 110 E), so ck is never split (Zu-cker).
 * - Two vowels that do not form a diphthong may be divided (§ 109: The-a-ter).
 * - A single vowel letter at the start or end of a word part is never
 *   separated (§ 107 E1, 2006 revision: no E-sel, no Feiera-bend, no Bi-omüll).
 */
import { DE_FUGEN, DE_INFLECTIONS, DE_PREFIXES, DE_STEMS, DE_SUFFIXES } from './lexicon-de.ts';

const VOWEL_LETTERS = new Set([...'aeiouäöüy']);
const VOWEL_DIGRAPHS = ['ei', 'ai', 'au', 'äu', 'eu', 'ie', 'aa', 'ee', 'oo', 'ey', 'ay'];
const CONSONANT_GROUPS = ['sch', 'ch', 'ck', 'ph', 'th', 'rh', 'sh', 'qu'];

interface Unit {
  text: string;
  start: number;
  vowel: boolean;
}

function units(s: string): Unit[] {
  const out: Unit[] = [];
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    const cons = CONSONANT_GROUPS.find((g) => rest.startsWith(g));
    if (cons) {
      out.push({ text: cons, start: i, vowel: false });
      i += cons.length;
      continue;
    }
    const vow = VOWEL_DIGRAPHS.find((g) => rest.startsWith(g));
    if (vow) {
      out.push({ text: vow, start: i, vowel: true });
      i += vow.length;
      continue;
    }
    const ch = s[i]!;
    out.push({ text: ch, start: i, vowel: VOWEL_LETTERS.has(ch) });
    i += 1;
  }
  return out;
}

/**
 * Consonants that may stay with a following l or r in foreign words (§ 112: Zyk-lus / Zy-klus).
 * Only offered when exactly these two consonants stand between the vowels; the patterns must
 * agree before such a point is used. n is left out on purpose: Zeug-nis, never Zeu-gnis.
 */
const CLUSTER_HEADS = new Set(['b', 'd', 'f', 'g', 'k', 'p', 't', 'ph']);
const CLUSTER_TAILS = new Set(['l', 'r']);

/** Syllable boundaries inside one word part (indices relative to the part). */
export function syllabifyPart(part: string): number[] {
  const us = units(part);
  const nuclei = us.map((u, i) => (u.vowel ? i : -1)).filter((i) => i >= 0);
  const cuts = new Set<number>();
  for (let n = 0; n + 1 < nuclei.length; n++) {
    const a = nuclei[n]!;
    const b = nuclei[n + 1]!;
    const between = b - a - 1;
    if (between === 0) {
      // Hiatus: two vowels that are not a diphthong may be divided (The-a-ter).
      cuts.add(us[b]!.start);
      continue;
    }
    // One consonant goes to the new line; of several, only the last.
    cuts.add(us[b - 1]!.start);
    // § 112: consonant + l/r may also go to the new line together (Pro-gramm or Prog-ramm).
    if (between === 2 && CLUSTER_TAILS.has(us[b - 1]!.text) && CLUSTER_HEADS.has(us[b - 2]!.text)) cuts.add(us[b - 2]!.start);
  }
  // Diminutive -chen after s (Häus-chen) and plural of -sche words (Ta-schen) look identical: offer no point there.
  const m = /s(chen|chens)$/.exec(part);
  if (m) {
    const sAt = part.length - m[0].length;
    cuts.delete(sAt);
    cuts.delete(sAt + 1);
  }
  const sorted = [...cuts].filter((c) => c > 0 && c < part.length).sort((x, y) => x - y);
  // Never separate a single vowel letter at the start or end of the part.
  return sorted.filter((c, i) => {
    if (i === 0) {
      const head = part.slice(0, c);
      if (head.length === 1 && VOWEL_LETTERS.has(head)) return false;
    }
    if (i === sorted.length - 1) {
      const tail = part.slice(c);
      if (tail.length === 1 && VOWEL_LETTERS.has(tail)) return false;
    }
    return true;
  });
}

const PREFIXES = [...DE_PREFIXES].sort((a, b) => b.length - a.length);
/** Plural and derived forms with umlaut: Blatt → Blätt(er), Stand → ständ(ig), Haus → Häus(er). */
function umlautVariant(stem: string): string | undefined {
  const au = stem.lastIndexOf('au');
  const v = Math.max(stem.lastIndexOf('a'), stem.lastIndexOf('o'), stem.lastIndexOf('u'));
  if (au >= 0 && au + 1 >= v) return stem.slice(0, au) + 'äu' + stem.slice(au + 2);
  if (v < 0) return undefined;
  const map: Record<string, string> = { a: 'ä', o: 'ö', u: 'ü' };
  return stem.slice(0, v) + map[stem[v]!] + stem.slice(v + 1);
}
const STEMS = new Set([...DE_STEMS, ...DE_STEMS.map(umlautVariant).filter((x): x is string => x !== undefined && x.length >= 3)]);
const SUFFIXES = [...DE_SUFFIXES].sort((a, b) => b.length - a.length);
const STEM_LENGTHS = [...new Set([...STEMS].map((s) => s.length))].sort((a, b) => b - a);

export interface Parse {
  /** Joint positions (start of each part after the first). */
  joints: number[];
  /** Number of lexical stems (prefixes excluded). */
  stems: number;
}

/**
 * All ways to split a lower-case word into prefixes, stems with suffixes,
 * linking elements and a final inflection. Returns [] when the lexicon cannot
 * cover the whole word.
 */
export function parseCompound(word: string): Parse[] {
  const n = word.length;
  const memo = new Map<string, Parse[]>();

  // State 'start': a new part begins at i. State 'stem': a stem (with suffixes) ended at i.
  const fromStart = (i: number): Parse[] => {
    const key = `s${i}`;
    const hit = memo.get(key);
    if (hit) return hit;
    const out: Parse[] = [];
    for (const p of PREFIXES) {
      if (!word.startsWith(p, i) || i + p.length >= n) continue;
      for (const rest of fromStart(i + p.length)) out.push({ joints: [i + p.length, ...rest.joints], stems: rest.stems });
    }
    for (const len of STEM_LENGTHS) {
      if (i + len > n || !STEMS.has(word.slice(i, i + len))) continue;
      for (const rest of afterStem(i + len)) out.push({ joints: rest.joints, stems: rest.stems + 1 });
    }
    memo.set(key, out);
    return out;
  };

  const afterStem = (i: number): Parse[] => {
    const key = `t${i}`;
    const hit = memo.get(key);
    if (hit) return hit;
    const out: Parse[] = [];
    if (i === n) out.push({ joints: [], stems: 0 });
    for (const inf of DE_INFLECTIONS) if (i + inf.length === n && word.endsWith(inf)) out.push({ joints: [], stems: 0 });
    for (const suf of SUFFIXES) {
      if (!word.startsWith(suf, i)) continue;
      out.push(...afterStem(i + suf.length));
    }
    if (i < n) {
      for (const rest of fromStart(i)) out.push({ joints: [i, ...rest.joints], stems: rest.stems });
      for (const f of DE_FUGEN) {
        if (!word.startsWith(f, i) || i + f.length >= n) continue;
        for (const rest of fromStart(i + f.length)) out.push({ joints: [i + f.length, ...rest.joints], stems: rest.stems });
      }
    }
    memo.set(key, out);
    return out;
  };

  const all = fromStart(0);
  const seen = new Set<string>();
  return all.filter((p) => {
    const k = `${p.joints.join(',')}|${p.stems}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export interface GermanAnalysis {
  /** Points the rules allow (intersection over equally good parses). */
  points: number[];
  /** Joints shared by all equally good parses. */
  joints: number[];
  /** Joints that differ between equally good parses: the word is ambiguous there. */
  ambiguousJoints: number[];
  /** The lexicon covered the word. */
  parsed: boolean;
}

function syllabifyWithJoints(word: string, joints: number[]): number[] {
  const bounds = [0, ...joints, word.length];
  const pts: number[] = [...joints];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const from = bounds[k]!;
    const part = word.slice(from, bounds[k + 1]);
    for (const c of syllabifyPart(part)) pts.push(from + c);
  }
  return [...new Set(pts)].sort((a, b) => a - b);
}

export function analyseGerman(word: string): GermanAnalysis {
  const lower = word.toLowerCase();
  const parses = parseCompound(lower);
  if (parses.length === 0) {
    return { points: syllabifyWithJoints(lower, []), joints: [], ambiguousJoints: [], parsed: false };
  }
  // Best parses: fewest stems, then fewest parts. Ties are genuine ambiguities.
  const minStems = Math.min(...parses.map((p) => p.stems));
  const byStems = parses.filter((p) => p.stems === minStems);
  const minParts = Math.min(...byStems.map((p) => p.joints.length));
  const best = byStems.filter((p) => p.joints.length === minParts);
  const jointSets = best.map((p) => new Set(p.joints));
  const allJoints = [...new Set(best.flatMap((p) => p.joints))];
  const shared = allJoints.filter((j) => jointSets.every((s) => s.has(j)));
  const ambiguous = allJoints.filter((j) => !jointSets.every((s) => s.has(j)));
  const pointSets = best.map((p) => new Set(syllabifyWithJoints(lower, p.joints)));
  const points = [...pointSets[0]!].filter((x) => pointSets.every((s) => s.has(x)));
  return { points, joints: shared.sort((a, b) => a - b), ambiguousJoints: ambiguous.sort((a, b) => a - b), parsed: true };
}
