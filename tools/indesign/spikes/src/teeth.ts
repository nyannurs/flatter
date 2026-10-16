import { id, type Any } from './lib.ts';

/**
 * A wrap tooth: a 0.1 pt high rectangle from x to right, centred on cy, with no stroke and no fill.
 * The stroke must be set when the object is created (or through \`properties\`): in UXP,
 * \`rect.strokeWeight = 0\` silently does nothing, and the default 1 pt stroke moves the wrap edge
 * 0.5 pt to the left (spike S1).
 */
export function tooth(doc: Any, cy: number, x: number, right: number, height = 0.1): Any {
  const none = doc.swatches.itemByName('None');
  const r = doc.pages.item(0).rectangles.add({
    geometricBounds: [cy - height / 2, x, cy + height / 2, right],
    strokeWeight: 0,
    strokeColor: none,
    fillColor: none,
  });
  r.textWrapPreferences.properties = {
    textWrapMode: id.TextWrapModes.BOUNDING_BOX_TEXT_WRAP,
    textWrapSide: id.TextWrapSideOptions.LEFT_SIDE,
    textWrapOffset: [0, 0, 0, 0],
  };
  return r;
}
