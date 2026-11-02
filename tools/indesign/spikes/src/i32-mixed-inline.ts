// Mixed fonts and languages inside a paragraph and inside one word (2026-11-02). Flatter reads a paragraph's language
// and the probe's font from its first character; this checks what happens when words differ from it.
// Markup in the case texts: [tag:text] formats that range (see TAGS); the tags are removed from the text.
import { applyFlatter, readLanguageRuns, removeFlatter } from '@flatter/indesign-adapter';
import { asArray, DE_TEXT, inNewDocument, readLines, type Any } from './lib.ts';

const FAMILY = 'Source Serif Pro';
const TAGS: Record<string, Record<string, unknown>> = {
  en: { appliedLanguage: 'English: USA' },
  none: { appliedLanguage: '[No Language]' },
  b: { fontStyle: 'Bold' },
  i: { fontStyle: 'Italic' },
  mf: { appliedFont: 'Minion Pro\tRegular' },
  big: { pointSize: 12 },
};

const BASE = 'Ein guter Flattersatz entsteht nicht von selbst. Wer Texte linksbündig setzt, überlässt den rechten Rand scheinbar dem Zufall, doch gerade dieser Rand bestimmt, ob eine Seite ruhig oder unruhig wirkt.';
const CASES: Record<string, string> = {
  'German only': `${BASE} Im Studio sprach man nur von Typografie, Lesbarkeit, Verständlichkeit und Kommunikation, von professionellen Fotografinnen und internationalen Konferenzen, von Druckerzeugnissen und Verlagsprogrammen.`,
  'English words': `${BASE} Im Studio sprach man nur von [en:typography], [en:readability], [en:understanding] und [en:communication], von [en:professional] [en:photographers] und [en:international] [en:conferences], von [en:publications] und [en:characteristics].`,
  'Starts in English': `[en:“Less is more,”] sagte der Typograf. ${BASE} Im Studio sprach man nur von Typografie, Lesbarkeit, Verständlichkeit und Kommunikation, von Druckerzeugnissen und Verlagsprogrammen.`,
  'English half-word': `${BASE} Im Studio sprach man von [en:Layout]entscheidungen, [en:Workflow]optimierungen, [en:Corporate]-[en:Design]-Handbüchern und [en:Typography]wettbewerben, von [en:Interface]gestaltung und [en:Publishing]strategien.`,
  'No language': `${BASE} Im Studio sprach man nur von [none:Typografieprogrammen], [none:Verständlichkeit] und [none:Kommunikationsdesign], von [none:Druckerzeugnissen] und [none:Verlagsprogrammen].`,
  'Bold and italic inside words': `${BASE} Im Studio sprach man nur von Flatter[b:satzregeln], [i:Zeilen]umbrüchen, Silben[b:trennungen] und [i:Kommunikations]design, von Druck[b:erzeugnissen] und Verlags[i:programmen].`,
  'Other font inside words': `${BASE} Im Studio sprach man nur von Flatter[mf:satzregeln], [mf:Zeilen]umbrüchen, Silben[mf:trennungen] und [mf:Kommunikations]design, von Druck[mf:erzeugnissen] und Verlags[mf:programmen].`,
  'Bigger size inside words': `${BASE} Im Studio sprach man nur von Flatter[big:satzregeln], [big:Zeilen]umbrüchen, Silben[big:trennungen] und [big:Kommunikations]design, von Druck[big:erzeugnissen] und Verlags[big:programmen].`,
  'Starts bold': `[b:Vorspann:] ${BASE} Im Studio sprach man nur von Typografie, Lesbarkeit, Verständlichkeit und Kommunikation, von Druckerzeugnissen und Verlagsprogrammen.`,
};

function parse(marked: string): { text: string; ranges: { from: number; to: number; tag: string }[] } {
  const ranges: { from: number; to: number; tag: string }[] = [];
  let text = '';
  let at = 0;
  for (const m of marked.matchAll(/\[(\w+):([^\]]+)\]/g)) {
    text += marked.slice(at, m.index);
    const from = Array.from(text).length;
    text += m[2];
    ranges.push({ from, to: Array.from(text).length, tag: m[1]! });
    at = m.index! + m[0].length;
  }
  return { text: text + marked.slice(at), ranges };
}

inNewDocument((doc: Any) => {
  const out: Record<string, unknown> = {};
  let pass = true;
  for (const width of [190, 260]) {
    for (const [name, marked] of Object.entries(CASES)) {
      const { text, ranges } = parse(marked);
      const f = doc.pages.item(0).textFrames.add({ geometricBounds: [40, 40, 900, 40 + width] });
      f.textFramePreferences.insetSpacing = [0, 0, 0, 0];
      f.contents = text;
      const story = f.parentStory;
      story.texts.item(0).properties = { appliedFont: `${FAMILY}\tRegular`, pointSize: 10, leading: 13, appliedLanguage: 'German: 2006 Reform' };
      for (const r of ranges) story.characters.itemByRange(r.from, r.to - 1).properties = TAGS[r.tag]!;
      const r = applyFlatter(story, { showBands: false, zoneShare: 0.2, bandShare: 0.5 });
      const p = r.paragraphs[0]!;
      const langs = asArray(story.characters.everyItem().appliedLanguage).map((l: Any) => String(l.name));
      const hyphens = readLines(story)
        .filter((l) => l.hyphenated)
        .map((l) => {
          const m = /(\p{L}+)$/u.exec(l.text.replace(/\s+$/u, ''));
          const next = /^(\p{L}+)/u.exec(text.slice(l.last + 1));
          return `${m?.[1] ?? ''}-${next?.[1] ?? ''} (${langs[l.last]!.replace(/: .*/, '')})`;
        });
      // Every line as planned; a German paragraph opening in English is still hyphenated as German; words in
      // [No Language] cost no extra rounds and are never hyphenated.
      const noLanguage = name === 'No language';
      const ok = r.linesAsPlanned === r.linesPlanned && r.rounds <= 3 && (!noLanguage || hyphens.every((h) => !h.includes('No Language'))) &&
        (name !== 'Starts in English' || width !== 190 || hyphens.length > 0);
      if (!ok) pass = false;
      out[`${width} ${name}`] = {
        ok,
        lines: `${r.linesAsPlanned}/${r.linesPlanned}`,
        rounds: r.rounds,
        paraLanguage: String(story.paragraphs.item(0).appliedLanguage.name),
        refused: p.refused,
        hyphens,
        ...(p.mismatch ? { mismatch: { line: p.mismatch.line, planned: p.mismatch.planned.text.slice(-24), got: p.mismatch.got?.text.slice(-24), width: p.mismatch.got?.width, steer: p.mismatch.planned.steerWidth } } : {}),
      };
      removeFlatter(story);
      f.remove();
    }
  }
  // Cost of reading the language runs on a long story after Apply with tracking (every tracked line is a range).
  const f = doc.pages.item(0).textFrames.add({ geometricBounds: [40, 40, 1500, 1100] });
  f.textFramePreferences.textColumnCount = 4;
  f.contents = Array.from({ length: 20 }, () => DE_TEXT.join('\r')).join('\r');
  const story = f.parentStory;
  story.texts.item(0).properties = { appliedFont: `${FAMILY}\tRegular`, pointSize: 9, leading: 11, appliedLanguage: 'German: 2006 Reform' };
  applyFlatter(story, { showBands: false, zoneShare: 0.2, bandShare: 0.5, tracking: { enabled: true, mode: 'precise', max: 5 }, wordSpaceShare: 0.25 });
  // The first read after Apply pays for InDesign composing the story; time the runs after that.
  let t0 = Date.now();
  void String(story.contents);
  const composeMs = Date.now() - t0;
  t0 = Date.now();
  const runs = readLanguageRuns(story);
  out.longStory = { paragraphs: Number(story.paragraphs.length), textStyleRanges: Number(story.textStyleRanges.length), runs: runs.length, composeMs, readMs: Date.now() - t0 };
  removeFlatter(story);
  return { pass, ...out };
});
