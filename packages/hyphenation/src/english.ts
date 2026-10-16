/**
 * English main joints: a small compound lexicon. A joint only becomes class A
 * when both pattern sets agree on the point, so the list decides preference only.
 */
const EN_PARTS = new Set(
  `
air any back ball base bath bed bell birth black blood board boat body book bottle box bread break
brush case care cast check child church class clock coast cook corn country court cross cup day dead
door down draw dream dress drive dust earth east every eye face fall farm father fire fish flag flash
floor flower fly foot fore free friend front gate gold grand grass green ground guard hair half hand
hard head heart high hill home horse house ice in keep keeper land last law life light line lock long
mail main make maker man mark market master mid mind moon mother news night north note off office
out over page paper pass path place play point port post power press print proof rail rain right
road room round run sail school sea set setter shelf shop side sign snow some south space stair
stand star stone store storm street style sun table tail taker time tooth top town tree type under up
wall ware watch water way week west where white wide wind window wood word work world worth writer yard
`.trim().split(/\s+/),
);

/** Joint positions where the word splits into two or three known parts. */
export function englishJoints(word: string): number[] {
  const w = word.toLowerCase();
  const out = new Set<number>();
  for (let i = 3; i <= w.length - 3; i++) {
    const head = w.slice(0, i);
    const tail = w.slice(i);
    if (!EN_PARTS.has(head)) continue;
    if (isPart(tail)) out.add(i);
    for (let k = 3; k <= tail.length - 3; k++) {
      if (EN_PARTS.has(tail.slice(0, k)) && isPart(tail.slice(k))) {
        out.add(i);
        out.add(i + k);
      }
    }
  }
  return [...out].sort((a, b) => a - b);
}

const ENDINGS = ['', 's', 'es', 'ed', 'd', 'ing', 'er', 'ers'];

/** A known part, possibly with a plural or verb ending. */
function isPart(s: string): boolean {
  return ENDINGS.some((e) => s.endsWith(e) && s.length - e.length >= 3 && EN_PARTS.has(s.slice(0, s.length - e.length)));
}

/** Leading word parts British practice keeps whole (inter-national, never af-ternoon). */
const BRITISH_LEADING_PARTS = ['after', 'counter', 'enter', 'inter', 'letter', 'manu', 'never', 'other', 'over', 'paper', 'super', 'under'];

/**
 * Spans of short word parts (at most 6 letters) that British practice keeps
 * whole: a known leading part, or a compound part found by englishJoints.
 */
export function britishWholeParts(word: string): [number, number][] {
  const w = word.toLowerCase();
  const spans: [number, number][] = [];
  for (const p of BRITISH_LEADING_PARTS) if (w.startsWith(p) && w.length - p.length >= 3) spans.push([0, p.length]);
  const bounds = [0, ...englishJoints(w), w.length];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const [a, b] = [bounds[k]!, bounds[k + 1]!];
    if (b - a <= 6 && bounds.length > 2) spans.push([a, b]);
  }
  return spans;
}
