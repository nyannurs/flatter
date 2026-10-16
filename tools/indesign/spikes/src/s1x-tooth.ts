// S1 debug: one tooth on one line. Which lines does it shorten, and to what width?
import { DE_TEXT, id, inNewDocument, readLines, textFrame, type Any } from './lib.ts';

inNewDocument((doc: Any) => {
  const out: Any[] = [];
  let y = 20;
  const lead = 13;
  const trial = (label: string, line: number, toothX: number, h: number, mode: string, offsetY = 0) => {
    const f = textFrame(doc, [y, 20, y + 200, 320], DE_TEXT[0]!, { leading: lead });
    const baseline = y + lead * (line + 1);
    const cy = baseline - 2.25 + offsetY;
    const r = doc.pages.item(0).rectangles.add({ geometricBounds: [cy - h / 2, 20 + toothX, cy + h / 2, 340] });
    r.strokeWeight = 0;
    r.fillColor = 'None';
    r.textWrapPreferences.textWrapMode = id.TextWrapModes[mode];
    r.textWrapPreferences.textWrapSide = id.TextWrapSideOptions.LEFT_SIDE;
    r.textWrapPreferences.textWrapOffset = [0, 0, 0, 0];
    const gb = r.geometricBounds;
    const lines = readLines(f.parentStory).slice(0, 4).map((l) => +(l.inkEnd - l.start).toFixed(2));
    out.push({ label, toothOnLine: line + 1, toothX, h, mode, rectBounds: gb.map((v: number) => +v.toFixed(2)), wrapOffset: r.textWrapPreferences.textWrapOffset, widths: lines });
    y += 220;
  };
  // Baseline without any tooth.
  const f0 = textFrame(doc, [y, 20, y + 200, 320], DE_TEXT[0]!, { leading: lead });
  out.push({ label: 'no tooth', widths: readLines(f0.parentStory).slice(0, 4).map((l) => +(l.inkEnd - l.start).toFixed(2)) });
  y += 220;
  // Line 1 ends "setzt," at 296.40 pt; the following space is about 2.27 pt.
  for (const x of [296.5, 296.6, 296.7, 296.8, 296.9, 297.0, 297.1, 297.2, 297.3, 297.4]) trial(`tooth at ${x}`, 0, x, 0.1, 'BOUNDING_BOX_TEXT_WRAP');
  return { out };
});
