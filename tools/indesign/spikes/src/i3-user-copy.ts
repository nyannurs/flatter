// Reproduce the user's precise-tracking test (2026-10-17) on a copy of their text in a throwaway document.
// Read-only on the user's file: finds the open TestFile's untouched story (Paragraph Composer, one paragraph),
// copies its text into two threaded frames of the same size, then applies Flatter with the panel's settings.
import { liveUpdate, liveVerify, openSession, type ApplySettings } from '@flatter/indesign-adapter';
import { app, asArray, id, inNewDocument, type Any } from './lib.ts';

function sourceStory(): Any {
  // App label "flatter-i3-source" = "flatter": use the story Flatter worked on instead of the untouched copy.
  const want = String(app.extractLabel('flatter-i3-source') || '');
  for (let i = 0; i < app.documents.length; i++) {
    const d = app.documents.item(i);
    if (!String(d.name).startsWith('TestFile')) continue;
    for (let s = 0; s < d.stories.length; s++) {
      const st = d.stories.item(s);
      if (Number(st.characters.length) < 5000) continue;
      if (want === 'flatter' ? st.extractLabel('flatter') !== '' : Number(st.paragraphs.length) === 1) return st;
    }
  }
  throw new Error('TestFile with an untouched one-paragraph story is not open');
}

inNewDocument((doc: Any) => {
  const src = sourceStory();
  const frames = asArray(src.textContainers);
  const sizes = frames.map((f: Any) => { const b = f.geometricBounds.map(Number); return [b[3] - b[1], b[2] - b[0]]; });
  const [w, h] = sizes[0];
  doc.documentPreferences.pagesPerDocument = frames.length;
  const made = sizes.map(([fw, fh]: number[], i: number) => doc.pages.item(i).textFrames.add({ geometricBounds: [40, 40, 40 + fh, 40 + fw] }));
  for (let i = 1; i < made.length; i++) made[i - 1].nextTextFrame = made[i];
  const f1 = made[0];
  src.texts.item(0).duplicate(id.LocationOptions.AT_BEGINNING, f1.insertionPoints.item(0));
  const story = f1.parentStory;
  story.texts.item(0).tracking = 0;
  const sourceInfo = { paragraphs: Number(src.paragraphs.length), composer: String(src.paragraphs.item(0).composer), leading: String(src.paragraphs.item(0).leading) };
  const settings: ApplySettings = {
    zoneShare: 0.17, bandShare: 0.9, phase: 'long', mode: 'strict', hyphenation: 'safe',
    maxConsecutiveHyphens: 1, sense: true, continuous: false,
    tracking: { enabled: true, mode: 'precise', max: 30 }, ...({ epsilon: Number(app.extractLabel('flatter-i3-eps') || 0.15) } as Any),
  };
  const t0 = Date.now();
  // As in the user's test: Apply without tracking, then switch "Align line ends exactly" on in the live session.
  const { tracking: _t, ...untracked } = settings;
  const { live, report: plain } = openSession(story, untracked);
  const applyMs = Date.now() - t0;
  liveUpdate(live, settings, true);
  const report = { ...liveVerify(live), timings: plain.timings };
  const summary = (r: Any) => ({
    asPlanned: `${r.linesAsPlanned}/${r.linesPlanned}`, overset: r.oversetLines, tracked: r.trackedLines, rounds: r.rounds,
    edgeMiss: r.paragraphs.map((p: Any) => Math.round(p.plan.stats.edgeMiss * 100) / 100),
    longRange: r.paragraphs.map((p: Any) => Math.round(p.plan.stats.longEdgeRange * 100) / 100),
    shortRange: r.paragraphs.map((p: Any) => Math.round(p.plan.stats.shortEdgeRange * 100) / 100),
    mismatch: r.paragraphs.map((p: Any) => p.mismatch).filter(Boolean),
    worst: r.paragraphs.flatMap((p: Any) => p.plan.lines.filter((l: Any) => l.kind === 'band').map((l: Any) => ({
      i: l.index, role: l.role, miss: Math.round((l.available - l.targetWidth - l.gap) * 10) / 10, gap: Math.round(l.gap * 10) / 10,
      t: l.tracking, w: Math.round(l.width), hy: l.endsWithHyphen }))).sort((a: Any, c: Any) => Math.abs(c.miss) - Math.abs(a.miss)).slice(0, 8),
    misses: (() => { const m = r.paragraphs.flatMap((p: Any) => p.plan.lines.filter((l: Any) => l.kind === 'band').map((l: Any) => Math.abs(l.available - l.targetWidth - l.gap))); return [0.5, 1, 2, 5].map((x) => `${m.filter((v: number) => v <= x).length}/${m.length} within ${x} pt`); })(),
    violations: r.paragraphs.flatMap((p: Any) => p.plan.violations.map((v: Any) => `${v.kind}@${v.line}`)).slice(0, 15),
  });
  const probe = (() => {
    const pr = report.paragraphs.find((p: Any) => p.mismatch);
    if (!pr) return undefined;
    const m = pr.mismatch;
    const para = story.paragraphs.item(pr.index);
    const lines = [];
    for (let k = Math.max(0, m.line - 2); k <= m.line + 1; k++) {
      const pl = pr.plan.lines[k];
      const ln = para.lines.item(k);
      const tr = asArray(ln.characters.everyItem().tracking).map(Number);
      lines.push({ k, planned: pl && { tracking: pl.tracking, width: Math.round(pl.width * 10) / 10, steer: Math.round(pl.steerWidth * 10) / 10, role: pl.role, kind: pl.kind },
        got: { text: String(ln.contents), end: Number(ln.endHorizontalOffset), start: Number(ln.horizontalOffset), tracking: [...new Set(tr)] } });
    }
    return { para: pr.index, lines };
  })();
  // Calibration: InDesign's end of each line's last visible letter versus the planned width.
  const calib = (() => {
    const out: Any[] = [];
    for (const pr of report.paragraphs as Any[]) {
      const para = story.paragraphs.item(pr.index);
      const stop = pr.mismatch ? pr.mismatch.line : pr.plan.lines.length;
      for (let k = 0; k < stop; k++) {
        const pl = pr.plan.lines[k];
        const ln = para.lines.item(k);
        if (!ln.isValid || pl.kind !== 'band') continue;
        const chars = ln.characters;
        let j = Number(chars.length) - 1;
        while (j > 0 && /\s/.test(String(chars.item(j).contents))) j--;
        let end: number;
        try { end = Number(chars.item(j).endHorizontalOffset); } catch { break; } // overset: no position
        const start = Number(ln.horizontalOffset);
        out.push({ text: String(ln.contents), k, t: pl.tracking, n: j + 1, diff: Math.round((end - start - pl.width) * 1000) / 1000 });
      }
    }
    return out;
  })();
  const ticks: number[] = [];
  const spent = { teeth: 0, tracking: 0 };
  const port: Any = live.port;
  for (const k of ['setTeeth', 'setTracking'] as const) {
    const orig = port[k].bind(port);
    port[k] = (...a: Any[]) => { const t = Date.now(); const r = orig(...a); spent[k === 'setTeeth' ? 'teeth' : 'tracking'] += Date.now() - t; return r; };
  }
  for (const [i, max] of [25, 20, 15, 10, 15, 20, 30].entries()) {
    const t = Date.now();
    liveUpdate(live, { ...settings, tracking: { enabled: true, mode: 'precise', max } }, i === 0);
    ticks.push(Date.now() - t);
  }
  const tv = Date.now();
  const verified = liveVerify(live);
  const verifyMs = Date.now() - tv;
  const trackingInDoc = [...new Set(asArray(story.characters.everyItem().tracking).map(Number))].length;
  return {
    source: { ...sourceInfo, chars: Number(src.characters.length), width: w, height: h, frames: sizes },
    apply: { ms: applyMs, timings: report.timings, probes: (plain as Any).probes, ...summary(report) },
    calib, probe, ticksMs: ticks, spent, writes: live.port.trackingWrites,
    afterTicks: { verifyMs, ...summary(verified) },
    distinctTrackingValues: trackingInDoc,
    pass: verified.linesAsPlanned === verified.linesPlanned,
  };
});
