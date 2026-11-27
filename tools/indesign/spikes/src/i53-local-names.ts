// Names that follow InDesign's own language (ADR-039, 2026-11-27): a German InDesign refused "Adobe Single-line
// Composer". Checks that the panel looks up the names through ExtendScript and that language names get locale codes.
// In an English InDesign the names come back in English; the codes show the lookup works from UXP.
import { DE_TEXT, id, inNewDocument, type Any } from './lib.ts';
import { isNoLanguage, knownHyphenLanguage, localeOf, localNames, readLanguageRuns } from '@flatter/indesign-adapter';

inNewDocument((doc: Any) => {
  const names = localNames();
  const f = doc.pages.item(0).textFrames.add({ geometricBounds: [60, 60, 400, 300] });
  f.contents = DE_TEXT.slice(0, 3).join('\r');
  const s = f.parentStory;
  s.texts.item(0).properties = { appliedFont: 'Minion Pro\tRegular', pointSize: 10, leading: 13, appliedLanguage: names.german, composer: names.singleLineComposer };
  // UXP refuses '$ID/' keys for languages too: pick them by locale code.
  const all = id.app.languagesWithVendors.everyItem().getElements() as Any[];
  const byLocale = (code: string) => all.find((l) => String(l.icuLocaleName) === code);
  s.paragraphs.item(1).appliedLanguage = byLocale('en_GB');
  s.paragraphs.item(2).appliedLanguage = byLocale('en_US_POSIX');
  const runs = readLanguageRuns(s);
  const languages = [...new Set(runs.map((r) => r.language))].map((n) => ({ name: n, locale: localeOf(n), hyphen: knownHyphenLanguage(n) ?? null, none: isNoLanguage(n) }));
  const composer = String(s.paragraphs.item(0).composer);
  const none = doc.swatches.itemByName(names.none).isValid;
  const pass = composer === names.singleLineComposer && none && languages.length === 3 && languages.every((l) => l.locale) &&
    languages.some((l) => l.hyphen === 'de') && languages.some((l) => l.hyphen === 'en-GB') && languages.some((l) => l.none && l.hyphen === null);
  return { pass, names, composer, none, languages };
});
