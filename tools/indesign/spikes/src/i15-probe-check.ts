// Does probing return InDesign's hyphenation points for the user's story? (Copy, throwaway document.)
import { controlLayer, DomPort, hyphenLanguage, inPoints } from '@flatter/indesign-adapter';
import { createHyphenator } from '@flatter/hyphenation';
import { app, asArray, id, inNewDocument, type Any } from './lib.ts';

inNewDocument((doc: Any) => {
  let src: Any;
  for (let i = 0; i < app.documents.length; i++) {
    const d = app.documents.item(i);
    if (!String(d.name).startsWith('TestFile')) continue;
    for (let s = 0; s < d.stories.length; s++) if (d.stories.item(s).extractLabel('flatter')) src = d.stories.item(s);
  }
  const f = doc.pages.item(0).textFrames.add({ geometricBounds: [36, 36, 806, 295] });
  src.texts.item(0).duplicate(id.LocationOptions.AT_BEGINNING, f.insertionPoints.item(0));
  const story = f.parentStory;
  const out: Any = {};
  story.paragraphs.item(0).hyphenateLastWord = false;
  for (const lang of [undefined, 'German: 2006 Reform']) {
    if (lang) story.texts.item(0).appliedLanguage = lang;
    const port: Any = new DomPort(doc, story, controlLayer(doc));
    inPoints(() => {
      const data = port.paragraphs()[0];
      const words = ['Typoblindtext', 'Buchstaben', 'Hamburgefonts', 'Schriften', 'Voreinstellungen', 'Kapitälchen', 'Ligaturen', 'demonstrandum', 'happiness', 'pleasure'];
      const probed = port.probe(words, data);
      const h = createHyphenator({ language: hyphenLanguage(data.language) });
      out[lang ?? 'as is'] = {
        language: data.language,
        para: { hyphenation: story.paragraphs.item(0).hyphenation, after: story.paragraphs.item(0).hyphenateAfterFirst, before: story.paragraphs.item(0).hyphenateBeforeLast, longer: story.paragraphs.item(0).hyphenateWordsLongerThan },
        words: words.map((w) => `${w}: indesign=[${probed?.get(w)}] ours=[${h.classify(w).map((p) => p.index + p.quality).join(' ')}]`),
      };
      port.dispose();
    });
  }
  return out;
});
