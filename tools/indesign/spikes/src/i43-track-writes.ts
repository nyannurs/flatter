// Faster tracking writes (2026-11-18). Precise Laufweite writes one tracking value per line plus one per adjusted
// word space; on 8 pages of three columns that is about 15,000 writes and most of an Apply. This compares, on the
// same lines and values: (A) one write per line and per space, as now; (B) one write per line and one changeGrep for
// the line's spaces; each inside doScript with ENTIRE_SCRIPT and with FAST_ENTIRE_SCRIPT. App label
// "flatter-i43-pages" sets the page count (default 8).
import { app, asArray, id, inNewDocument, type Any } from './lib.ts';

const DE = [
  'Ein guter Flattersatz entsteht nicht von selbst. Wer Texte linksbündig setzt, überlässt den rechten Rand scheinbar dem Zufall, doch gerade dieser Rand bestimmt, ob eine Seite ruhig oder unruhig wirkt. Die Zeilen sollen sich in einem erkennbaren Rhythmus abwechseln, ohne dass Treppen, Löcher oder Bäuche entstehen, und die Trennungen müssen stimmen, sonst stolpert der Blick über jede Zeile.',
  'In der Wachstube des alten Rathauses lagen die Druckerzeugnisse der vergangenen Woche auf einem Stapel: Flugblätter, Programmhefte und ein dünnes Verzeichnis der Ausstellungen im Staubecken der ehemaligen Mühle. Niemand hatte sie gelesen. Der Pförtner trank seinen Kaffee mit viel Zucker und wartete auf den Feierabend, während draußen ein Esel geduldig vor der leeren Kiste stand.',
  'Die Rechtschreibreform von 2006 hat das Trennen in einigen Punkten vereinfacht. Das ck bleibt zusammen, das st darf getrennt werden, und bei Zusammensetzungen wie Schifffahrt bleiben alle drei Konsonanten erhalten. Einzelne Vokale am Wortanfang oder am Wortende werden dagegen nicht mehr abgetrennt, weshalb Wörter wie Abend, Ofen oder Biomüll am Zeilenende vollständig stehen bleiben sollten.',
];

interface Line {
  from: number;
  /** Last character that gets the line's tracking (the line's last glyph gets none). */
  to: number;
  spaces: number[];
  t: number;
  w: number;
}

inNewDocument((doc: Any) => {
  const pages = Number(app.extractLabel('flatter-i43-pages') || '8');
  doc.documentPreferences.properties = { pageWidth: 595, pageHeight: 842, facingPages: true, pagesPerDocument: pages };
  const frames: Any[] = [];
  for (let p = 0; p < pages; p++) {
    const f = doc.pages.item(p).textFrames.add({ geometricBounds: [40, 40, 802, 555] });
    f.textFramePreferences.properties = { textColumnCount: 3, textColumnGutter: 12, insetSpacing: [0, 0, 0, 0] };
    if (frames.length) frames[frames.length - 1].nextTextFrame = f;
    frames.push(f);
  }
  const story = frames[0].parentStory;
  story.contents = Array.from({ length: pages * 20 }, (_, k) => DE[k % DE.length]).join('\r');
  story.texts.item(0).properties = { appliedFont: 'Minion Pro\tRegular', pointSize: 9, leading: 11.5, appliedLanguage: 'German: 2006 Reform', composer: 'Adobe Single-line Composer' };
  story.recompose();
  // The visible lines, with Flatter-like values: tracking −5…5 per line, word spaces −30…30 on top.
  const text = Array.from(String(story.contents));
  const lines: Line[] = [];
  let k = 0;
  for (const f of frames) {
    const starts = asArray(f.lines.everyItem().index).map(Number);
    const lens = asArray(f.lines.everyItem().contents).map((c: Any) => Array.from(String(c)).length);
    starts.forEach((from, i) => {
      let last = from + lens[i]! - 1;
      while (last > from && /\s/.test(text[last] ?? '')) last--;
      const spaces: number[] = [];
      for (let c = from; c < last; c++) if (text[c] === ' ') spaces.push(c);
      lines.push({ from, to: last - 1, spaces, t: ((k * 7) % 11) - 5, w: (((k * 13) % 41) - 20) * 1.5 });
      k++;
    });
  }
  const spaceCount = lines.reduce((s, l) => s + l.spaces.length, 0);
  // Wrap objects present while writing (label "flatter-i43-wrap"): none, teeth (one 0.1 pt rectangle per line, just
  // outside the column like Flatter's idle teeth) or comb (one polygon per column with a 1 pt spike per line).
  const wrap = String(app.extractLabel('flatter-i43-wrap') || 'none');
  const colRight = (x: number) => {
    const col = Math.min(2, Math.floor((x - 40 + 1) / (163.67 + 12)));
    return 40 + col * 175.67 + 163.67;
  };
  if (wrap !== 'none') {
    const slots: { page: number; x: number; b: number }[] = [];
    frames.forEach((f, page) => {
      const xs = asArray(f.lines.everyItem().horizontalOffset).map(Number);
      const bs = asArray(f.lines.everyItem().baseline).map(Number);
      xs.forEach((x, i) => slots.push({ page, x: colRight(x), b: bs[i]! }));
    });
    if (wrap === 'teeth' || wrap === 'cutting') {
      slots.forEach((s, i) => {
        // cutting: every second line shortened by 18 pt, as steering teeth do; teeth: idle, just outside the column.
        const left = wrap === 'cutting' && i % 2 ? s.x - 18 : s.x + 1;
        const t = doc.pages.item(s.page).rectangles.add({ geometricBounds: [s.b - 3, left, s.b - 2.9, s.x + 3], strokeWeight: 0 });
        t.textWrapPreferences.properties = { textWrapMode: id.TextWrapModes.BOUNDING_BOX_TEXT_WRAP, textWrapOffset: [0, 0, 0, 0] };
      });
      story.recompose();
      // Lines moved: take their ranges again.
      lines.length = 0;
      const text2 = Array.from(String(story.contents));
      let k2 = 0;
      for (const f of frames) {
        const starts = asArray(f.lines.everyItem().index).map(Number);
        const lens = asArray(f.lines.everyItem().contents).map((c: Any) => Array.from(String(c)).length);
        starts.forEach((from, i) => {
          let last = from + lens[i]! - 1;
          while (last > from && /\s/.test(text2[last] ?? '')) last--;
          const spaces: number[] = [];
          for (let c = from; c < last; c++) if (text2[c] === ' ') spaces.push(c);
          lines.push({ from, to: last - 1, spaces, t: ((k2 * 7) % 11) - 5, w: (((k2 * 13) % 41) - 20) * 1.5 });
          k2++;
        });
      }
    } else {
      const byCol = new Map<string, number[]>();
      for (const s of slots) {
        const key = `${s.page}:${s.x}`;
        if (!byCol.has(key)) byCol.set(key, []);
        byCol.get(key)!.push(s.b);
      }
      for (const [key, bs] of byCol) {
        const [page, x] = key.split(':').map(Number) as [number, number];
        const pts: number[][] = [[x + 3, 40], [x + 3, 802], [x + 1, 802]];
        for (const b of [...bs].reverse()) pts.push([x + 1, b - 2.45], [x + 0.5, b - 2.45], [x + 0.5, b - 3.45], [x + 1, b - 3.45]);
        pts.push([x + 1, 40]);
        const poly = doc.pages.item(page).polygons.add({ strokeWeight: 0 });
        poly.paths.item(0).entirePath = pts;
        poly.textWrapPreferences.properties = { textWrapMode: id.TextWrapModes.CONTOUR, textWrapOffset: [0, 0, 0, 0] };
      }
    }
    story.recompose();
  }
  const chars = story.characters;

  const perSpace = () => {
    for (const l of lines) {
      chars.itemByRange(l.from, l.to).tracking = l.t;
      for (const c of l.spaces) chars.item(c).tracking = l.t + l.w;
    }
  };
  // As Flatter's DomPort does: before each paragraph's writes, read its style ranges (index and tracking).
  const paraOf = (c: number) => {
    let p = 0;
    for (let k2 = 0; k2 <= c; k2++) if (text[k2] === '\r') p++;
    return p;
  };
  const linePara = lines.map((l) => paraOf(l.from));
  const interleaved = () => {
    let current = -1;
    lines.forEach((l, i) => {
      if (linePara[i] !== current) {
        current = linePara[i]!;
        const ranges = story.paragraphs.item(current).textStyleRanges.everyItem();
        void ranges.index;
        void ranges.tracking;
      }
      chars.itemByRange(l.from, l.to).tracking = l.t;
      for (const c of l.spaces) chars.item(c).tracking = l.t + l.w;
    });
  };
  const grep = () => {
    const find = app.findGrepPreferences;
    const change = app.changeGrepPreferences;
    const saved = { find: find.properties, change: change.properties };
    app.findGrepPreferences = id.NothingEnum.NOTHING;
    app.changeGrepPreferences = id.NothingEnum.NOTHING;
    app.findGrepPreferences.findWhat = ' ';
    try {
      for (const l of lines) {
        const range = chars.itemByRange(l.from, l.to);
        range.tracking = l.t;
        if (!l.spaces.length) continue;
        app.changeGrepPreferences.tracking = l.t + l.w;
        range.changeGrep();
      }
    } finally {
      app.findGrepPreferences = id.NothingEnum.NOTHING;
      app.changeGrepPreferences = id.NothingEnum.NOTHING;
      try {
        app.findGrepPreferences.properties = saved.find;
        app.changeGrepPreferences.properties = saved.change;
      } catch {
        /* some saved values are read-only */
      }
    }
  };
  const tracking = () => asArray(chars.everyItem().tracking).map(Number).join(',');
  const run = (name: string, f: () => void, mode: string) => {
    story.texts.item(0).tracking = 0;
    story.recompose();
    const t0 = Date.now();
    app.doScript(f, id.ScriptLanguage.UXPSCRIPT, [], id.UndoModes[mode], name);
    story.recompose();
    return { ms: Date.now() - t0, result: tracking() };
  };
  const method = String(app.extractLabel('flatter-i43-method') || 'perSpace');
  const r = run(method, method === 'grep' ? grep : method === 'interleaved' ? interleaved : perSpace, 'ENTIRE_SCRIPT');
  return {
    pass: true,
    method,
    wrap,
    ms: r.ms,
    checksum: r.result.length,
    pages,
    lines: lines.length,
    spaces: spaceCount,
    writesNow: lines.length + spaceCount,

  };
});
