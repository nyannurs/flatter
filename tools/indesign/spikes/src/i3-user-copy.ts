// Reproduce the user's precise-tracking test (2026-10-17) on a copy of their text in a throwaway document.
// Read-only on the user's file: finds the open TestFile's untouched story (Paragraph Composer, one paragraph),
// copies its text into two threaded frames of the same size, then applies Flatter with the panel's settings.
import { clearMeasureCache, DomPort, FlatterSession, inPoints, liveUpdate, liveVerify, openSession, type ApplySettings } from '@flatter/indesign-adapter';

// Time every DomPort method (ms and calls), for performance work.
const roundLog: string[] = [];
const profile: Record<string, { ms: number; calls: number }> = {};
for (const name of ['paragraphs', 'measureParagraph', 'probe', 'probeWord', 'scratchFrame', 'measureSecond', 'readLines', 'overset', 'frames', 'visibleEnd', 'columnWidth', 'setTeeth', 'existingTeeth', 'parkingBounds', 'setTracking', 'currentTracking', 'dropParkedTeeth', 'resetTracking', 'dispose'] as const) {
  const proto = DomPort.prototype as Any;
  const orig = proto[name];
  if (typeof orig !== 'function') continue;
  proto[name] = function (this: Any, ...args: Any[]) {
    const t = Date.now();
    try {
      return orig.apply(this, args);
    } finally {
      if (name === 'setTeeth' || name === 'setTracking' || name === 'readLines') {
        const ts = this.teethStats ?? {};
        roundLog.push(`${name} moved=${ts.moved} created=${ts.created} parked=${ts.parked} writes=${this.trackingWrites}`);
      }
      const p = (profile[name] ??= { ms: 0, calls: 0 });
      p.ms += Date.now() - t;
      p.calls++;
    }
  };
}
{
  const proto = FlatterSession.prototype as Any;
  const orig = proto.steer;
  proto.steer = function (this: Any) {
    {
      const w = this.work[0];
      const steered = this._steeredPlan ?? w.plan;
      const cur = (this.current ?? []).filter((l: Any) => l.paragraph === w.data.index);
      for (let k = 0; k < cur.length && k < steered.lines.length; k++) {
        const pl = steered.lines[k];
        const want = w.measured.charRange[pl.endItem - 1][1] - 1;
        if (cur[k].lastVisible !== want || cur[k].hyphenated !== (pl.endsWithHyphen && w.items[pl.breakAt]?.type === 'penalty' && w.items[pl.breakAt].width > 0)) {
          const t = (a: number) => w.data.chars.slice(Math.max(0, a - 18), a + 1).join('');
          roundLog.push(`  TEXT[${pl.text}]`);
          if (pl.endsWithHyphen && !roundLog.some((x) => x.startsWith('DUMP'))) {
            const slot = cur[k].slot;
            const items: string[] = [];
            const pdoc = this.port.doc;
            for (const it of asArray(pdoc.layers.itemByName('Flatter (Steuerung)').pageItems.everyItem().getElements())) {
              const b = it.geometricBounds.map(Number);
              const pg = it.parentPage ? Number(it.parentPage.documentOffset) : -1;
              if (pg === slot.page && b[0] <= slot.baseline + 3 && b[2] >= slot.baseline - 15) items.push(b.map((v: number) => v.toFixed(2)).join('/'));
            }
            
            const a = w.measured.charRange[pl.startItem][0];
            const e = w.measured.charRange[pl.endItem - 1][1];
            const para = this.port.story.paragraphs.item(w.data.index);
            const tr = asArray(para.characters.itemByRange(a, e - 1).characters.everyItem().tracking).map(Number);
            const txt = Array.from(String(para.characters.itemByRange(a, e - 1).contents));
            roundLog.push('CHARS ' + txt.map((c, i) => `${c}${tr[i]}`).join('|'));
            roundLog.push(`DUMP page=${slot.page} baseline=${slot.baseline.toFixed(2)} startX=${slot.startX} colRight=${slot.columnRight} teethNear=[${items.join(' ; ')}] trackingRange=${a}-${e} values=${[...new Set(tr)].join(',')} firstLast=${tr[0]},${tr[tr.length - 2]},${tr[tr.length - 1]}`);
          }
          roundLog.push(`  mismatch@${k} role=${pl.role} hy=${pl.endsWithHyphen}/${cur[k].hyphenated} t=${pl.tracking} w=${pl.wordSpace} steer=${pl.steerWidth.toFixed(1)} width=${pl.width.toFixed(1)} slack=${pl.slack.toFixed(1)} planned='${t(want)}' got='${t(cur[k].lastVisible)}' refused=${w.refused.join(' ')}`);
          break;
        }
      }
    }
    const r = orig.apply(this, []);
    this._steeredPlan = this.work[0].plan;
    const w = this.work[0];
    const lines = w.plan.lines;
    const slots = this.usedSlots.get(w.data.index) ?? [];
    const sig = lines.slice(0, 40).map((l: Any) => `${l.endItem}:${l.tracking}:${l.wordSpace}`).join(',');
    let h = 0;
    for (let i = 0; i < sig.length; i++) h = (h * 31 + sig.charCodeAt(i)) | 0;
    roundLog.push(`steer plan#${h} lines=${lines.length} slots=${slots.length} slot26=${slots[26] ? slots[26].baseline.toFixed(1) + '/' + slots[26].page : '-'} l26=${lines[26]?.endItem}:${lines[26]?.tracking}`);
    return r;
  };
}
const snapshot = () => Object.fromEntries(Object.entries(profile).map(([k, v]) => [k, { ...v }]));
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
  // The user's document is in millimetres: read the frame sizes in points.
  const sizes = inPoints(() => frames.map((f: Any) => { const b = f.geometricBounds.map(Number); return [b[3] - b[1], b[2] - b[0]]; }));
  const [w, h] = sizes[0];
  doc.documentPreferences.pagesPerDocument = frames.length;
  const made = sizes.map(([fw, fh]: number[], i: number) => doc.pages.item(i).textFrames.add({ geometricBounds: [40, 40, 40 + fh, 40 + fw] }));
  for (let i = 1; i < made.length; i++) made[i - 1].nextTextFrame = made[i];
  const f1 = made[0];
  src.texts.item(0).duplicate(id.LocationOptions.AT_BEGINNING, f1.insertionPoints.item(0));
  const story = f1.parentStory;
  story.texts.item(0).tracking = 0;
  const sourceInfo = { paragraphs: Number(src.paragraphs.length), composer: String(src.paragraphs.item(0).composer), leading: String(src.paragraphs.item(0).leading) };
  const defaults: ApplySettings = {
    zoneShare: 0.17, bandShare: 0.9, phase: 'long', mode: 'strict', hyphenation: 'safe',
    maxConsecutiveHyphens: 1, sense: true, continuous: false,
    tracking: { enabled: true, mode: 'precise', max: 30 }, ...({ epsilon: Number(app.extractLabel('flatter-i3-eps') || 0.15) } as Any),
    wordSpaceShare: Number(app.extractLabel('flatter-i3-words') || 0.25),
    showBands: app.extractLabel('flatter-i3-bands') !== 'off',
  };
  // App label "flatter-i3-settings": JSON settings to use instead (for example the ones stored in the user's story).
  const override = String(app.extractLabel('flatter-i3-settings') || '');
  const settings: ApplySettings = override ? JSON.parse(override) : defaults;
  clearMeasureCache();
  const t0 = Date.now();
  // As in the user's test: Apply without tracking, then switch "Align line ends exactly" on in the live session.
  const { tracking: _t, ...untracked } = settings;
  const { live, report: plain } = openSession(story, untracked);
  const applyMs = Date.now() - t0;
  const applyProfile = snapshot();
  for (const k of Object.keys(profile)) delete profile[k];
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
    violationKinds: r.paragraphs.flatMap((p: Any) => p.plan.violations.map((v: Any) => `${v.kind}:${v.severity}`)).reduce((m: Any, k: string) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {}),
  });
  // App label "flatter-i3-diag" = "off": skip the diagnostics, which read every character and slow later writes.
  const diag = app.extractLabel('flatter-i3-diag') !== 'off';
  const probe = !diag ? undefined : (() => {
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
  const calib = !diag ? [] : (() => {
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
  // At the reported mismatch: which teeth and bands touch that line, and what tracking its characters carry.
  const atMismatch = !diag ? undefined : inPoints(() => {
    const pr = report.paragraphs.find((p: Any) => p.mismatch);
    if (!pr) return undefined;
    const m = pr.mismatch;
    const slot = m.slotGot ?? m.slotUsed;
    const out: Any = { line: m.line, baseline: slot.baseline, page: slot.page };
    const items: Any[] = [];
    for (const name of ['Flatter (Steuerung)', 'Flatter (Ansicht)']) {
      const layer = doc.layers.itemByName(name);
      if (!layer.isValid) continue;
      for (const it of asArray(layer.pageItems.everyItem().getElements())) {
        const b = it.geometricBounds.map(Number);
        const pg = it.parentPage ? Number(it.parentPage.documentOffset) : -1;
        if (pg === slot.page && b[0] <= slot.baseline + 2 && b[2] >= slot.baseline - 14) items.push({ layer: name.slice(9, 13), b: b.map((v: number) => Math.round(v * 100) / 100), wrap: String(it.textWrapPreferences.textWrapMode) });
      }
    }
    out.items = items;
    const para = story.paragraphs.item(pr.index);
    const ln = para.lines.item(m.line);
    out.lineText = String(ln.contents);
    out.lineTracking = [...new Set(asArray(ln.characters.everyItem().tracking).map(Number))];
    return out;
  });
  const verifyAgain = (() => { const r = liveVerify(live); return { asPlanned: `${r.linesAsPlanned}/${r.linesPlanned}`, rounds: r.rounds, mismatch: r.paragraphs.map((p: Any) => p.mismatch?.line).filter((x: Any) => x !== undefined) }; })();
  // Does the port's line reader agree with InDesign's own line objects?
  const readerCheck = !diag ? undefined : inPoints(() => {
    const got = live.port.readLines().filter((l: Any) => l.paragraph === 0);
    const para = story.paragraphs.item(0);
    const start = Number(para.index);
    const out: Any[] = [];
    for (let k = 0; k < got.length; k++) {
      const ln = para.lines.item(k);
      const chars = ln.characters;
      const n = Number(chars.length);
      let j = n - 1;
      while (j > 0 && /^[\s\r]$/.test(String(chars.item(j).contents))) j--;
      const actual = Number(chars.item(j).index) - start;
      const contentsLen = Array.from(String(ln.contents)).length;
      if (actual !== got[k].lastVisible || contentsLen !== n) out.push({ k, reader: got[k].lastVisible, actual, contentsLen, chars: n, text: String(ln.contents).slice(-30) });
      if (out.length > 5) break;
    }
    return { lines: got.length, disagreements: out };
  });
  const ticks: number[] = [];
  const spent = { teeth: 0, tracking: 0 };
  const perTick: string[] = [];
  const port: Any = live.port;
  for (const k of ['setTeeth', 'setTracking'] as const) {
    const orig = port[k].bind(port);
    port[k] = (...a: Any[]) => { const t = Date.now(); const r = orig(...a); const ms = Date.now() - t; spent[k === 'setTeeth' ? 'teeth' : 'tracking'] += ms; perTick.push(`${k === 'setTeeth' ? 'T' : 'W'}${ms}`); return r; };
  }
  for (const [i, max] of [25, 20, 15, 10, 15, 20, 30].entries()) {
    const t = Date.now();
    liveUpdate(live, { ...settings, tracking: { enabled: true, mode: 'precise', max }, draft: true }, i === 0);
    ticks.push(Date.now() - t);
  }
  const tickProfile = snapshot();
  // As the panel does when the slider stops: the full settings (word spaces) once, then verify.
  const tf = Date.now();
  liveUpdate(live, settings, false);
  const finalPassMs = Date.now() - tf;
  const tv = Date.now();
  const verified = liveVerify(live);
  const verifyMs = Date.now() - tv;
  const trackingInDoc = diag ? [...new Set(asArray(story.characters.everyItem().tracking).map(Number))].length : undefined;
  return {
    source: { ...sourceInfo, chars: Number(src.characters.length), width: w, height: h, frames: sizes },
    apply: { ms: applyMs, timings: report.timings, probes: (plain as Any).probes, ...summary(report) },
    bands: (() => {
      const layer = doc.layers.itemByName('Flatter (Ansicht)');
      if (!layer.isValid) return { layer: false };
      const items = asArray(layer.pageItems.everyItem().getElements());
      return {
        layerIndex: Number(layer.index), controlIndex: Number(doc.layers.itemByName('Flatter (Steuerung)').index), printable: layer.printable, locked: layer.locked,
        count: items.length, wrap: [...new Set(items.map((it: Any) => String(it.textWrapPreferences.textWrapMode)))],
        opacity: items[0] ? Number(items[0].transparencySettings.blendingSettings.opacity) : undefined,
        first: items[0] ? items[0].geometricBounds.map((v: number) => Math.round(v * 10) / 10) : undefined,
      };
    })(),
    exported: (() => {
      const out = app.extractLabel('flatter-i3-png');
      if (!out) return undefined;
      // Make the view layer printable in this throwaway copy only, so it shows in the picture.
      const view = doc.layers.itemByName('Flatter (Ansicht)');
      if (view.isValid) { view.locked = false; view.printable = true; asArray(view.pageItems.everyItem().getElements()).forEach((it: Any) => { it.nonprinting = false; }); }
      app.pngExportPreferences.properties = { pageString: '1', exportResolution: 200, pngExportRange: id.PNGExportRangeEnum.EXPORT_RANGE };
      doc.exportFile(id.ExportFormat.PNG_FORMAT, out);
      return out;
    })(),
    atMismatch, roundLog: roundLog.slice(0, 60), verifyAgain, readerCheck, applyProfile, tickProfile, calib, probe, ticksMs: ticks, finalPassMs, spent, perTick, writes: live.port.trackingWrites, teethStats: (live.port as Any).teethStats, trackingStats: (live.port as Any).trackingStats,
    afterTicks: { verifyMs, ...summary(verified) },
    distinctTrackingValues: trackingInDoc,
    pass: verified.linesAsPlanned === verified.linesPlanned,
  };
});
