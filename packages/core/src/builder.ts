/**
 * Builds solver items from plain paragraph text.
 *
 * Production measurements come from InDesign; this builder serves the
 * simulator and tests, and documents how text maps onto items. Widths are
 * measured cumulatively from the start of each word so kerning inside the
 * word is kept.
 */
import type { HyphenClass, Item, Penalty } from './items.ts';
import type { Language } from './params.ts';

/** A hyphenation point inside a bare word: break before word[index]. */
export interface HyphenationPoint {
  index: number;
  quality: HyphenClass;
}

/** Extra cost for breaking between two words (Sinneinheiten hook, plan §2A.6). */
export type BreakCostRule = (before: string, after: string) => { cost: number; reason: string } | null;

export interface BuildOptions {
  /** Advance width of a run of text in points. */
  measure: (text: string) => number;
  /** Hyphenation points of a bare word (letters only). Omit for no hyphenation. */
  hyphenate?: (word: string) => HyphenationPoint[];
  language?: Language;
  /** Shortest word that may be hyphenated. Default 6 (plan §5.5). */
  minWordLength?: number;
  /** Letters left before a hyphen. Default 2. */
  minBefore?: number;
  /** Letters carried to the next line. Default 3. */
  minAfter?: number;
  /** Default: on for German (nouns), off for English (proper names). */
  hyphenateCapitalized?: boolean;
  breakCost?: BreakCostRule;
  /** Cost of a hyphen in a word directly before a dash, parenthesis or quote. Default 300. */
  interruptionCost?: number;
  /** Cost of breaking after a slash. Default 50. */
  slashCost?: number;
}

const BREAKABLE_SPACE = /^[ \t\u2002\u2003\u2009]+$/;
const NO_BREAK_SPACE = /^[\u00a0\u202f\u2007]$/;
const FORCED = /^(\r\n|\n|\r|\u2028)$/;
const SPLIT = /([ \t\u2002\u2003\u2009]+|[\u00a0\u202f\u2007]|\r\n|\n|\r|\u2028)/;
const LEAD = /^[^\p{L}\p{N}]*/u;
const TRAIL = /[^\p{L}\p{N}]*$/u;
const LETTERS_ONLY = /^\p{L}+$/u;
const INTERRUPTION_AFTER = /^[—–(\[„“"«»‚‘'‹›]/;
const INTERRUPTION_TRAIL = /[)\]“”"«»‘’'‹›—–]/;

interface Cut {
  /** Position in the cleaned token: the break comes before this character. */
  at: number;
  penalty: (prefix: string) => Penalty;
}

export function buildParagraph(text: string, opts: BuildOptions): Item[] {
  const lang = opts.language ?? 'de';
  const minWordLength = opts.minWordLength ?? 6;
  const minBefore = opts.minBefore ?? 2;
  const minAfter = opts.minAfter ?? 3;
  const hyphenateCapitalized = opts.hyphenateCapitalized ?? lang === 'de';
  const interruptionCost = opts.interruptionCost ?? 300;
  const slashCost = opts.slashCost ?? 50;
  const measure = opts.measure;

  const parts = text.trim().split(SPLIT).filter((p) => p !== '');
  const items: Item[] = [];
  let prevWord: string | undefined;

  const nextWordAfter = (i: number): string | undefined => {
    for (let j = i + 1; j < parts.length; j++) {
      const p = parts[j]!;
      if (FORCED.test(p)) return undefined;
      if (!BREAKABLE_SPACE.test(p) && !NO_BREAK_SPACE.test(p)) return p;
    }
    return undefined;
  };

  parts.forEach((part, i) => {
    if (FORCED.test(part)) {
      items.push({ type: 'penalty', width: 0, flagged: false, forced: true });
      prevWord = undefined;
      return;
    }
    if (NO_BREAK_SPACE.test(part)) {
      items.push({ type: 'glue', width: measure(part), noBreak: true });
      return;
    }
    if (BREAKABLE_SPACE.test(part)) {
      const next = nextWordAfter(i);
      const extra = prevWord !== undefined && next !== undefined ? opts.breakCost?.(prevWord, next) : null;
      items.push(
        extra && extra.cost > 0
          ? { type: 'glue', width: measure(' '), breakCost: extra.cost, breakReason: extra.reason }
          : { type: 'glue', width: measure(' ') },
      );
      return;
    }
    items.push(...wordItems(part, nextWordAfter(i)));
    prevWord = part;
  });
  return items;

  function wordItems(token: string, next: string | undefined): Item[] {
    const cuts: Cut[] = [];
    let clean = token;
    if (token.includes('\u00ad')) {
      // Discretionary hyphens set by the user: only these points, no automatic ones.
      clean = '';
      for (const ch of token) {
        if (ch === '\u00ad') {
          if (clean.length > 0) cuts.push({ at: clean.length, penalty: (prefix) => hyphenPenalty(prefix, 'A') });
        } else clean += ch;
      }
    } else {
      for (let k = 1; k < token.length - 1; k++) {
        const ch = token[k]!;
        if (ch === '-' && /[\p{L}\p{N}]/u.test(token[k - 1]!) && /[\p{L}\p{N}]/u.test(token[k + 1]!)) {
          // Existing hyphen (E-Mail, well-known): break after it, adding no glyph.
          cuts.push({ at: k + 1, penalty: () => ({ type: 'penalty', width: 0, flagged: true }) });
        } else if (ch === '/' || ch === '—' || ch === '–') {
          cuts.push({
            at: k + 1,
            penalty: () => ({ type: 'penalty', width: 0, flagged: false, cost: ch === '/' ? slashCost : 0 }),
          });
        }
      }
      if (cuts.length === 0 && opts.hyphenate) {
        const lead = token.match(LEAD)![0].length;
        const trail = token.match(TRAIL)![0].length;
        const core = token.slice(lead, token.length - trail);
        if (eligible(core)) {
          const interrupted = (next !== undefined && INTERRUPTION_AFTER.test(next)) || INTERRUPTION_TRAIL.test(token.slice(lead + core.length));
          for (const p of opts.hyphenate(core)) {
            if (p.index < minBefore || core.length - p.index < minAfter) continue;
            cuts.push({
              at: lead + p.index,
              penalty: (prefix) =>
                interrupted
                  ? { ...hyphenPenalty(prefix, p.quality), cost: interruptionCost, reason: 'Hyphenated word directly before a dash, parenthesis or quotation mark.' }
                  : hyphenPenalty(prefix, p.quality),
            });
          }
        }
      }
    }
    cuts.sort((x, y) => x.at - y.at);

    const lead = clean.match(LEAD)![0].length;
    const trail = clean.match(TRAIL)![0].length;
    const key = clean.slice(lead, clean.length - trail).toLowerCase() || undefined;
    const out: Item[] = [];
    let from = 0;
    let fromWidth = 0;
    const bounds = [...new Set(cuts.map((c) => c.at))].filter((at) => at > 0 && at < clean.length);
    bounds.push(clean.length);
    bounds.forEach((to, idx) => {
      const prefix = clean.slice(0, to);
      const toWidth = measure(prefix);
      const fragment: Item = {
        type: 'box',
        width: toWidth - fromWidth,
        text: clean.slice(from, to),
        ...(key !== undefined ? { wordKey: key } : {}),
        ...(idx === 0 ? { wordStart: true } : {}),
        ...(idx === bounds.length - 1 ? { wordEnd: true } : {}),
      };
      out.push(fragment);
      const cut = cuts.find((c) => c.at === to);
      if (cut && idx < bounds.length - 1) out.push(cut.penalty(prefix));
      from = to;
      fromWidth = toWidth;
    });
    return out;
  }

  function hyphenPenalty(prefix: string, quality: HyphenClass): Penalty {
    return { type: 'penalty', width: measure(prefix + '-') - measure(prefix), flagged: true, quality };
  }

  function eligible(core: string): boolean {
    if (!LETTERS_ONLY.test(core)) return false;
    if ([...core].length < minWordLength) return false;
    if (core === core.toUpperCase()) return false; // abbreviations and all-caps
    const first = core[0]!;
    if (!hyphenateCapitalized && first !== first.toLowerCase()) return false;
    return true;
  }
}
