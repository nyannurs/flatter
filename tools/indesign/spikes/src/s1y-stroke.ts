// S1 debug: how to give a tooth no stroke in UXP, so its wrap edge is exactly its geometric edge.
import { DE_TEXT, id, inNewDocument, readLines, textFrame, type Any } from './lib.ts';

inNewDocument((doc: Any) => {
  const out: Any[] = [];
  let y = 20;
  const none = doc.swatches.itemByName('None');
  const variants: [string, (r: Any) => void, boolean][] = [
    ['props at creation', () => {}, true],
    ['swatch object then weight', (r) => { r.strokeColor = none; r.strokeWeight = 0; }, false],
    ['weight as string', (r) => { r.strokeColor = none; r.strokeWeight = '0pt'; }, false],
    ['properties bag', (r) => { r.properties = { strokeColor: none, strokeWeight: 0 }; }, false],
  ];
  for (const [label, apply, atCreation] of variants) {
    const f = textFrame(doc, [y, 20, y + 200, 320], DE_TEXT[0]!, { leading: 13 });
    const cy = y + 13 - 2.25;
    const x = 20 + 296.5;
    const props: Any = { geometricBounds: [cy - 0.05, x, cy + 0.05, 340] };
    if (atCreation) Object.assign(props, { strokeWeight: 0, strokeColor: none, fillColor: none });
    const r = doc.pages.item(0).rectangles.add(props);
    let err = '';
    try { apply(r); } catch (e) { err = String(e); }
    r.textWrapPreferences.textWrapMode = id.TextWrapModes.BOUNDING_BOX_TEXT_WRAP;
    r.textWrapPreferences.textWrapSide = id.TextWrapSideOptions.LEFT_SIDE;
    r.textWrapPreferences.textWrapOffset = [0, 0, 0, 0];
    out.push({ label, err, strokeWeight: r.strokeWeight, visibleLeft: +(r.visibleBounds[1] - 20).toFixed(3), line1: +(readLines(f.parentStory)[0]!.inkEnd - 20).toFixed(3) });
    y += 220;
  }
  return { toothAt: 296.5, naturalLine1: 296.4, out };
});
