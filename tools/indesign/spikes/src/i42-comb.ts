// One comb per column instead of one tooth per line (2026-11-18). Teeth are one 0.1 pt rectangle with text wrap per
// line; a comb is one polygon per column whose spikes reach into the column at the lines to shorten, so a slider tick
// writes one path per column instead of one bounds per line. Same line ends wanted from both; this compares the time
// to create them and to move them (tick = write, recompose, read the lines back) and whether InDesign breaks the lines
// the same way. Facing pages with three columns each; app label "flatter-i42-pages" sets the page count (default 4).
import { app, asArray, id, inNewDocument, type Any } from './lib.ts';

const DE = [
  'Ein guter Flattersatz entsteht nicht von selbst. Wer Texte linksbündig setzt, überlässt den rechten Rand scheinbar dem Zufall, doch gerade dieser Rand bestimmt, ob eine Seite ruhig oder unruhig wirkt. Die Zeilen sollen sich in einem erkennbaren Rhythmus abwechseln, ohne dass Treppen, Löcher oder Bäuche entstehen, und die Trennungen müssen stimmen, sonst stolpert der Blick über jede Zeile.',
  'In der Wachstube des alten Rathauses lagen die Druckerzeugnisse der vergangenen Woche auf einem Stapel: Flugblätter, Programmhefte und ein dünnes Verzeichnis der Ausstellungen im Staubecken der ehemaligen Mühle. Niemand hatte sie gelesen. Der Pförtner trank seinen Kaffee mit viel Zucker und wartete auf den Feierabend, während draußen ein Esel geduldig vor der leeren Kiste stand.',
  'Die Rechtschreibreform von 2006 hat das Trennen in einigen Punkten vereinfacht. Das ck bleibt zusammen, das st darf getrennt werden, und bei Zusammensetzungen wie Schifffahrt bleiben alle drei Konsonanten erhalten. Einzelne Vokale am Wortanfang oder am Wortende werden dagegen nicht mehr abgetrennt, weshalb Wörter wie Abend, Ofen oder Biomüll am Zeilenende vollständig stehen bleiben sollten.',
];
const TOP = 40;
const BOTTOM = 802;
const LEFT = 40;
const WIDTH = 515;
const GUTTER = 12;
const COL = (WIDTH - 2 * GUTTER) / 3;
const CUT = 18;
const TICKS = 4;
// Spike height in points (label "flatter-i42-spike"), centred half an x-height above the baseline like a tooth.
const SPIKE = Number(app.extractLabel('flatter-i42-spike') || '0.1');

interface Slot {
  page: number;
  col: number;
  baseline: number;
}

const timed = <T>(f: () => T): [T, number] => {
  const t0 = Date.now();
  const r = f();
  return [r, Date.now() - t0];
};

inNewDocument((doc: Any) => {
  const pages = Number(app.extractLabel('flatter-i42-pages') || '4');
  doc.documentPreferences.properties = { pageWidth: 595, pageHeight: 842, facingPages: true, pagesPerDocument: pages };
  doc.viewPreferences.rulerOrigin = id.RulerOrigin.PAGE_ORIGIN;
  const frames: Any[] = [];
  for (let p = 0; p < pages; p++) {
    const f = doc.pages.item(p).textFrames.add({ geometricBounds: [TOP, LEFT, BOTTOM, LEFT + WIDTH] });
    f.textFramePreferences.properties = { textColumnCount: 3, textColumnGutter: GUTTER, insetSpacing: [0, 0, 0, 0] };
    if (frames.length) frames[frames.length - 1].nextTextFrame = f;
    frames.push(f);
  }
  const story = frames[0].parentStory;
  story.contents = Array.from({ length: pages * 20 }, (_, k) => DE[k % DE.length]).join('\r');
  story.texts.item(0).properties = {
    appliedFont: 'Minion Pro\tRegular', pointSize: 9, leading: 11.5, appliedLanguage: 'German: 2006 Reform',
    composer: 'Adobe Single-line Composer', hyphenation: false, minimumWordSpacing: 100, desiredWordSpacing: 100, maximumWordSpacing: 100,
  };
  story.recompose();
  // The lines as set without steering: their baselines stay put (fixed leading), so the slots are fixed.
  const slots: Slot[] = [];
  frames.forEach((f, page) => {
    const xs = asArray(f.lines.everyItem().horizontalOffset).map(Number);
    const bs = asArray(f.lines.everyItem().baseline).map(Number);
    xs.forEach((x, k) => slots.push({ page, col: Math.min(2, Math.floor((x - LEFT + 1) / (COL + GUTTER))), baseline: bs[k]! }));
  });
  const colRight = (c: number) => LEFT + c * (COL + GUTTER) + COL;
  // Long, short, long, short, shifted by one on every tick.
  const cuts = (phase: number) => slots.map((_, k) => ((k + phase) % 2 ? CUT : 0));
  const read = () => frames.flatMap((f) => asArray(f.lines.everyItem().contents).map(String));
  const check = (want: number[]) => {
    // A shortened line must end before its spike; read every line's end in one call per frame.
    let ok = 0;
    let k = 0;
    for (const f of frames) {
      const ends = asArray(f.lines.everyItem().endHorizontalOffset).map(Number);
      for (const e of ends) {
        const s = slots[k];
        if (s && e <= colRight(s.col) - want[k]! + 0.05) ok++;
        k++;
      }
    }
    return ok;
  };
  const natural = read();

  // Teeth: one rectangle per line, an idle one just outside the column when the line is not shortened.
  const toothBounds = (s: Slot, cut: number) => {
    const r = colRight(s.col);
    return [s.baseline - 3, cut ? r - cut : r + 1, s.baseline - 2.9, r + 3];
  };
  const [teeth, teethCreateMs] = timed(() =>
    cuts(0).map((cut, k) => {
      const s = slots[k]!;
      const t = doc.pages.item(s.page).rectangles.add({ geometricBounds: toothBounds(s, cut), strokeWeight: 0 });
      t.textWrapPreferences.properties = { textWrapMode: id.TextWrapModes.BOUNDING_BOX_TEXT_WRAP, textWrapOffset: [0, 0, 0, 0] };
      return t;
    }),
  );
  story.recompose();
  const teethLines: string[][] = [read()];
  const teethOk: number[] = [check(cuts(0))];
  const teethTicks: number[] = [];
  for (let tick = 1; tick <= TICKS; tick++) {
    const want = cuts(tick);
    const [, ms] = timed(() => {
      want.forEach((cut, k) => (teeth[k].geometricBounds = toothBounds(slots[k]!, cut)));
      story.recompose();
      teethLines.push(read());
    });
    teethTicks.push(ms);
    teethOk.push(check(want));
  }
  const [, teethRemoveMs] = timed(() => teeth.forEach((t) => t.remove()));
  story.recompose();

  // Combs: one polygon per column and page. Spine in the gutter, a 0.1 pt spike per shortened line.
  const columns = new Map<string, number[]>();
  slots.forEach((s, k) => {
    const key = `${s.page}:${s.col}`;
    if (!columns.has(key)) columns.set(key, []);
    columns.get(key)!.push(k);
  });
  const combPath = (col: number, lines: number[], want: number[]): number[][] => {
    const r = colRight(col);
    const pts: number[][] = [[r + 3, TOP], [r + 3, BOTTOM], [r + 1, BOTTOM]];
    for (const k of [...lines].reverse()) {
      const cut = want[k]!;
      if (!cut) continue;
      const b = slots[k]!.baseline;
      const lo = b - 2.95 + SPIKE / 2;
      const hi = b - 2.95 - SPIKE / 2;
      pts.push([r + 1, lo], [r - cut, lo], [r - cut, hi], [r + 1, hi]);
    }
    pts.push([r + 1, TOP]);
    return pts;
  };
  const [combs, combCreateMs] = timed(() =>
    [...columns].map(([key, lines]) => {
      const [page, col] = key.split(':').map(Number) as [number, number];
      const poly = doc.pages.item(page).polygons.add({ strokeWeight: 0 });
      poly.paths.item(0).entirePath = combPath(col, lines, cuts(0));
      poly.textWrapPreferences.properties = { textWrapMode: id.TextWrapModes.CONTOUR, textWrapOffset: [0, 0, 0, 0] };
      try {
        poly.textWrapPreferences.contourOptions.contourType = id.ContourOptionsTypes.GRAPHIC_FRAME;
      } catch {
        /* the polygon's own shape is the default */
      }
      return { poly, col, lines };
    }),
  );
  story.recompose();
  const combLines: string[][] = [read()];
  const combOk: number[] = [check(cuts(0))];
  const combTicks: number[] = [];
  for (let tick = 1; tick <= TICKS; tick++) {
    const want = cuts(tick);
    const [, ms] = timed(() => {
      for (const c of combs) c.poly.paths.item(0).entirePath = combPath(c.col, c.lines, want);
      story.recompose();
      combLines.push(read());
    });
    combTicks.push(ms);
    combOk.push(check(want));
  }

  const same = teethLines.map((t, i) => t.filter((line, k) => line === combLines[i]![k]).length);
  const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  return {
    pass: same.every((n, i) => n === teethLines[i]!.length) && combOk.every((n, i) => n >= teethOk[i]!),
    pages,
    spike: SPIKE,
    lines: slots.length,
    changedFromNatural: teethLines[0]!.filter((l, k) => l !== natural[k]).length,
    teeth: { objects: teeth.length, createMs: teethCreateMs, tickMs: teethTicks, avgTickMs: avg(teethTicks), removeMs: teethRemoveMs, linesEndingInPlace: teethOk },
    comb: { objects: combs.length, createMs: combCreateMs, tickMs: combTicks, avgTickMs: avg(combTicks), linesEndingInPlace: combOk },
    sameLinesAsTeeth: same,
  };
});
