// Builds "InDesign Test File/Flatter Stress Test.indd" (designer's request, 2026-10-30): every case tested so far on
// its own page, named in a label on the non-printing layer "Test notes", so the designer can run them by hand.
// The document is in millimetres on purpose. Run: tools/indesign/run.sh tools/indesign/spikes/dist/i40-stress-file.idjs
// with the app label "flatter-stress-path" set to the full path of the .indd to write.
import { inPoints } from '@flatter/indesign-adapter';
import { DE_TEXT, EN_TEXT, app, id, type Any } from './lib.ts';

const W = 595.28;
const H = 841.89;
const SPECIALS = [
  ' Siehe S.\u00a0123 und Abb.\u00a04, dazu 10\u2009km Fußweg.',
  ' Dazwischen – ein Gedanke — und noch einer … am Ende.',
  ' Sie sagte: „Das ist ein ‚Zitat‘ im Zitat“ und »so weiter«.',
  ' Die Donau\u00addampf\u00adschiff\u00adfahrts\u00adgesellschaft fuhr weiter.',
  ' Mehr unter https://www.example.org/\u200bverzeichnis/\u200bausstellungen/\u200b2026/\u200bstaubecken-der-muehle im Netz.',
  ' Schreiben Sie eine E\u2011Mail an die Max-Planck-Gesellschaft.',
  ' Hier folgt ein erzwungener\nZeilenumbruch mitten im Absatz.',
  ' Eine Tabelle:\tSpalte eins\tSpalte zwei.',
];
const URL_TEXT = 'Die Ausstellung ist auch im Netz zu sehen: https://www.example.org/\u200bverzeichnis/\u200bausstellungen/\u200b2026/\u200bstaubecken-der-muehle/\u200bprogramm. Dort finden sich auch die Adressen der Leihgeber, eine Liste aller Werke und die Öffnungszeiten.';

let out: Any;
const path = String(app.extractLabel('flatter-stress-path') || '');
const doc = app.documents.add({ showingWindow: false });
try {
  if (!path) throw new Error('set the app label flatter-stress-path');
  inPoints(() => {
    doc.documentPreferences.properties = { pageWidth: W, pageHeight: H, facingPages: false, pagesPerDocument: 1 };
    doc.viewPreferences.rulerOrigin = id.RulerOrigin.PAGE_ORIGIN;
  });
  doc.viewPreferences.horizontalMeasurementUnits = id.MeasurementUnits.MILLIMETERS;
  doc.viewPreferences.verticalMeasurementUnits = id.MeasurementUnits.MILLIMETERS;
  const textLayer = doc.layers.item(0);
  textLayer.name = 'Test text';
  const notes = doc.layers.add({ name: 'Test notes', printable: false, layerColor: id.UIColors.GRAY });
  const minion = (style: string) => `Minion Pro\t${style}`;
  const styles = {
    head: doc.paragraphStyles.add({ name: 'Head (centred)', appliedFont: minion('Bold'), pointSize: 16, leading: 19, spaceBefore: 12, spaceAfter: 4, justification: id.Justification.CENTER_ALIGN }),
    lead: doc.paragraphStyles.add({ name: 'Lead', appliedFont: minion('Italic'), pointSize: 12, leading: 15, spaceAfter: 6 }),
    body: doc.paragraphStyles.add({ name: 'Body', appliedFont: minion('Regular'), pointSize: 10, leading: 13, firstLineIndent: 10 }),
    small: doc.paragraphStyles.add({ name: 'Small', appliedFont: minion('Regular'), pointSize: 8, leading: 10, spaceBefore: 4 }),
    plain: doc.paragraphStyles.add({ name: 'Plain', appliedFont: minion('Regular'), pointSize: 10, leading: 13 }),
    note: doc.paragraphStyles.add({ name: 'Test note', appliedFont: minion('Regular'), pointSize: 9, leading: 12 }),
    noteHead: doc.paragraphStyles.add({ name: 'Test note head', appliedFont: minion('Bold'), pointSize: 13, leading: 16, spaceAfter: 3 }),
  };
  styles.head.nextStyle = styles.lead;
  styles.lead.nextStyle = styles.body;
  styles.body.nextStyle = styles.body;

  const page = (k: number): Any => {
    while (doc.pages.length <= k) doc.pages.add();
    return doc.pages.item(k);
  };
  const setText = (frame: Any, paras: [string, Any][], language = 'German: 2006 Reform') => {
    const story = frame.parentStory;
    story.contents = paras.map((p) => p[0]).join('\r');
    paras.forEach((p, i) => story.paragraphs.item(i).applyParagraphStyle(p[1], true));
    story.texts.item(0).appliedLanguage = language;
    return story;
  };
  const frame = (k: number, b: number[], cols = 1): Any =>
    inPoints(() => {
      const f = page(k).textFrames.add({ geometricBounds: b, itemLayer: textLayer });
      f.textFramePreferences.textColumnCount = cols;
      f.textFramePreferences.textColumnGutter = 12;
      return f;
    });
  const cases: string[] = [];
  const label = (k: number, title: string, lines: string[], height = 120) => {
    cases.push(`${title} — page ${k + 1}`);
    const f = inPoints(() => page(k).textFrames.add({ geometricBounds: [24, 36, 24 + height, W - 36], itemLayer: notes }));
    const story = setText(f, [[title, styles.noteHead], ...lines.map((l): [string, Any] => [l, styles.note])], 'English: USA');
    void story;
  };
  const plain = (texts: string[]): [string, Any][] => texts.map((t) => [t, styles.plain]);

  // Page 2 onwards: the cases. Page 1 lists them (filled in at the end).
  let k = 1;

  // 1. The long story.
  {
    const start = k;
    label(start, 'Case 1: A long story with everything', [
      'One story threaded through the next pages: frames of different widths, one, two and three columns, an image with text wrap, four paragraph styles in a fixed order (Head centred → Lead → Body → Small), one very long paragraph, column, frame and page breaks, forced line breaks, no-break and thin spaces, dashes, quotes, soft hyphens, a no-break hyphen, a URL with discretionary line breaks, and tabs.',
      'Do: click into the text, press Apply. Then move the Flatterzone slider.',
      'Expect: the headings stay centred; every other paragraph is ragged; the report names the paragraphs with a tab ("contains a tab"); no pink alarm. Note how long Apply and a slider move take.',
    ], 130);
    const specs: [number, number[], number][] = [];
    specs.push([start, [170, 40, 800, 555], 2]);
    specs.push([start + 1, [40, 40, 800, 320], 1]);
    specs.push([start + 2, [40, 40, 800, 555], 1]);
    specs.push([start + 3, [40, 40, 800, 555], 3]);
    specs.push([start + 4, [40, 120, 800, 475], 1]);
    for (let p = start + 5; p < start + 12; p++) specs.push([p, [40, 40, 800, 555], p % 3 === 0 ? 1 : 2]);
    const frames = specs.map(([p, b, c]) => frame(p, b, c));
    frames.forEach((f, i) => { if (i) frames[i - 1].nextTextFrame = f; });
    inPoints(() => {
      const img = page(start + 2).rectangles.add({ geometricBounds: [300, 330, 460, 555], itemLayer: textLayer, fillColor: doc.swatches.itemByName('Black'), fillTint: 15 });
      img.textWrapPreferences.textWrapMode = id.TextWrapModes.BOUNDING_BOX_TEXT_WRAP;
      img.textWrapPreferences.textWrapOffset = [8, 8, 8, 8];
    });
    const paras: [string, Any][] = [];
    for (let g = 0; g < 10; g++) {
      paras.push([`Kapitel ${g + 1}: Über den Rand und die Zeilen`, styles.head]);
      paras.push(['Ein einleitender Absatz in kursiver Schrift, der etwas länger ist als eine Zeile und den Ton des Kapitels setzt.', styles.lead]);
      for (let j = 0; j < 5; j++) {
        const base = DE_TEXT[(g + j) % DE_TEXT.length]!;
        paras.push([g === 3 && j === 2 ? Array(12).fill(base).join(' ') : base + SPECIALS[(g * 5 + j) % SPECIALS.length], styles.body]);
      }
      paras.push([`Abb. ${g + 1}: Bildunterschrift in kleiner Schrift, zwei Zeilen lang, damit auch sie einen Rand hat.`, styles.small]);
    }
    const story = setText(frames[0], paras);
    const at = (share: number) => Math.floor(paras.length * share);
    const brk = (pi: number, kind: Any, middle = false) => {
      const para = story.paragraphs.item(pi);
      (middle ? para.insertionPoints.item(Math.floor(Number(para.characters.length) / 2)) : para.insertionPoints.item(-2)).contents = kind;
    };
    brk(at(0.13), id.SpecialCharacters.COLUMN_BREAK);
    brk(at(0.3), id.SpecialCharacters.FRAME_BREAK);
    brk(at(0.46), id.SpecialCharacters.PAGE_BREAK);
    brk(at(0.63), id.SpecialCharacters.COLUMN_BREAK, true);
    k = start + 12;
  }

  // 2. Forced line breaks and blank paragraphs.
  label(k, 'Case 2: Forced line breaks and blank paragraphs', [
    'A paragraph that starts with a forced line break (Shift+Return), one with two of them inside, an empty paragraph and one of spaces only, in three paragraph styles.',
    'Do: click into the text, press Apply; try Aesthetic and Functional.',
    'Expect: no error, no pink alarm, all lines as planned; the empty and the spaces-only paragraph are left alone; the centred heading stays centred.',
  ]);
  setText(frame(k, [170, 40, 800, 300]), [
    ['Ein Titel über zwei Zeilen, der lang genug ist, um zu brechen', styles.head],
    [DE_TEXT[0]!, styles.body],
    ['', styles.body],
    ['\n' + DE_TEXT[1]!, styles.body],
    ['   ', styles.body],
    [DE_TEXT[2]!, styles.small],
    [DE_TEXT[0]! + '\n\n' + DE_TEXT[1]!, styles.body],
  ]);
  k++;

  // 3. URL.
  label(k, 'Case 3: A URL with discretionary line breaks', [
    'The URL contains discretionary line breaks (Type → Insert Break Character → Discretionary Line Break) after each slash.',
    'Do: Apply on each frame.',
    'Expect: the URL breaks only after a slash, without a hyphen, and every line is set as planned.',
  ]);
  setText(frame(k, [170, 40, 500, 230]), plain([URL_TEXT]));
  setText(frame(k, [170, 260, 500, 400]), plain([URL_TEXT]));
  k++;

  // 4. Capitals.
  label(k, 'Case 4: Small caps, all caps and ß', [
    'Six frames: Small Caps, All Caps and OpenType All Small Caps (Character panel menu), each once without ß and once with ß.',
    'Do: Apply on each frame.',
    'Expect: without ß every line is set as planned. With ß, the report says "contains a ß in All Caps or Small Caps" and some lines may break early (InDesign needs more room for ß in capitals than it draws), but no pink alarm.',
  ], 130);
  {
    const caps = [['SMALL_CAPS', 'Small Caps'], ['ALL_CAPS', 'All Caps'], ['CAP_TO_SMALL_CAP', 'OpenType All Small Caps']] as const;
    caps.forEach(([cap], i) => {
      for (const [row, withSharp] of [[0, false], [1, true]] as const) {
        const text = DE_TEXT[1]!.slice(0, 260) + ' Draußen stand ein Esel.';
        const f = frame(k, [170 + row * 320, 40 + i * 175, 470 + row * 320, 200 + i * 175]);
        const story = setText(f, plain([withSharp ? text : text.replace(/ß/g, 'ss')]));
        story.texts.item(0).capitalization = id.Capitalization[cap];
      }
    });
  }
  k++;

  // 5. Threaded frames of different widths.
  label(k, 'Case 5: Threaded frames of different widths', [
    'One story through three frames: wide, narrow, medium.',
    'Do: Apply, then move the sliders.',
    'Expect: each frame keeps its own rhythm and band; all lines as planned.',
  ]);
  {
    const f1 = frame(k, [170, 40, 380, 400]);
    const f2 = frame(k, [400, 40, 600, 220]);
    const f3 = frame(k, [620, 40, 800, 330]);
    f1.nextTextFrame = f2;
    f2.nextTextFrame = f3;
    setText(f1, plain([...DE_TEXT, DE_TEXT[0]!]));
  }
  k++;

  // 6. Two languages.
  label(k, 'Case 6: Two languages', [
    'Left: German text tagged English. Right: English text tagged German.',
    'Do: select the left frame, press German, then Apply. Select the right frame, press English, then Apply.',
    'Expect: hyphenation fits each language; the panel shows "Now: German" / "Now: English".',
  ]);
  setText(frame(k, [170, 40, 700, 280]), plain(DE_TEXT), 'English: USA');
  setText(frame(k, [170, 315, 700, 555]), plain(EN_TEXT), 'German: 2006 Reform');
  k++;

  // 7. Shape and Sense.
  label(k, 'Case 7: Shape ↔ Sense', [
    'Three frames with the same text.',
    'Do: Apply on each, with Shape ↔ Sense at Shape only (left end), Balanced (middle) and Sense first (right end). Turn on "Align line ends exactly" to see the trade best.',
    'Expect: towards Sense, fewer lines end on an article or preposition (see the notes in the report); at Sense first none, and a line may leave the rhythm instead.',
  ]);
  for (let i = 0; i < 3; i++) setText(frame(k, [170, 40 + i * 175, 800, 200 + i * 175]), plain(DE_TEXT));
  k++;

  // 8. Duplicate.
  label(k, 'Case 8: Duplicate a frame after Apply', [
    'Do: Apply on the frame. Then duplicate it (Alt-drag, or Edit → Duplicate) and press Apply on the copy.',
    'Expect: the copy is set as planned too (before 0.5.2 most of its lines went wrong).',
  ]);
  setText(frame(k, [170, 40, 800, 250]), plain(DE_TEXT));
  k++;

  // 9. Edit after Apply.
  label(k, 'Case 9: Edit the text after Apply', [
    'Do: Apply. Then delete the first sentence, or change the type size, and move a slider.',
    'Expect: Flatter measures again by itself; no pink alarm.',
  ]);
  setText(frame(k, [170, 40, 800, 280]), plain(DE_TEXT));
  k++;

  // 10. Freeze.
  label(k, 'Case 10: Freeze and Unfreeze', [
    'Do: Apply, then Freeze. Look at the hidden characters (Type → Show Hidden Characters): every line ends in a forced line break. Then Unfreeze.',
    'Expect: frozen, the rag stays exactly the same; Unfreeze removes exactly those breaks and hyphens and the live rag comes back.',
  ]);
  setText(frame(k, [170, 40, 800, 280]), plain(DE_TEXT));
  k++;

  // 11. Narrow column.
  label(k, 'Case 11: A narrow column', [
    'A 45 mm column of German text with long words.',
    'Do: Apply with the default settings, then try a wider Flatterzone.',
    'Expect: no errors from Flatter itself; in a column this narrow some lines may miss their band, which the report lists.',
  ]);
  setText(frame(k, [170, 40, 800, 168]), plain(DE_TEXT));
  k++;

  // 12. Functional.
  label(k, 'Case 12: Functional style', [
    'Do: Apply, then switch Aesthetic → Functional and move the Flutter slider.',
    'Expect: lines end anywhere in the teal zone, break at punctuation and Sinneinheiten where possible, no staircases.',
  ]);
  setText(frame(k, [170, 40, 800, 300]), plain(DE_TEXT));
  k++;

  // Page 1: the list of cases.
  {
    const f = inPoints(() => page(0).textFrames.add({ geometricBounds: [40, 40, 800, W - 40], itemLayer: notes }));
    setText(f, [
      ['Flatter stress test', styles.noteHead],
      ['Each case is on its own page with a note at the top (layer "Test notes", not printed). Click into a case’s text and use the Flatter panel. The document is in millimetres on purpose.', styles.note],
      ...cases.map((c): [string, Any] => [c, styles.note]),
    ], 'English: USA');
  }
  notes.locked = true;
  doc.save(path);
  out = { saved: path, pages: Number(doc.pages.length), cases };
} catch (e) {
  out = { error: String(e), stack: String((e as Error)?.stack ?? '') };
} finally {
  doc.close(id.SaveOptions.NO);
}
app.insertLabel('flatter-result', JSON.stringify(out, null, 1));
