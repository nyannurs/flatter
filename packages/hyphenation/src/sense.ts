/**
 * Sinneinheiten (plan §2A.6): costs for line breaks that tear units of meaning
 * apart. They are penalties, not rules: strict alternation ranks higher
 * (plan §7.4), and every break that pays one is reported.
 *
 * Costs are in solver units. For scale: a class B hyphen costs about 120 in
 * German, a line's distance from its target at most about 1.
 */
import type { BreakCostRule } from '@flatter/core';
import type { HyphenLanguage } from './types.ts';

export interface SenseCosts {
  article: number;
  preposition: number;
  oneLetter: number;
  pronoun: number;
  numberUnit: number;
  date: number;
  initials: number;
  abbreviation: number;
  enumerator: number;
  nameSuffix: number;
  /** Two capitalised words in a row: first and last name, or a proper name ("Max Planck", "Nxt Museum"). */
  name: number;
}

export const DEFAULT_SENSE_COSTS: SenseCosts = {
  article: 30,
  preposition: 20,
  oneLetter: 30,
  pronoun: 10,
  numberUnit: 300,
  date: 120,
  initials: 120,
  abbreviation: 120,
  enumerator: 60,
  nameSuffix: 120,
  name: 40,
};

const words = (s: string) => new Set(s.trim().split(/\s+/));

const DE_ARTICLES = words('der die das den dem des ein eine einen einem einer eines');
const DE_PREPOSITIONS = words(`an auf aus bei bis durch für gegen hinter in mit nach neben ohne seit über um unter von vor
  zu zwischen am im zum zur vom beim ins ans aufs ab per pro samt trotz wegen während entlang gemäß laut binnen`);
const DE_ABBREVIATIONS = words(`z. d. h. u. a. o. s. v. S. Nr. Dr. Prof. Hr. Fr. St. ca. vgl. Abb. Bd. Kap. Tab. bzw. ggf.
  inkl. evtl. Mio. Mrd. Tsd. Jh. Str. bspw. sog. ugs. zzgl. Anm. Hrsg.`);
const DE_TITLES = words('Herr Herrn Frau Fräulein Dr. Prof. Hr. Fr.');
const DE_MONTHS = words('Januar Jänner Februar März April Mai Juni Juli August September Oktober November Dezember');

const EN_ARTICLES = words('a an the');
const EN_PREPOSITIONS = words(`at by for from in into of on onto to with without within about above across after against
  along among around before behind below beneath beside between beyond during except inside near off over past since
  through toward towards under until upon via`);
const EN_PRONOUNS = words('I me he him she her it we us they them you');
const EN_TITLES = words('Mr. Mrs. Ms. Dr. St. Prof. Rev. Gen. Sgt. Capt. Lt. Col. Mt.');
const EN_NAME_SUFFIXES = words('Jr. Sr. II III IV');
const EN_MONTHS = words('January February March April May June July August September October November December');

const UNITS = words(`% ‰ °C °F ° € $ £ ¥ EUR USD CHF GBP kg g mg µg t m cm mm µm km dm l ml dl cl ha s ms min h pt px pc
  ft mi oz lb kB MB GB TB kW W V A Hz kHz MHz Uhr Prozent Grad Euro Dollar Franken Meter Kilometer Zentimeter Millimeter
  Kilogramm Gramm Liter Stunden Minuten Sekunden Seiten Punkt percent degrees dollars euros meters metres kilometres
  kilometers pages points`);

const core = (t: string) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.%‰°€$£¥]+$/gu, '');
const bare = (t: string) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
const EN_ABBREVIATIONS = words('etc. vs. e.g. i.e. cf. approx. no. No. fig. Fig. p. pp. vol. Vol. ed. eds. ch. Ch.');
/**
 * A token ending in a full stop is an abbreviation (no clause end) when it is an initial ("J."), has a full stop inside
 * ("z.B.", "e.g.") or is a listed abbreviation. Short words ending a sentence ("an.", "mit.", "it.") end a clause
 * (2026-11-26: every word of 1–4 letters counted as an abbreviation).
 */
const isAbbreviation = (t: string) => /^\p{L}\.$/u.test(t) || /\p{L}\.\p{L}/u.test(t) || DE_ABBREVIATIONS.has(t) || EN_ABBREVIATIONS.has(t) || EN_TITLES.has(t);
const endsClause = (t: string) => /[,;:!?)\]»«"”“–—]$/.test(t) || (/\.$/.test(t) && !isAbbreviation(core(t)));
const NUMBER = /^[+\-−±]?\d[\d.,'’\u00a0\u202f\u2009]*$/; // digit groups: thin and no-break spaces

export function createSenseRule(language: HyphenLanguage, costs: Partial<SenseCosts> = {}): BreakCostRule {
  const c = { ...DEFAULT_SENSE_COSTS, ...costs };
  const german = language.startsWith('de');
  return (before, after) => {
    const b = core(before);
    const a = core(after);
    const bw = bare(before);
    if (!b) return null;

    // Numbers and their units (10 kg, 5 %, 12 pt) belong together in every language.
    if (NUMBER.test(b) && (UNITS.has(a) || UNITS.has(bare(after)) || UNITS.has(after.replace(/[,;:.!?]+$/, "")))) return { cost: c.numberUnit, reason: `"${before} ${after}": number and unit split across lines.` };
    // Dates: 12. März, March 12, März 2026.
    if (german && /^\d{1,2}\.$/.test(b) && DE_MONTHS.has(bare(after))) return { cost: c.date, reason: `"${before} ${after}": date split across lines.` };
    if ((DE_MONTHS.has(bw) || EN_MONTHS.has(bw)) && /^\d{1,4}\.?,?$/.test(a)) return { cost: c.date, reason: `"${before} ${after}": date split across lines.` };
    // Initials: J. S. Bach.
    if (/^\p{Lu}\.$/u.test(b) && /^\p{Lu}/u.test(a)) return { cost: c.initials, reason: `"${before} ${after}": initials separated from the name.` };
    // Titles and names: Frau Müller, Herr Dr. Schmidt.
    if (german && DE_TITLES.has(b) && /^\p{Lu}/u.test(bare(after))) return { cost: c.abbreviation, reason: `"${before} ${after}": title separated from the name.` };
    // First and last name, proper names: two capitalised words in a row, with no punctuation between
    // (checked after the more specific title and suffix rules).
    const name = () =>
      !endsClause(before) && /^\p{Lu}\p{Ll}+$/u.test(bw) && /^\p{Lu}\p{Ll}[\p{L}-]*$/u.test(bare(after)) && !(german ? DE_ARTICLES : EN_ARTICLES).has(bw.toLowerCase())
        ? { cost: c.name, reason: `"${bw} ${bare(after)}": name split across lines.` }
        : null;

    if (german) {
      if (DE_ABBREVIATIONS.has(b) && !endsClauseAfterAbbreviation(before)) {
        return { cost: c.abbreviation, reason: `Line ends on the abbreviation "${before}".` };
      }
      if (endsClause(before)) return null;
      const n = name();
      if (n) return n;
      const lw = bw.toLowerCase();
      if (DE_ARTICLES.has(lw)) return { cost: c.article, reason: `Line ends on the article "${bw}".` };
      if (DE_PREPOSITIONS.has(lw)) return { cost: c.preposition, reason: `Line ends on the preposition "${bw}".` };
      if ([...bw].length === 1 && /\p{L}/u.test(bw)) return { cost: c.oneLetter, reason: `Line ends on the one-letter word "${bw}".` };
      return null;
    }

    if (EN_TITLES.has(b)) return { cost: c.abbreviation, reason: `"${before} ${after}": title separated from the name.` };
    if (EN_NAME_SUFFIXES.has(a) || EN_NAME_SUFFIXES.has(bare(after))) return { cost: c.nameSuffix, reason: `"${before} ${after}": name separated from ${after}.` };
    if (/^\(?(\d{1,2}|[a-z])\)$/.test(before) || /^\d{1,2}\.$/.test(before)) return { cost: c.enumerator, reason: `Line ends on the list marker "${before}".` };
    if (endsClause(before)) return null;
    const n = name();
    if (n) return n;
    const lw = bw.toLowerCase();
    if (EN_ARTICLES.has(lw)) return { cost: lw === 'a' ? c.oneLetter : c.article, reason: `Line ends on the article "${bw}".` };
    if (EN_PRONOUNS.has(bw) || EN_PRONOUNS.has(lw)) return { cost: bw === 'I' ? c.oneLetter : c.pronoun, reason: `Line ends on the pronoun "${bw}".` };
    if (EN_PREPOSITIONS.has(lw)) return { cost: c.preposition, reason: `Line ends on the preposition "${bw}".` };
    return null;
  };
}

/** "usw." and "etc." usually end a clause; most other abbreviations continue into the next word. */
function endsClauseAfterAbbreviation(token: string): boolean {
  return /[,;:!?]$/.test(token);
}
