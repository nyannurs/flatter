/**
 * Development channel (dev builds only). Lets a terminal script drive the
 * loaded panel without clicks: write a JSON command to the application label
 * "flatter-dev-command"; the panel answers in "flatter-dev-result".
 * Commands: { "cmd": "ping" } and { "cmd": "s4", "ticks": 20 } (spike S4: live latency).
 */
import { liveUpdate, liveVerify, openSession, removeFlatter } from '@flatter/indesign-adapter';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
declare const require: (m: string) => Any;

const POLL_MS = 300;

const TEXT = [
  'Ein guter Flattersatz entsteht nicht von selbst. Wer Texte linksbündig setzt, überlässt den rechten Rand scheinbar dem Zufall, doch gerade dieser Rand bestimmt, ob eine Seite ruhig oder unruhig wirkt. Die Zeilen sollen sich in einem erkennbaren Rhythmus abwechseln, ohne dass Treppen, Löcher oder Bäuche entstehen, und die Trennungen müssen stimmen, sonst stolpert der Blick über jede Zeile.',
  'In der Wachstube des alten Rathauses lagen die Druckerzeugnisse der vergangenen Woche auf einem Stapel: Flugblätter, Programmhefte und ein dünnes Verzeichnis der Ausstellungen im Staubecken der ehemaligen Mühle. Niemand hatte sie gelesen. Der Pförtner trank seinen Kaffee mit viel Zucker und wartete auf den Feierabend, während draußen ein Esel geduldig vor der leeren Kiste stand.',
  'Die Rechtschreibreform von 2006 hat das Trennen in einigen Punkten vereinfacht. Das ck bleibt zusammen, das st darf getrennt werden, und bei Zusammensetzungen wie Schifffahrt bleiben alle drei Konsonanten erhalten. Einzelne Vokale am Wortanfang oder am Wortende werden dagegen nicht mehr abgetrennt, weshalb Wörter wie Abend, Ofen oder Biomüll am Zeilenende vollständig stehen bleiben sollten.',
];

const yieldToHost = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export function startDevChannel(): void {
  const { app } = require('indesign');
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    const raw = app.extractLabel('flatter-dev-command');
    if (!raw) return;
    app.insertLabel('flatter-dev-command', '');
    busy = true;
    let result: unknown;
    try {
      const cmd = JSON.parse(raw);
      if (cmd.cmd === 'ping') result = { ok: true, panel: 'Flatter', time: new Date().toISOString() };
      else if (cmd.cmd === 's4') result = await s4(Number(cmd.ticks ?? 20), !!cmd.visible, !!cmd.mergeFirst);
      else result = { error: `unknown command ${cmd.cmd}` };
    } catch (e) {
      result = { error: String(e), stack: String((e as Error)?.stack ?? '') };
    } finally {
      busy = false;
    }
    app.insertLabel('flatter-dev-result', JSON.stringify(result, null, 1));
  }, POLL_MS);
}

/** Spike S4: slider tick → plan → teeth → recomposition, on a ~40-line frame. Throwaway document. */
async function s4(ticks: number, visible: boolean, mergeFirst = false): Promise<unknown> {
  const id = require('indesign');
  const { app } = id;
  const doc = app.documents.add({ showingWindow: visible });
  try {
    doc.viewPreferences.properties = { horizontalMeasurementUnits: id.MeasurementUnits.POINTS, verticalMeasurementUnits: id.MeasurementUnits.POINTS };
    const frame = doc.pages.item(0).textFrames.add({ geometricBounds: [40, 40, 760, 340] });
    frame.contents = [...TEXT, ...TEXT].join('\r');
    frame.parentStory.texts.item(0).properties = { appliedFont: 'Minion Pro\tRegular', pointSize: 10, leading: 13, appliedLanguage: 'German: 2006 Reform' };
    const story = frame.parentStory;
    const t0 = Date.now();
    const { live, report } = openSession(story, { zoneShare: 0.2, bandShare: 0.5 });
    const openMs = Date.now() - t0;
    // A person moves the slider some time after Apply; let InDesign finish composing and redrawing first.
    await yieldToHost();
    await new Promise<void>((r) => setTimeout(r, 500));
    story.recompose();
    const plan: number[] = [];
    const solveOnly: number[] = [];
    const perTick: string[] = [];
    const compose: number[] = [];
    const yielded: number[] = [];
    for (let k = 0; k < ticks; k++) {
      const share = 0.12 + (0.13 * (k % 10)) / 9;
      const p0 = Date.now();
      live.session.plan({ zoneShare: share, bandShare: 0.5 });
      solveOnly.push(Date.now() - p0);
      const st0 = { ...live.port.teethStats };
      const a = Date.now();
      liveUpdate(live, { zoneShare: share, bandShare: 0.5 }, k === 0 && !mergeFirst);
      const b = Date.now();
      story.recompose();
      void story.lines.length;
      const c = Date.now();
      await yieldToHost();
      const d = Date.now();
      plan.push(b - a);
      const st1 = live.port.teethStats;
      perTick.push(`${b - a}ms c${st1.created - st0.created} m${st1.moved - st0.moved} p${st1.parked - st0.parked} l${st1.relabelled - st0.relabelled}`);
      compose.push(c - a);
      yielded.push(d - a);
    }
    const v0 = Date.now();
    const verified = liveVerify(live);
    const verifyMs = Date.now() - v0;
    const stats = (xs: number[]) => ({ mean: Math.round(xs.reduce((s, x) => s + x, 0) / xs.length), max: Math.max(...xs), min: Math.min(...xs) });
    const lines = story.lines.length;
    const teeth = live.port.existingTeeth().length;
    removeFlatter(story);
    return {
      lines,
      visible,
      openMs,
      firstApply: `${report.linesAsPlanned}/${report.linesPlanned}`,
      solveOnlyMs: stats(solveOnly),
      tickPlanAndTeethMs: stats(plan),
      teeth,
      tickUntilRecomposedMs: stats(compose),
      tickUntilHostYieldMs: stats(yielded),
      verifyMs,
      afterVerify: `${verified.linesAsPlanned}/${verified.linesPlanned}`,
      ticksOver100: compose.filter((x) => x >= 100).length,
      allTicks: compose,
      perTick,
      pass: Math.max(...compose) < 100,
    };
  } finally {
    doc.close(id.SaveOptions.NO);
  }
}
