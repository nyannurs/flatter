/**
 * Speed benchmark (2026-11-18), shared by the dev panel ("bench" command) and the spike i41-speed, so the same work
 * can be timed from inside the panel and as a script InDesign runs to completion. Adobe staff say a panel's DOM calls
 * run time-shared, without priority, and suggest app.doScript for heavy work. Everything happens in a hidden
 * throwaway document that is closed without saving.
 */
import { inPoints, liveUpdate, liveVerify, openSession, removeFlatter } from '@flatter/indesign-adapter';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
declare const require: (m: string) => Any;

const DE = [
  'Ein guter Flattersatz entsteht nicht von selbst. Wer Texte linksbündig setzt, überlässt den rechten Rand scheinbar dem Zufall, doch gerade dieser Rand bestimmt, ob eine Seite ruhig oder unruhig wirkt. Die Zeilen sollen sich in einem erkennbaren Rhythmus abwechseln, ohne dass Treppen, Löcher oder Bäuche entstehen, und die Trennungen müssen stimmen, sonst stolpert der Blick über jede Zeile.',
  'In der Wachstube des alten Rathauses lagen die Druckerzeugnisse der vergangenen Woche auf einem Stapel: Flugblätter, Programmhefte und ein dünnes Verzeichnis der Ausstellungen im Staubecken der ehemaligen Mühle. Niemand hatte sie gelesen. Der Pförtner trank seinen Kaffee mit viel Zucker und wartete auf den Feierabend, während draußen ein Esel geduldig vor der leeren Kiste stand.',
  'Die Rechtschreibreform von 2006 hat das Trennen in einigen Punkten vereinfacht. Das ck bleibt zusammen, das st darf getrennt werden, und bei Zusammensetzungen wie Schifffahrt bleiben alle drei Konsonanten erhalten. Einzelne Vokale am Wortanfang oder am Wortende werden dagegen nicht mehr abgetrennt, weshalb Wörter wie Abend, Ofen oder Biomüll am Zeilenende vollständig stehen bleiben sollten.',
];

export interface BenchConfig {
  kind: 'micro' | 'apply';
  /** micro: operations per kind; apply: pages (three columns each, facing pages). */
  n: number;
  /** Show the document window (redraw included). From a panel InDesign shows it anyway. */
  visible?: boolean;
  /** apply: stop after this many verify rounds and list the first mismatches (diagnosis). */
  maxRounds?: number;
}

const asArr = <T>(v: T | T[]): T[] => (Array.isArray(v) ? v : [v]);

const timed = <T>(f: () => T): [T, number] => {
  const t0 = Date.now();
  const r = f();
  return [r, Date.now() - t0];
};

export function runBench(config: BenchConfig): Record<string, unknown> {
  const id = require('indesign');
  const doc = id.app.documents.add({ showingWindow: !!config.visible });
  const t0 = Date.now();
  try {
    return { kind: config.kind, n: config.n, ...(config.kind === 'micro' ? micro(id, doc, config.n) : apply(id, doc, config.n, config.maxRounds)), totalMs: Date.now() - t0 };
  } catch (e) {
    return { error: String(e), stack: String((e as Error)?.stack ?? '') };
  } finally {
    doc.close(id.SaveOptions.NO);
  }
}

/** Single DOM operations of the kinds Flatter uses most: moving wrap objects over text, reading bounds, writing tracking. */
function micro(id: Any, doc: Any, n: number): Record<string, number> {
  return inPoints(() => {
    doc.documentPreferences.properties = { pageWidth: 595, pageHeight: 842, facingPages: false };
    const page = doc.pages.item(0);
    const frame = page.textFrames.add({ geometricBounds: [40, 40, 800, 555] });
    frame.textFramePreferences.textColumnCount = 3;
    frame.contents = Array.from({ length: 8 }, () => DE.join('\r')).join('\r');
    const story = frame.parentStory;
    story.texts.item(0).properties = { appliedFont: 'Minion Pro\tRegular', pointSize: 9, leading: 11.5, appliedLanguage: 'German: 2006 Reform' };
    const rects: Any[] = [];
    for (let k = 0; k < n; k++) {
      const y = 50 + (k % 60) * 11.5;
      const x = 180 + Math.floor(k / 60) * 170;
      const r = page.rectangles.add({ geometricBounds: [y, x - 20, y + 0.1, x], strokeWeight: 0 });
      r.textWrapPreferences.textWrapMode = id.TextWrapModes.BOUNDING_BOX_TEXT_WRAP;
      rects.push(r);
    }
    story.recompose();
    const [, moveMs] = timed(() => {
      rects.forEach((r, k) => {
        const y = 50 + (k % 60) * 11.5;
        const x = 180 + Math.floor(k / 60) * 170 - (k % 3) * 4;
        r.geometricBounds = [y, x - 20, y + 0.1, x];
      });
      story.recompose();
    });
    const [, readMs] = timed(() => rects.forEach((r) => void r.geometricBounds));
    const [, trackMs] = timed(() => {
      for (let k = 0; k < n; k++) story.characters.itemByRange(k * 20, k * 20 + 15).tracking = (k % 7) - 3;
      story.recompose();
    });
    const [, linesMs] = timed(() => {
      for (let k = 0; k < 10; k++) void frame.lines.everyItem().baseline;
    });
    return { moveMs, readMs, trackMs, linesMs };
  });
}

/** Flatter on a long story through facing pages with three columns each (the designer's 6-column spreads). */
function apply(id: Any, doc: Any, pages: number, maxRounds?: number): Record<string, unknown> {
  const frames: Any[] = [];
  inPoints(() => {
    doc.documentPreferences.properties = { pageWidth: 595, pageHeight: 842, facingPages: true, pagesPerDocument: pages };
    doc.viewPreferences.rulerOrigin = id.RulerOrigin.PAGE_ORIGIN;
    for (let p = 0; p < pages; p++) {
      const f = doc.pages.item(p).textFrames.add({ geometricBounds: [40, 40, 802, 555] });
      f.textFramePreferences.properties = { textColumnCount: 3, textColumnGutter: 12, insetSpacing: [0, 0, 0, 0] };
      if (frames.length) frames[frames.length - 1].nextTextFrame = f;
      frames.push(f);
    }
  });
  const story = frames[0].parentStory;
  // About 20 paragraphs fill a page at 9/11.5 pt; the rest is overset.
  story.contents = Array.from({ length: pages * 20 }, (_, k) => DE[k % DE.length]).join('\r');
  story.texts.item(0).properties = { appliedFont: 'Minion Pro\tRegular', pointSize: 9, leading: 11.5, appliedLanguage: 'German: 2006 Reform' };
  const settings = { showBands: false, sense: true, zoneShare: 0.2, bandShare: 0.5, tracking: { enabled: true, mode: 'precise' as const, max: 5 }, wordSpaceShare: 0.25, ...(maxRounds !== undefined ? { maxRounds } : {}) };
  const [{ live, report }, applyMs] = timed(() => openSession(story, settings));
  const at = (sl: Any) => (sl ? `c${sl.column} y${Math.round(sl.baseline * 100) / 100} x${Math.round(sl.startX * 10) / 10}-${Math.round(sl.columnRight * 10) / 10}` : '-');
  const mismatches = report.paragraphs.filter((p) => p.mismatch).slice(0, 12).map((p) => ({ p: p.index, line: p.mismatch!.line, used: at(p.mismatch!.slotUsed), got: at(p.mismatch!.slotGot), planned: p.mismatch!.planned.text.slice(-18), gotText: p.mismatch!.got?.text.slice(-18), steer: Math.round(p.mismatch!.planned.steerWidth * 100) / 100, gotWidth: Math.round((p.mismatch!.got?.width ?? 0) * 100) / 100, hyphen: p.mismatch!.planned.hyphen, gotHyphen: p.mismatch!.got?.hyphenated, pl: (() => { const l = p.plan.lines[p.mismatch!.line]; return l ? { width: Math.round(l.width * 100) / 100, t: l.tracking, w: l.wordSpace, role: l.role, kind: l.kind } : undefined; })() }));
  // maxRounds 0: only the first steering pass. Where Flatter put the lines of the first paragraphs that came out wrong,
  // where they were before, and where InDesign set them.
  if (maxRounds === 0) {
    const s = live.session as Any;
    const got = inPoints(() => live.port.readLines());
    const fmt = (sl: Any) => `c${sl.column} y${Math.round(sl.baseline * 100) / 100}`;
    const wrong = new Set<number>();
    for (const w of s.work) {
      const used = s.usedSlots.get(w.data.index) ?? [];
      const g = got.filter((l: Any) => l.paragraph === w.data.index);
      if (used.length !== g.length || used.some((u: Any, i: number) => !g[i] || g[i].slot.column !== u.column || Math.abs(g[i].slot.baseline - u.baseline) > 0.01)) wrong.add(w.data.index);
    }
    const first = [...wrong].sort((a, b) => a - b).slice(0, 2);
    // The first line of the first wrong paragraph that InDesign broke elsewhere than planned.
    let line: Record<string, unknown> | undefined;
    const w0 = s.work.find((w: Any) => w.data.index === first[0]);
    if (w0) {
      const g = got.filter((l: Any) => l.paragraph === w0.data.index);
      const k = w0.plan.lines.findIndex((pl: Any, i: number) => {
        const r = pl.endItem > pl.startItem ? w0.measured.charRange[pl.endItem - 1] : undefined;
        return !g[i] || (r && g[i].lastVisible !== r[1] - 1);
      });
      if (k >= 0 && g[k]) {
        const slot = g[k].slot;
        const ln = story.paragraphs.item(w0.data.index).lines.item(k);
        const layer = doc.layers.itemByName('Flatter (Steuerung)');
        const teeth = layer.isValid ? (asArr(layer.pageItems.everyItem().getElements()) as Any[]) : [];
        const near = inPoints(() => teeth.filter((t) => Number(t.parentPage?.documentOffset) === slot.page).map((t) => t.geometricBounds.map(Number)).filter((b: number[]) => Math.abs(b[0]! - slot.baseline) < 14 && b[3]! > (slot.columnLeft ?? 0) && b[1]! < slot.columnRight + 6));
        const pl = w0.plan.lines[k];
        line = {
          line: k, at: fmt(slot), startX: Math.round(slot.startX * 100) / 100, contents: String(ln.contents),
          tracking: [...new Set((asArr(ln.characters.everyItem().tracking) as number[]).map(Number))],
          planned: { width: Math.round(pl.width * 100) / 100, steer: Math.round(pl.steerWidth * 100) / 100, t: pl.tracking, w: pl.wordSpace, role: pl.role },
          teeth: near.map((b: number[]) => `y${Math.round(b[0]! * 100) / 100} x${Math.round(b[1]! * 100) / 100}-${Math.round(b[3]! * 100) / 100}`),
        };
      }
    }
    const show = first.flatMap((p) => [p - 1, p]).filter((p) => p >= 0);
    removeFlatter(story);
    return {
      slotsWrong: wrong.size,
      line,
      paragraphs: show.map((p) => ({
        p,
        before: s.current.filter((l: Any) => l.paragraph === p).map((l: Any) => fmt(l.slot)).join(' '),
        planned: s.work.find((w: Any) => w.data.index === p)?.plan.lines.length,
        used: (s.usedSlots.get(p) ?? []).map(fmt).join(' '),
        got: got.filter((l: Any) => l.paragraph === p).map((l: Any) => fmt(l.slot)).join(' '),
      })),
    };
  }
  // Diagnosis: what InDesign has on the first line that is not as planned, and the teeth beside it.
  let firstBad: Record<string, unknown> | undefined;
  const bad = report.paragraphs.find((p) => p.mismatch);
  if (maxRounds && bad?.mismatch?.slotGot) {
    const g = bad.mismatch.slotGot;
    const line = story.paragraphs.item(bad.index).lines.item(bad.mismatch.line);
    const tr = (asArr(line.characters.everyItem().tracking) as number[]).map(Number);
    const layer = doc.layers.itemByName('Flatter (Steuerung)');
    const teeth = layer.isValid ? (asArr(layer.pageItems.everyItem().getElements()) as Any[]) : [];
    const near = inPoints(() => teeth.map((t) => t.geometricBounds.map(Number)).filter((b: number[]) => Math.abs(b[0]! - g.baseline) < 14 && b[3]! > g.columnLeft! && b[1]! < g.columnRight + 12));
    firstBad = { p: bad.index, line: bad.mismatch.line, contents: String(line.contents), tracking: [...new Set(tr)].slice(0, 8), teethNear: near.map((b: number[]) => b.map((v) => Math.round(v * 100) / 100)) };
  }
  const [, draftMs] = timed(() => liveUpdate(live, { ...settings, zoneShare: 0.19, draft: true }, true));
  const [, fullMs] = timed(() => liveUpdate(live, { ...settings, zoneShare: 0.19 }, false));
  const [verified, verifyMs] = timed(() => liveVerify(live));
  const [, removeMs] = timed(() => removeFlatter(story));
  return {
    chars: Number(story.characters.length),
    applyMs,
    timings: report.timings,
    rounds: report.rounds,
    roundLog: report.roundLog,
    apply: `${report.linesAsPlanned}/${report.linesPlanned}`,
    tick: { draftMs, fullMs, verifyMs, verified: `${verified.linesAsPlanned}/${verified.linesPlanned}` },
    batch: { runs: (live.port as Any).batchRuns, ms: (live.port as Any).batchMs, fallbacks: (live.port as Any).batchFallbacks },
    tracking: { writes: (live.port as Any).trackingWrites, skips: (live.port as Any).trackingSkips, ...(live.port as Any).trackingStats },
    removeMs,
    ...(maxRounds ? { mismatches, firstBad } : {}),
  };
}
