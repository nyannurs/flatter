// Step through probing one word in the scratch frame and report what InDesign sets at each width.
import { controlLayer, DomPort, inPoints } from '@flatter/indesign-adapter';
import { asArray, inNewDocument, type Any } from './lib.ts';

inNewDocument((doc: Any) => {
  const f = doc.pages.item(0).textFrames.add({ geometricBounds: [36, 36, 806, 295] });
  f.contents = 'Dies ist ein Typoblindtext mit Buchstaben und Voreinstellungen.';
  const story = f.parentStory;
  story.texts.item(0).properties = { appliedFont: 'Minion Pro\tRegular', pointSize: 12, appliedLanguage: 'German: 2006 Reform', hyphenation: true };
  const port: Any = new DomPort(doc, story, controlLayer(doc));
  return inPoints(() => {
    const para = story.paragraphs.item(0);
    const frame = port.scratchFrame(para);
    const s = frame.parentStory;
    const t = s.texts.item(0);
    const before = { contents: String(s.contents), hyphenation: t.hyphenation, lang: String(t.appliedLanguage.name), font: String(t.appliedFont.name), size: t.pointSize, bounds: frame.geometricBounds.map(Number), layerVisible: frame.itemLayer.visible };
    const word = 'Voreinstellungen';
    s.texts.item(0).contents = 'x ' + word;
    const after = { hyphenation: s.texts.item(0).hyphenation, lang: String(s.texts.item(0).appliedLanguage.name), size: s.texts.item(0).pointSize, after: s.texts.item(0).hyphenateAfterFirst, before: s.texts.item(0).hyphenateBeforeLast, longer: s.texts.item(0).hyphenateWordsLongerThan, zone: s.texts.item(0).hyphenationZone, composer: String(s.texts.item(0).composer) };
    const left = Number(frame.geometricBounds[1]);
    const steps: Any[] = [];
    for (const w of [2000, 90, 80, 70, 60, 50, 40, 30]) {
      frame.geometricBounds = [0, left, 100, left + w];
      steps.push([w, String(s.lines.item(0).contents), Number(s.lines.length)]);
    }
    const points = port.probeWord(frame, word);
    port.dispose();
    return { before, after, steps, points };
  });
});
