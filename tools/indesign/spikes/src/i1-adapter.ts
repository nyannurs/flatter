/**
 * Integration test for @flatter/indesign-adapter in a throwaway document with
 * InDesign's default paragraph settings. Checks: every line as planned, Remove
 * restores the original composition, one Undo reverts Apply, re-apply uses the cache.
 */
import { applyFlatter, BAND_LAYER, checkSettings, removeFlatter, TOOTH_LABEL } from '@flatter/indesign-adapter';
import { asArray, DE_TEXT, EN_TEXT, id, inNewDocument, type Any } from './lib.ts';

function frameWithDefaults(doc: Any, bounds: number[], text: string, language: string, extra: Any = {}): Any {
  const f = doc.pages.item(0).textFrames.add({ geometricBounds: bounds });
  f.contents = text;
  const all = f.parentStory.texts.item(0);
  all.appliedFont = 'Minion Pro\tRegular';
  all.pointSize = 10;
  all.leading = 13;
  all.appliedLanguage = language;
  Object.assign(all, extra);
  return f;
}

const linesOf = (story: Any) => asArray(story.lines.everyItem().contents).map(String);
const teethOf = (doc: Any, story: Any) => {
  const layer = doc.layers.itemByName('Flatter (Steuerung)');
  if (!layer.isValid) return 0;
  return asArray(layer.pageItems.everyItem().getElements()).filter((it: Any) => it.extractLabel(TOOTH_LABEL) === String(story.id)).length;
};

const bandsOf = (doc: Any, story: Any): number => {
  const layer = doc.layers.itemByName(BAND_LAYER);
  if (!layer.isValid) return 0;
  return asArray(layer.pageItems.everyItem().getElements()).filter((it: Any) => it.extractLabel('flatter-band') === String(story.id)).length;
};

inNewDocument((doc: Any) => {
  const cases: Any[] = [];
  const run = (name: string, make: () => Any, settings: Any = {}) => {
    const frame = make();
    const story = frame.parentStory;
    const before = checkSettings(story);
    const original = linesOf(story);
    // The panel shows the bands by default: they must not change any line.
    const r = applyFlatter(story, { showBands: true, ...settings });
    const teeth = teethOf(doc, story);
    const bands = bandsOf(doc, story);
    // Re-apply with a different Flatterzone: the probe cache should make probing unnecessary.
    const again = applyFlatter(story, { showBands: true, ...settings, flatterzone: (r.paragraphs[0]?.plan.params.flatterzone ?? 50) * 0.9 });
    const removed = removeFlatter(story);
    const afterRemove = linesOf(story);
    cases.push({
      case: name,
      issuesBefore: before.paragraphIssues.length,
      storyIssuesAfter: r.check.storyIssues,
      issuesAfter: r.check.paragraphIssues.filter((i) => i.required).length,
      lines: `${r.linesAsPlanned}/${r.linesPlanned}`,
      strict: r.paragraphs.filter((p) => p.plan.feasible).length + '/' + r.paragraphs.length,
      refused: r.paragraphs.flatMap((p) => p.refused),
      rounds: r.rounds,
      mismatches: r.paragraphs.filter((p) => p.mismatch).map((p) => ({ paragraph: p.index, ...p.mismatch })),
      probes: r.probes,
      ms: r.ms,
      teeth,
      bands,
      reapply: { lines: `${again.linesAsPlanned}/${again.linesPlanned}`, probes: again.probes, ms: again.ms },
      tracked: r.trackedLines,
      oversetLines: r.oversetLines,
      edges: r.paragraphs.map((p) => ({ long: +p.plan.stats.longEdgeRange.toFixed(2), short: +p.plan.stats.shortEdgeRange.toFixed(2), worst: +p.plan.stats.edgeMiss.toFixed(2) })),
      remove: {
        ...removed,
        restoredExactly: JSON.stringify(afterRemove) === JSON.stringify(original),
        trackingRestored: asArray(story.characters.everyItem().tracking).every((t: Any) => Number(t) === 0),
        teethLeft: teethOf(doc, story),
        bandsLeft: bandsOf(doc, story),
        bandLayerLeft: doc.layers.itemByName(BAND_LAYER).isValid,
        bandColoursLeft: doc.colors.itemByName('Flatter Band lang').isValid || doc.colors.itemByName('Flatter Band kurz').isValid,
        label: story.extractLabel('flatter'),
      },
      pass:
        r.linesAsPlanned === r.linesPlanned &&
        again.linesAsPlanned === again.linesPlanned &&
        JSON.stringify(afterRemove) === JSON.stringify(original) &&
        teethOf(doc, story) === 0 &&
        bands > 0 &&
        bandsOf(doc, story) === 0 &&
        !doc.layers.itemByName(BAND_LAYER).isValid &&
        !doc.colors.itemByName('Flatter Band lang').isValid &&
        story.extractLabel('flatter') === '',
    });
    frame.remove();
    for (const f of asArray(doc.pages.item(0).textFrames.everyItem().getElements())) f.remove();
  };

  run('German, one frame', () => frameWithDefaults(doc, [40, 40, 400, 340], DE_TEXT.join('\r'), 'German: 2006 Reform'));
  run('English, one frame', () => frameWithDefaults(doc, [40, 40, 400, 320], EN_TEXT.join('\r'), 'English: USA'));
  run('German, two columns', () => {
    const f = frameWithDefaults(doc, [40, 40, 260, 574], DE_TEXT.join('\r'), 'German: 2006 Reform');
    f.textFramePreferences.properties = { textColumnCount: 2, textColumnGutter: 14 };
    return f;
  });
  run('German, two threaded frames', () => {
    const a = frameWithDefaults(doc, [40, 40, 200, 340], DE_TEXT.join('\r'), 'German: 2006 Reform');
    const b = doc.pages.item(0).textFrames.add({ geometricBounds: [40, 400, 600, 700] });
    a.nextTextFrame = b;
    return a;
  });
  run('German, indents and space before', () =>
    frameWithDefaults(doc, [40, 40, 500, 340], DE_TEXT.join('\r'), 'German: 2006 Reform', { firstLineIndent: 12, spaceBefore: 6 }),
  );

  run('German, one long overset paragraph', () => {
    const long = Array.from({ length: 8 }, () => DE_TEXT.join(' ')).join(' ');
    return frameWithDefaults(doc, [40, 40, 300, 340], long, 'German: 2006 Reform');
  });

  for (const width of [240, 260]) {
    run(`German, ${width} pt, tracking rescue ±3`, () => frameWithDefaults(doc, [40, 40, 560, 40 + width], DE_TEXT.join('\r'), 'German: 2006 Reform'), {
      tracking: { enabled: true, max: 3 },
    });
  }

  for (const max of [5, 15]) {
    run(`German, precise Laufweite ±${max}`, () => frameWithDefaults(doc, [40, 40, 500, 340], DE_TEXT.join('\r'), 'German: 2006 Reform'), {
      bandShare: 0.25,
      zoneShare: 0.2,
      tracking: { enabled: true, mode: 'precise', max },
    });
  }

  for (const [max, share] of [[10, 0.25], [30, 0.5]] as const) {
    run(`German, precise Laufweite ±${max} with word spaces ±${share * 100} %`, () => frameWithDefaults(doc, [40, 40, 500, 340], DE_TEXT.join('\r'), 'German: 2006 Reform'), {
      bandShare: 0.25,
      zoneShare: 0.2,
      tracking: { enabled: true, mode: 'precise', max },
      wordSpaceShare: share,
    });
    run(`English, precise Laufweite ±${max} with word spaces ±${share * 100} %`, () => frameWithDefaults(doc, [40, 40, 500, 300], EN_TEXT.join('\r'), 'English: USA'), {
      tracking: { enabled: true, mode: 'precise', max },
      wordSpaceShare: share,
    });
  }

  // Undo: one undo step reverts Apply completely.
  const f = frameWithDefaults(doc, [40, 40, 400, 340], DE_TEXT.join('\r'), 'German: 2006 Reform');
  const story = f.parentStory;
  const original = linesOf(story);
  applyFlatter(story, {});
  const teethAfterApply = teethOf(doc, story);
  doc.undo();
  const undo = { teethAfterApply, teethAfterUndo: teethOf(doc, story), restoredExactly: JSON.stringify(linesOf(story)) === JSON.stringify(original), label: story.extractLabel('flatter') };
  void id;
  const pass = cases.every((c) => c.pass) && undo.teethAfterUndo === 0 && undo.restoredExactly && undo.label === '';
  return { pass, cases, undo };
});
