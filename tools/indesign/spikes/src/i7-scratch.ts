// Why are operations on Flatter's scratch frame slow in a real Apply? Rebuild it step by step and time each.
import { checkSettings, controlLayer, DomPort } from '@flatter/indesign-adapter';
import { app, asArray, id, inNewDocument, type Any } from './lib.ts';

const ATTRS = [
  'appliedFont', 'fontStyle', 'pointSize', 'appliedLanguage', 'tracking', 'kerningMethod', 'horizontalScale', 'capitalization',
  'ligatures', 'otfContextualAlternate', 'hyphenation', 'hyphenateAfterFirst', 'hyphenateBeforeLast', 'hyphenateWordsLongerThan',
  'hyphenateCapitalizedWords', 'hyphenateLastWord', 'hyphenationZone', 'hyphenWeight', 'providerHyphenationStyle', 'hyphenateLadderLimit',
];

function userStory(doc: Any): Any {
  for (let i = 0; i < app.documents.length; i++) {
    const d = app.documents.item(i);
    if (!String(d.name).startsWith('TestFile')) continue;
    for (let s = 0; s < d.stories.length; s++) {
      const st = d.stories.item(s);
      if (Number(st.characters.length) < 5000 || Number(st.paragraphs.length) !== 1) continue;
      doc.documentPreferences.pagesPerDocument = 2;
      const f1 = doc.pages.item(0).textFrames.add({ geometricBounds: [40, 40, 312, 225] });
      const f2 = doc.pages.item(1).textFrames.add({ geometricBounds: [40, 40, 312, 225] });
      f1.nextTextFrame = f2;
      st.texts.item(0).duplicate(id.LocationOptions.AT_BEGINNING, f1.insertionPoints.item(0));
      return f1.parentStory;
    }
  }
  throw new Error('TestFile not open');
}

inNewDocument((doc: Any) => {
  const story = userStory(doc);
  const para = story.paragraphs.item(0);
  const t: Record<string, Any> = {};
  const time = (k: string, fn: () => unknown) => { const s0 = Date.now(); const r = fn(); t[k] = Date.now() - s0; return r; };
  const layer = controlLayer(doc);
  const probeWords = ['Typoblindtext', 'Buchstaben', 'Hamburgefonts', 'Rafgenduks', 'Handgloves'];
  const round = (label: string) => {
    const port: Any = new DomPort(doc, story, layer);
    time(`${label}: spaceWidth`, () => port.spaceWidth(para));
    time(`${label}: spaceWidth again`, () => port.spaceWidth(para));
    const frame = port.scratchFrame(para);
    time(`${label}: 5 probeWord`, () => probeWords.forEach((w) => port.probeWord(frame, w)));
    time(`${label}: dispose`, () => port.dispose());
  };
  round('A copy as is');
  const issues = checkSettings(story).paragraphIssues;
  t.issues = issues.map((i: Any) => `${i.attribute}: ${String(i.current)} -> ${String(i.fix)}`);
  for (const issue of issues) {
    const p = story.paragraphs.item(issue.paragraph);
    try { p[issue.attribute] = issue.fix === 'fixedFromAuto' || String(issue.fix).includes('AUTO') ? (Number(p.pointSize) * Number(p.autoLeading)) / 100 : issue.fix; } catch (e) { t[`fail ${issue.attribute}`] = String(e); }
  }
  round('B after settings fixed');
  time('fix leading', () => { para.leading = (Number(para.pointSize) * Number(para.autoLeading)) / 100; });
  round('B2 after leading fixed');
  time('optical margin off', () => { story.storyPreferences.opticalMarginAlignment = false; });
  round('B3 after optical margin');
  {
    const port: Any = new DomPort(doc, story, layer);
    const n = Number(para.characters.length) - 1;
    time('D measureParagraphs', () => port.measureParagraphs([{ index: 0, start: 0, length: n, para }], Array.from(String(story.contents))));
    const frame = port.scratchFrame(para);
    t['D frame bounds after measure'] = frame.geometricBounds.map(Number);
    t['D scratch chars after measure'] = Number(frame.parentStory.characters.length);
    time('D: spaceWidth after measure', () => port.spaceWidth(para));
    time('D: 5 probeWord after measure', () => probeWords.forEach((w) => port.probeWord(frame, w)));
    time('D: dispose', () => port.dispose());
  }
  app.doScript(() => round('C inside ENTIRE_SCRIPT'), id.ScriptLanguage.UXPSCRIPT, [], id.UndoModes.ENTIRE_SCRIPT, 'i7');
  return { t };
});
