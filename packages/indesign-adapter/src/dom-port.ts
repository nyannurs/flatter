/**
 * The Port implemented with the InDesign DOM (UXP). Only this file and dom.ts
 * touch InDesign. Findings from docs/spike-results.md are applied throughout:
 * bulk reads, teeth without stroke set at creation, the control layer on top,
 * probing with "x <word>" in a scratch frame, settings re-applied in place.
 */
import type { BandSpec, LineSlot, ToothSpec } from './geometry.ts';
import type { ParagraphData, Port, ReadLine, TrackingSpan } from './port.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Any = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const require: (m: string) => any;
export const indesign = (): Any => require('indesign');

export const CONTROL_LAYER = 'Flatter (Steuerung)';
export const TOOTH_LABEL = 'flatter-tooth';
export const PROBE_LABEL = 'flatter-probe';
/** Probe cache entries from other versions are dropped (see the DomPort constructor). */
const PROBE_VERSION = 'v2';
const TOLERANCE = 0.4;

/**
 * The tracking a paragraph had before Flatter, when Flatter has no record of it. An even paragraph
 * keeps its value. A mixed one (left over from an earlier Flatter run whose record was lost, for
 * example after the paragraph was split) falls back to its paragraph style's tracking. Reading the
 * first letter, as before, would turn a tracked first line into the whole paragraph's base.
 */
export function baseTrackingOf(para: Any): number {
  const values = asArray(para.textStyleRanges.everyItem().tracking).map(Number);
  if (values.every((v) => v === values[0])) return values[0] || 0;
  return Number(para.appliedParagraphStyle?.tracking) || 0;
}

export const asArray = <T>(v: T | T[]): T[] => (Array.isArray(v) ? v : [v]);

/**
 * Measurements kept while the plugin is loaded, keyed by the paragraph's formatting signature and
 * text: re-applying a long paragraph does not re-measure it. clearMeasureCache() forces a fresh measure
 * (the panel's Recompute does this, e.g. after changing formatting inside a paragraph).
 */
const measureCache = new Map<string, number[]>();
export function clearMeasureCache(): void {
  measureCache.clear();
}

/** Find or create the control layer, keep it on top, never printing, never suppressing wrap. */
export function controlLayer(doc: Any): Any {
  const id = indesign();
  let layer = doc.layers.itemByName(CONTROL_LAYER);
  if (!layer.isValid) {
    const active = doc.activeLayer;
    layer = doc.layers.add({ name: CONTROL_LAYER });
    doc.activeLayer = active;
  }
  layer.properties = { printable: false, suppressTextWrapWhenLayerHidden: false, locked: false };
  if (layer.index !== 0) layer.move(id.LocationOptions.AT_BEGINNING);
  return layer;
}

/** Layer for the band view: just below the control layer, never printed, locked against stray clicks. */
export const BAND_LAYER = 'Flatter (Ansicht)';
export const BAND_LABEL = 'flatter-band';
/** Band colours, as in the playground: blue for the long band, orange for the short band. */
const BAND_COLORS = { long: { name: 'Flatter Band lang', rgb: [37, 99, 235] }, short: { name: 'Flatter Band kurz', rgb: [234, 88, 12] } } as const;
const BAND_OPACITY = 22;

/** The band layer, created on demand, placed second from the top (under the control layer). */
export function bandLayer(doc: Any): Any {
  const id = indesign();
  let layer = doc.layers.itemByName(BAND_LAYER);
  if (!layer.isValid) {
    const active = doc.activeLayer;
    layer = doc.layers.add({ name: BAND_LAYER });
    doc.activeLayer = active;
  }
  layer.properties = { printable: false, locked: false };
  const control = doc.layers.itemByName(CONTROL_LAYER);
  if (control.isValid) {
    if (Number(layer.index) !== 1) layer.move(id.LocationOptions.AFTER, control);
  } else if (Number(layer.index) !== 0) layer.move(id.LocationOptions.AT_BEGINNING);
  return layer;
}

/** Remove a story's bands; the layer and colours go when no bands are left in the document. */
export function removeBands(doc: Any, storyKey: string): number {
  const layer = doc.layers.itemByName(BAND_LAYER);
  if (!layer.isValid) return 0;
  layer.locked = false;
  let removed = 0;
  for (const it of asArray(layer.pageItems.everyItem().getElements())) {
    if (it.extractLabel(BAND_LABEL) === storyKey) {
      it.remove();
      removed++;
    }
  }
  if (!Number(layer.pageItems.length)) {
    layer.remove();
    for (const c of Object.values(BAND_COLORS)) {
      const sw = doc.colors.itemByName(c.name);
      if (sw.isValid) sw.remove();
    }
  } else layer.locked = true;
  return removed;
}

/** Paragraph attributes copied into the probe frame so InDesign hyphenates the same way. */
const PROBE_ATTRIBUTES = [
  'appliedFont', 'fontStyle', 'pointSize', 'appliedLanguage', 'tracking', 'kerningMethod', 'horizontalScale', 'capitalization',
  'ligatures', 'otfContextualAlternate', 'hyphenation', 'hyphenateAfterFirst', 'hyphenateBeforeLast', 'hyphenateWordsLongerThan',
  'hyphenateCapitalizedWords', 'hyphenateLastWord', 'hyphenationZone', 'hyphenWeight', 'providerHyphenationStyle', 'hyphenateLadderLimit',
];

export class DomPort implements Port {
  private readonly id = indesign();
  private scratch: Any | undefined;
  private paragraphsCache: ParagraphData[] | undefined;
  private paraStarts: number[] = [];
  private probeCache: Record<string, Record<string, number[]>>;
  probes = 0;

  readonly doc: Any;
  readonly story: Any;
  readonly layer: Any;

  constructor(doc: Any, story: Any, layer: Any) {
    this.doc = doc;
    this.story = story;
    this.layer = layer;
    // Only keep results of the current probe version: before version 2 probing returned nothing in a
    // story Fix Settings had touched (Hyphenate Last Word), and those empty results were cached.
    const stored = parseJson<Record<string, Record<string, number[]>>>(doc.extractLabel(PROBE_LABEL)) ?? {};
    this.probeCache = Object.fromEntries(Object.entries(stored).filter(([k]) => k.startsWith(PROBE_VERSION)));
  }

  storyKey(): string {
    return String(this.story.id);
  }

  overset(): boolean {
    return !!this.story.overflows;
  }

  /** Story index of the last character that sits in a frame (-1 if none). Overset text has no position. */
  private visibleEnd(): number {
    const containers = asArray(this.story.textContainers);
    for (let k = containers.length - 1; k >= 0; k--) {
      const chars = containers[k].characters;
      if (chars.length) return Number(chars.lastItem().index);
    }
    return -1;
  }

  paragraphs(): ParagraphData[] {
    if (this.paragraphsCache) return this.paragraphsCache;
    const story = this.story;
    const text = Array.from(String(story.contents));
    const count = story.characters.length;
    if (text.length !== count) throw new Error(`story text (${text.length}) and characters (${count}) do not line up`);
    const paras = story.paragraphs;
    const n = paras.length;
    const lengths = asArray(paras.everyItem().contents).map((c: Any) => Array.from(String(c)).length);
    const sizes = asArray(paras.everyItem().pointSize).map(Number);
    const leadings = asArray(paras.everyItem().leading);
    const autoLeading = asArray(paras.everyItem().autoLeading).map(Number);
    const left = asArray(paras.everyItem().leftIndent).map(Number);
    const right = asArray(paras.everyItem().rightIndent).map(Number);
    const first = asArray(paras.everyItem().firstLineIndent).map(Number);
    const column = this.columnWidth();
    const visibleEnd = this.visibleEnd();
    const out: ParagraphData[] = [];
    let start = 0;
    this.paraStarts = [];
    for (let p = 0; p < n; p++) {
      const len = lengths[p]!;
      this.paraStarts.push(start);
      const end = start + len;
      // Leave out paragraphs that start in the overset text: none of their lines can be steered.
      // A paragraph that starts in a frame is planned whole; only its visible lines get teeth.
      if (start <= visibleEnd && len > 1) {
        let chars = text.slice(start, end);
        if (chars[chars.length - 1] === '\r') chars = chars.slice(0, -1);
        const para = paras.item(p);
        // Measure on very wide lines in the probe frame (spike S2): exact, and independent of where
        // the story currently breaks (a letter before a break loses its kerning, a space at a line
        // end has an unreliable width).
        const key = `${this.probeKey(para)}\u0000${chars.join('')}`;
        let advances = measureCache.get(key);
        let trackedAdvances = measureCache.get(`tracked\u0000${key}`);
        if (!advances || !trackedAdvances) {
          ({ advances, trackedAdvances } = this.measureParagraph(para, chars.length));
          measureCache.set(key, advances);
          measureCache.set(`tracked\u0000${key}`, trackedAdvances);
        }
        const size = sizes[p]!;
        const lead = typeof leadings[p] === 'number' ? (leadings[p] as number) : (size * autoLeading[p]!) / 100;
        const hKey = `hyphen\u0000${this.probeKey(para)}`;
        let hyphenWidth = measureCache.get(hKey)?.[0];
        if (hyphenWidth === undefined) {
          hyphenWidth = this.hyphenWidth(para);
          measureCache.set(hKey, [hyphenWidth]);
        }
        out.push({
          index: p,
          chars,
          advances,
          trackedAdvances,
          language: String(para.appliedLanguage.name),
          hyphenWidth,
          size,
          leading: lead,
          measure: column - left[p]! - right[p]!,
          firstLineIndent: first[p]!,
        });
      }
      start = end;
    }
    this.paragraphsCache = out;
    return out;
  }

  probe(words: readonly string[], data: ParagraphData): Map<string, number[]> {
    const para = this.story.paragraphs.item(data.index);
    const key = this.probeKey(para);
    const cache = (this.probeCache[key] ??= {});
    const missing = words.filter((w) => !(w in cache));
    if (missing.length) {
      const frame = this.scratchFrame(para);
      for (const w of missing) cache[w] = w.includes('-') ? this.probeCompound(frame, w) : this.probeWord(frame, w);
      this.doc.insertLabel(PROBE_LABEL, JSON.stringify(this.probeCache));
    }
    return new Map(words.map((w) => [w, cache[w] ?? []]));
  }

  readLines(): ReadLine[] {
    const story = this.story;
    story.recompose();
    if (!this.paraStarts.length) this.paragraphs();
    const text = Array.from(String(story.contents));
    const frames = this.frames();
    const containers = asArray(story.textContainers);
    const sizeOf = new Map((this.paragraphsCache ?? []).map((p) => [p.index, p.size]));
    const out: ReadLine[] = [];
    const lineInPara = new Map<number, number>();
    let first = -1;
    containers.forEach((container: Any, ci: number) => {
      // Lines are read per frame: overset lines have no baseline, and reading them throws.
      const lines = container.lines;
      const n = lines.length;
      if (!n) return;
      const contents = asArray(lines.everyItem().contents).map((c: Any) => Array.from(String(c)));
      const xs = asArray(lines.everyItem().horizontalOffset).map(Number);
      const baselines = asArray(lines.everyItem().baseline).map(Number);
      if (first < 0) first = Number(lines.item(0).characters.item(0).index);
      const frame = frames[ci]!;
      for (let i = 0; i < n; i++) {
        const len = contents[i]!.length;
        const p = this.paragraphAt(first);
        const pStart = this.paraStarts[p]!;
        let last = first + len - 1;
        while (last > first && /^[\s\r]$/.test(text[last] ?? '')) last--;
        const lastChar = text[first + len - 1] ?? '';
        const nextChar = text[first + len] ?? '';
        const col = frame.columns.find((c) => xs[i]! >= c.left - 0.5 && xs[i]! <= c.right + 0.5) ?? frame.columns[0]!;
        const slot: LineSlot = { page: frame.page, baseline: baselines[i]!, startX: xs[i]!, columnRight: col.right, gutter: col.gutter, size: sizeOf.get(p) ?? 10, limit: frame.bottom };
        const k = lineInPara.get(p) ?? 0;
        lineInPara.set(p, k + 1);
        out.push({ paragraph: p, line: k, lastVisible: last - pStart, hyphenated: /\p{L}/u.test(lastChar) && /\p{L}/u.test(nextChar), slot });
        first += len;
      }
    });
    return out;
  }

  /** Teeth of this story with the bounds last written; filled on first use (one label scan). */
  private teethCache: { rect: Any; bounds: number[]; page: number; label: string }[] | undefined;

  /** Counters for performance diagnosis (spike S4). */
  teethStats = { created: 0, moved: 0, parked: 0, relabelled: 0 };

  setTeeth(teeth: readonly ToothSpec[]): void {
    const id = this.id;
    if (!this.teethCache) {
      this.teethCache = this.existingTeeth().map((rect: Any) => ({ rect, bounds: rect.geometricBounds.map(Number), page: Number(rect.parentPage?.documentOffset ?? -1), label: '' }));
    }
    const cache = this.teethCache;
    // Teeth are reused per page, in order: matching them by list position made a tooth jump pages
    // whenever the line count on an earlier page changed, and a tooth cannot move between pages, so it
    // was deleted and created again (2026-10-17).
    const pools = new Map<number, typeof cache>();
    for (const c of cache) {
      const pool = pools.get(c.page) ?? [];
      pool.push(c);
      pools.set(c.page, pool);
    }
    const next = new Map<number, number>();
    const used = new Set<(typeof cache)[number]>();
    let none: Any;
    for (const t of teeth) {
      const label = `${t.paragraph}:${t.line}`;
      const pool = pools.get(t.page) ?? [];
      pools.set(t.page, pool);
      const k = next.get(t.page) ?? 0;
      next.set(t.page, k + 1);
      const have = pool[k];
      if (have) {
        // Only write what changed: each DOM call costs about a millisecond (spike S4).
        if (have.bounds.some((v, j) => Math.abs(v - t.bounds[j]!) > 1e-4)) {
          have.rect.geometricBounds = t.bounds;
          have.bounds = [...t.bounds];
          this.teethStats.moved++;
        }
        have.label = label;
        used.add(have);
        continue;
      }
      none ??= this.doc.swatches.itemByName('None');
      const rect = this.doc.pages.item(t.page).rectangles.add({ geometricBounds: t.bounds, strokeWeight: 0, strokeColor: none, fillColor: none, itemLayer: this.layer, nonprinting: true });
      rect.textWrapPreferences.properties = { textWrapMode: id.TextWrapModes.BOUNDING_BOX_TEXT_WRAP, textWrapSide: id.TextWrapSideOptions.LEFT_SIDE, textWrapOffset: [0, 0, 0, 0] };
      rect.insertLabel(TOOTH_LABEL, this.storyKey());
      const entry = { rect, bounds: [...t.bounds], page: t.page, label };
      pool.push(entry);
      cache.push(entry);
      used.add(entry);
      this.teethStats.created++;
    }
    // Park surplus teeth on the pasteboard instead of deleting them: creating a tooth costs far more
    // than moving one, and the line count changes often while a slider moves (spike S4).
    cache.forEach((c, i) => {
      if (used.has(c)) return;
      const parked = this.parkingBounds(c.page, i);
      if (c.bounds.some((v, j) => Math.abs(v - parked[j]!) > 1e-4)) {
        c.rect.geometricBounds = parked;
        c.bounds = parked;
        this.teethStats.parked++;
      }
      c.label = 'parked';
    });
  }

  private bandCache: { rect: Any; bounds: number[]; page: number; kind: 'long' | 'short' }[] | undefined;

  /**
   * Show the Flatterzone and band as tinted strips behind the text (on their own layer, no text wrap,
   * partly transparent). Strips are reused and moved; an empty list removes this story's strips.
   */
  setBands(bands: readonly BandSpec[]): void {
    if (!bands.length) {
      if (this.bandCache?.length || this.bandCache === undefined) removeBands(this.doc, this.storyKey());
      this.bandCache = [];
      return;
    }
    const id = this.id;
    const layer = bandLayer(this.doc);
    if (!this.bandCache) {
      this.bandCache = asArray(layer.pageItems.everyItem().getElements())
        .filter((it: Any) => it.extractLabel(BAND_LABEL) === this.storyKey())
        .map((rect: Any) => ({ rect, bounds: rect.geometricBounds.map(Number), page: Number(rect.parentPage?.documentOffset ?? -1), kind: String(rect.extractLabel('flatter-band-kind')) as 'long' | 'short' }));
    }
    const cache = this.bandCache;
    const colors = { long: this.bandColor('long'), short: this.bandColor('short') };
    const none = this.doc.swatches.itemByName('None');
    bands.forEach((b, i) => {
      const have = cache[i];
      if (have && have.page === b.page && have.kind === b.kind) {
        if (have.bounds.some((v, k) => Math.abs(v - b.bounds[k]!) > 1e-3)) {
          have.rect.geometricBounds = b.bounds;
          have.bounds = [...b.bounds];
        }
        return;
      }
      if (have) have.rect.remove();
      const rect = this.doc.pages.item(b.page).rectangles.add({ geometricBounds: b.bounds, itemLayer: layer, fillColor: colors[b.kind], strokeColor: none, strokeWeight: 0, nonprinting: true });
      rect.textWrapPreferences.textWrapMode = id.TextWrapModes.NONE;
      rect.transparencySettings.blendingSettings.properties = { opacity: BAND_OPACITY, blendMode: id.BlendMode.MULTIPLY };
      rect.insertLabel(BAND_LABEL, this.storyKey());
      rect.insertLabel('flatter-band-kind', b.kind);
      cache[i] = { rect, bounds: [...b.bounds], page: b.page, kind: b.kind };
    });
    for (const c of cache.splice(bands.length)) c.rect.remove();
    layer.locked = true;
  }

  private bandColor(kind: 'long' | 'short'): Any {
    const c = BAND_COLORS[kind];
    const sw = this.doc.colors.itemByName(c.name);
    if (sw.isValid) return sw;
    return this.doc.colors.add({ name: c.name, model: this.id.ColorModel.PROCESS, space: this.id.ColorSpace.RGB, colorValue: [...c.rgb] });
  }

  /** Remove parked teeth (end of a session). */
  dropParkedTeeth(): void {
    if (!this.teethCache) return;
    this.teethCache = this.teethCache.filter((c) => {
      if (c.label !== 'parked') return true;
      c.rect.remove();
      return false;
    });
  }

  private pageBounds = new Map<number, number[]>();

  private parkingBounds(page: number, i: number): number[] {
    let b = this.pageBounds.get(page);
    if (!b) {
      b = this.doc.pages.item(Math.max(0, page)).bounds.map(Number) as number[];
      this.pageBounds.set(page, b);
    }
    const x = b[3]! + 3000;
    const y = b[0]! + i * 0.5;
    return [y, x, y + 0.1, x + 1];
  }

  /** Base tracking per paragraph, recorded the first time Flatter touches its tracking. */
  baseTracking: Record<string, number> = {};
  /** Paragraphs Flatter has tracked in this session. */
  private trackedNow = new Set<number>();
  /** Tracking writes made (for timing reports). */
  trackingWrites = 0;
  /** Where setTracking spends its time (diagnosis). */
  trackingStats = { readMs: 0, writeMs: 0, countMs: 0 };

  /**
   * Set the paragraph's tracking to base + span units. Only characters whose tracking differs are
   * written, as runs of equal value: rewriting the whole paragraph on every slider tick made InDesign
   * recompose all of it (1.5 s per tick in a 12,000-character paragraph). The current tracking is
   * read from the document (three calls over its style ranges), so Undo cannot leave us out of step.
   */
  setTracking(paragraph: number, spans: readonly TrackingSpan[]): void {
    if (!spans.length && !this.trackedNow.has(paragraph)) return;
    const st = this.trackingStats;
    let t0 = Date.now();
    const para = this.story.paragraphs.item(paragraph);
    const key = String(paragraph);
    if (!(key in this.baseTracking)) this.baseTracking[key] = baseTrackingOf(para);
    const base = this.baseTracking[key]!;
    const n = Number(para.characters.length);
    const want = new Float64Array(n);
    for (const s of spans) want.fill(s.units, Math.max(0, s.from), Math.min(n, s.to));
    // What Flatter wrote last time, unless the paragraph changed since (Undo, edits): its count of style
    // ranges is a cheap check. Reading every range each tick slowed later writes (2026-10-17).
    const cached = this.written.get(paragraph);
    const from = cached && cached.want.length === n && Number(para.textStyleRanges.length) === cached.ranges ? cached.want : this.currentTracking(para, n, base);
    st.readMs += Date.now() - t0;
    t0 = Date.now();
    const chars = para.characters;
    const write = (a: number, e: number, units: number) => {
      (e - a === 1 ? chars.item(a) : chars.itemByRange(a, e - 1)).tracking = base + units;
      this.trackingWrites++;
    };
    // Paint the spans in order (a line, then its word spaces on top): a span is written when any of its
    // characters differs, or when an earlier span painted over it. One write per line plus one per
    // space, instead of a write per run between spaces.
    const covered = new Uint8Array(n);
    let painted: [number, number] | undefined;
    for (const s of spans) {
      const a = Math.max(0, s.from);
      const e = Math.min(n, s.to);
      if (e <= a) continue;
      covered.fill(1, a, e);
      let dirty = !!painted && a >= painted[0] && e <= painted[1];
      for (let k = a; !dirty && k < e; k++) dirty = want[k] !== from[k];
      if (!dirty) continue;
      write(a, e, s.units);
      if (!painted || a < painted[0] || e > painted[1]) painted = [a, e];
    }
    // Characters no span covers go back to the base where they still carry tracking.
    let k = 0;
    while (k < n) {
      if (covered[k] || from[k] === 0) { k++; continue; }
      let e = k + 1;
      while (e < n && !covered[e] && from[e] !== 0) e++;
      write(k, e, 0);
      k = e;
    }
    st.writeMs += Date.now() - t0;
    t0 = Date.now();
    if (spans.length) {
      this.trackedNow.add(paragraph);
      this.written.set(paragraph, { want, ranges: Number(para.textStyleRanges.length) });
      st.countMs += Date.now() - t0;
    } else {
      this.trackedNow.delete(paragraph);
      this.written.delete(paragraph);
    }
  }

  /** Tracking per character as last written, with the paragraph's style-range count after writing. */
  private written = new Map<number, { want: Float64Array; ranges: number }>();

  /** The paragraph's tracking per character, as an offset from base, read from its style ranges. */
  private currentTracking(para: Any, n: number, base: number): Float64Array {
    const out = new Float64Array(n);
    const ranges = para.textStyleRanges.everyItem();
    const idx = asArray(ranges.index).map(Number);
    const tr = asArray(ranges.tracking).map(Number);
    const start = Number(para.index);
    for (let r = 0; r < idx.length; r++) {
      const a = Math.max(0, idx[r]! - start);
      const e = r + 1 < idx.length ? idx[r + 1]! - start : n;
      out.fill((tr[r] ?? base) - base, a, Math.min(n, e));
    }
    return out;
  }

  /** Reset paragraphs to their recorded base tracking (before measuring, and on Remove). */
  resetTracking(base: Record<string, number>): void {
    for (const [p, t] of Object.entries(base)) {
      const para = this.story.paragraphs.item(Number(p));
      if (para.isValid) para.texts.item(0).tracking = t;
    }
    this.baseTracking = { ...base };
    this.written.clear();
  }

  /** Remove the scratch frame used for probing and close the measuring bench. */
  dispose(): void {
    if (this.scratch?.isValid) this.scratch.remove();
    this.scratch = undefined;
    if (this.bench?.isValid) this.bench.close(this.id.SaveOptions.NO);
    this.bench = undefined;
  }

  private bench: Any | undefined;
  private benchText: Any | undefined;

  /**
   * A frame in a hidden document for measuring whole paragraphs: 9000 pt wide lines, 15,000 pt tall.
   * Document text settings that change glyph sizes (super- and subscript, small caps) are copied over.
   */
  private benchFrame(): Any {
    if (this.bench?.isValid && this.benchText?.isValid) return this.benchText;
    const id = this.id;
    const bench = id.app.documents.add({ showingWindow: false });
    bench.viewPreferences.horizontalMeasurementUnits = id.MeasurementUnits.POINTS;
    bench.viewPreferences.verticalMeasurementUnits = id.MeasurementUnits.POINTS;
    bench.documentPreferences.properties = { facingPages: false, pageWidth: 9200, pageHeight: 15100 };
    const prefs: Record<string, unknown> = {};
    for (const a of ['superscriptSize', 'superscriptPosition', 'subscriptSize', 'subscriptPosition', 'smallCap']) {
      try {
        prefs[a] = this.doc.textPreferences[a];
      } catch {
        /* not available */
      }
    }
    try {
      bench.textPreferences.properties = prefs;
    } catch {
      /* keep the defaults */
    }
    this.bench = bench;
    this.benchText = bench.pages.item(0).textFrames.add({ geometricBounds: [0, 0, 15000, 9000], contents: 'x' });
    this.benchText.textFramePreferences.insetSpacing = [0, 0, 0, 0];
    return this.benchText;
  }

  existingTeeth(): Any[] {
    const all = this.layer.pageItems;
    if (!Number(all.length)) return [];
    const items = asArray(all.everyItem().getElements());
    const labels = asArray(all.everyItem().extractLabel(TOOTH_LABEL)).map(String);
    const key = this.storyKey();
    return items.filter((_: Any, i: number) => labels[i] === key);
  }

  // --- helpers -------------------------------------------------------------

  private paragraphAt(storyIndex: number): number {
    let p = 0;
    while (p + 1 < this.paraStarts.length && this.paraStarts[p + 1]! <= storyIndex) p++;
    return p;
  }

  private frames(): { page: number; left: number; right: number; top: number; bottom: number; columns: { left: number; right: number; gutter: number }[] }[] {
    const containers = asArray(this.story.textContainers);
    return containers.map((f: Any) => {
      const [top, left, bottom, right] = f.geometricBounds.map(Number);
      const prefs = f.textFramePreferences;
      const inset = asArray(prefs.insetSpacing).map(Number);
      const [it, il, ib, ir] = inset.length === 4 ? inset : [inset[0] ?? 0, inset[0] ?? 0, inset[0] ?? 0, inset[0] ?? 0];
      const count = Number(prefs.textColumnCount) || 1;
      const gutter = Number(prefs.textColumnGutter) || 0;
      const inner = right - ir! - (left + il!);
      const colW = (inner - gutter * (count - 1)) / count;
      const columns = Array.from({ length: count }, (_, k) => {
        const cl = left + il! + k * (colW + gutter);
        return { left: cl, right: cl + colW, gutter: k < count - 1 ? gutter : 4 };
      });
      return { page: Number(f.parentPage?.documentOffset ?? 0), left, right, top: top + it!, bottom: bottom - ib!, columns };
    });
  }

  private columnWidth(): number {
    const f = this.frames()[0];
    if (!f) throw new Error('story has no text frame');
    return f.columns[0]!.right - f.columns[0]!.left;
  }

  private probeKey(para: Any): string {
    const c = para.characters.item(0);
    return [PROBE_VERSION, c.appliedFont?.name, c.pointSize, para.appliedLanguage?.name, para.hyphenateAfterFirst, para.hyphenateBeforeLast, para.hyphenateWordsLongerThan, para.hyphenateCapitalizedWords, String(para.providerHyphenationStyle), c.tracking, c.horizontalScale].join('|');
  }

  private scratchFrame(para: Any): Any {
    if (!this.scratch?.isValid) {
      const page = this.doc.pages.item(0);
      const [, , , right] = page.bounds.map(Number);
      // On the pasteboard to the right of the first page, on the control layer.
      this.scratch = page.textFrames.add({ geometricBounds: [0, right + 200, 100, right + 2200], itemLayer: this.layer, contents: 'x' });
      this.scratch.textFramePreferences.properties = { insetSpacing: [0, 0, 0, 0], ignoreWrap: true };
    }
    const all = this.scratch.parentStory.texts.item(0);
    const src = para.characters.item(0);
    const props: Record<string, unknown> = {};
    for (const a of PROBE_ATTRIBUTES) {
      try {
        props[a] = a === 'appliedLanguage' ? String(src.appliedLanguage.name) : a === 'appliedFont' ? String(src.appliedFont.name) : src[a];
      } catch {
        /* attribute not available: keep the default */
      }
    }
    for (const [a, v] of Object.entries(props)) {
      try {
        all[a] = v;
      } catch {
        /* not settable here */
      }
    }
    all.composer = 'Adobe Single-line Composer';
    all.justification = this.id.Justification.LEFT_ALIGN;
    // The probed word is always the last word of the probe text. Flatter's required settings turn
    // "Hyphenate Last Word" off (a paragraph rule the planner applies itself); copied here it made
    // InDesign refuse every point, so probing returned nothing and no line was ever hyphenated
    // (found 2026-10-17).
    all.hyphenateLastWord = true;
    return this.scratch;
  }

  /**
   * Advances of a paragraph's characters, set on 9000 pt lines in the probe frame with hyphenation
   * off. Long paragraphs take several such lines; a space that ends one of them has an unreliable
   * width (spike S2), so it gets the paragraph's normal space width.
   */
  /**
   * Advances of the paragraph's characters, measured twice: as set, and with ligatures off, which is
   * how InDesign sets tracked text (it breaks ligatures up when tracking is applied, 2026-10-17).
   */
  measureParagraph(para: Any, length: number): { advances: number[]; trackedAdvances: number[] } {
    const space = this.spaceWidth(para);
    // Measured in a hidden bench document, closed in dispose(): reading the positions of thousands of
    // characters in a frame of the user's document made every later change to that frame slow (removing
    // it took 12 s after a 12,000-character paragraph, probing 140 ms per word; 2026-10-17).
    const frame = this.benchFrame();
    const story = frame.parentStory;
    story.texts.item(0).contents = '';
    para.texts.item(0).duplicate(this.id.LocationOptions.AT_BEGINNING, story.insertionPoints.item(0));
    const all = story.texts.item(0);
    all.properties = { hyphenation: false, composer: 'Adobe Single-line Composer', justification: this.id.Justification.LEFT_ALIGN, leftIndent: 0, rightIndent: 0, firstLineIndent: 0, spaceBefore: 0, spaceAfter: 0 };
    if (story.overflows) throw new Error('paragraph too long to measure');
    const chars = Array.from(String(story.contents));
    const read = (): number[] => {
      const xs = asArray(story.characters.everyItem().horizontalOffset).map(Number);
      const xe = asArray(story.characters.everyItem().endHorizontalOffset).map(Number);
      if (xs.length < length) throw new Error('paragraph did not copy into the measuring frame');
      const lineEnds = new Set<number>();
      let at = -1;
      for (const len of asArray(story.lines.everyItem().contents).map((c: Any) => Array.from(String(c)).length)) {
        at += len;
        lineEnds.add(at);
      }
      return Array.from({ length }, (_, i) => (lineEnds.has(i) && /^\s$/.test(chars[i] ?? '') ? space : xe[i]! - xs[i]!));
    };
    const advances = read();
    all.ligatures = false;
    if (story.overflows) throw new Error('paragraph too long to measure');
    const trackedAdvances = read();
    return { advances, trackedAdvances };
  }

  spaceWidth(para: Any): number {
    return this.measureSecond(para, 'x x');
  }

  hyphenWidth(para: Any): number {
    return this.measureSecond(para, 'x-');
  }

  /** Advance of the second character of a two-character sample, in the paragraph's formatting. */
  private measureSecond(para: Any, sample: string): number {
    const frame = this.scratchFrame(para);
    const story = frame.parentStory;
    story.texts.item(0).contents = sample;
    frame.geometricBounds = [0, frame.geometricBounds[1], 100, Number(frame.geometricBounds[1]) + 2000];
    const xs = asArray(story.characters.everyItem().horizontalOffset).map(Number);
    const xe = asArray(story.characters.everyItem().endHorizontalOffset).map(Number);
    return xe[1]! - xs[1]!;
  }

  /**
   * A compound with typed hyphens: for each hyphen, set the frame just wide enough for "x <part>-" and
   * see whether InDesign ends line 1 there. Returns the accepted positions (after the hyphen).
   */
  private probeCompound(frame: Any, word: string): number[] {
    this.probes++;
    const story = frame.parentStory;
    story.texts.item(0).contents = 'x ' + word;
    const left = Number(frame.geometricBounds[1]);
    frame.geometricBounds = [0, left, 100, left + 2000];
    const xs = asArray(story.characters.everyItem().horizontalOffset).map(Number);
    const xe = asArray(story.characters.everyItem().endHorizontalOffset).map(Number);
    const x0 = xs[0]!;
    const out: number[] = [];
    Array.from(word).forEach((ch, i) => {
      if (ch !== '-' || i === 0 || i === word.length - 1) return;
      frame.geometricBounds = [0, left, 100, left + (xe[i + 2]! - x0) + 1];
      const n = Array.from(String(story.lines.item(0).contents)).length - 2;
      if (n === i + 1) out.push(i + 1);
    });
    return out;
  }

  /** Spike S3: "x <word>" so line 1 always has a legal break; narrow until no point fits. */
  private probeWord(frame: Any, word: string): number[] {
    this.probes++;
    const story = frame.parentStory;
    story.texts.item(0).contents = 'x ' + word;
    const left = Number(frame.geometricBounds[1]);
    frame.geometricBounds = [0, left, 100, left + 2000];
    const xs = asArray(story.characters.everyItem().horizontalOffset).map(Number);
    const xe = asArray(story.characters.everyItem().endHorizontalOffset).map(Number);
    const x0 = xs[0]!;
    const lead = xs[2]! - x0;
    const points: number[] = [];
    let limit = xe[word.length + 1]! - x0 - TOLERANCE - 0.05;
    while (limit > lead) {
      frame.geometricBounds = [0, left, 100, left + limit];
      const n = Array.from(String(story.lines.item(0).contents)).length - 2;
      if (n <= 0 || n >= word.length) break;
      points.unshift(n);
      limit = xs[n + 2]! - x0 - TOLERANCE - 0.05;
    }
    return points;
  }
}

function parseJson<T>(s: string): T | undefined {
  if (!s) return undefined;
  try {
    return JSON.parse(s) as T;
  } catch {
    return undefined;
  }
}
