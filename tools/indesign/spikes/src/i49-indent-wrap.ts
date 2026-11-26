// Indents next to text wrap (2026-11-26): where does a line end (left-aligned, tooth from the right) or start
// (right-aligned, tooth from the left) when the paragraph has left, right and first-line indents, with InDesign's
// "honour text indents with text wrap" on and off? Throwaway document.
import { app, id, inNewDocument } from './lib.ts';

inNewDocument((doc: any) => {
  const out: Record<string, unknown> = {};
  const text = Array.from({ length: 160 }, () => 'i').join(' ');
  for (const honour of [true, false]) {
    doc.textPreferences.honourTextIndentsWithTextWrap = honour;
    for (const align of ['LEFT_ALIGN', 'RIGHT_ALIGN']) {
      const f = doc.pages.item(0).textFrames.add({ geometricBounds: [50, 100, 300, 400] });
      f.textFramePreferences.insetSpacing = [0, 0, 0, 0];
      f.contents = text;
      f.parentStory.texts.item(0).properties = { appliedFont: 'Minion Pro\tRegular', pointSize: 10, leading: 13, hyphenation: false, composer: 'Adobe Single-line Composer' };
      const para = f.parentStory.paragraphs.item(0);
      para.properties = { justification: id.Justification[align], leftIndent: 15, rightIndent: 20, firstLineIndent: 10 };
      const base = f.lines.item(0).baseline;
      // A tooth on the first line's x-height: from the right at x 300 (left-aligned), from the left at x 200 (right-aligned).
      const r = doc.pages.item(0).rectangles.add({ geometricBounds: align === 'LEFT_ALIGN' ? [base - 6, 300, base - 3, 402] : [base - 6, 98, base - 3, 200] });
      r.textWrapPreferences.textWrapMode = id.TextWrapModes.BOUNDING_BOX_TEXT_WRAP;
      r.textWrapPreferences.textWrapOffset = [0, 0, 0, 0];
      f.parentStory.recompose();
      const lines = [0, 1].map((k) => {
        const l = f.lines.item(k);
        return { start: +Number(l.horizontalOffset).toFixed(2), end: +Number(l.endHorizontalOffset).toFixed(2) };
      });
      out[`${honour ? 'honour' : 'ignore'} ${align}`] = { tooth: align === 'LEFT_ALIGN' ? 'left edge 300' : 'right edge 200', firstLine: lines[0], secondLine: lines[1] };
      r.remove();
      f.remove();
    }
  }
  return out;
});
