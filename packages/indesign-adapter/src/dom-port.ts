/**
 * The Port implemented with the InDesign DOM (UXP). Only this file and dom.ts
 * touch InDesign. Findings from docs/spike-results.md are applied throughout:
 * bulk reads, teeth without stroke set at creation, the control layer on top,
 * probing with "x <word>" in a scratch frame, settings re-applied in place.
 */
import type { LineSlot, ToothSpec } from './geometry.ts';
import type { ParagraphData, Port, ReadLine, TrackingSpan } from './port.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Any = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const require: (m: string) => any;
export const indesign = (): Any => require('indesign');

export const CONTROL_LAYER = 'Flatter (Steuerung)';
export const TOOTH_LABEL = 'flatter-tooth';
export const PROBE_LABEL = 'flatter-probe';
const TOLERANCE = 0.4;

export const asArray = <T>(v: T | T[]): T[] => (Array.isArray(v) ? v : [v]);

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
    this.probeCache = parseJson(doc.extractLabel(PROBE_LABEL)) ?? {};
  }

  storyKey(): string {
    return String(this.story.id);
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
    const composedEnd = this.lastComposedIndex();
    const out: ParagraphData[] = [];
    let start = 0;
    this.paraStarts = [];
    for (let p = 0; p < n; p++) {
      const len = lengths[p]!;
      this.paraStarts.push(start);
      const end = start + len;
      // Leave out overset paragraphs: they have no measurements.
      if (end - 1 <= composedEnd) {
        let chars = text.slice(start, end);
        if (chars[chars.length - 1] === '\r') chars = chars.slice(0, -1);
        const para = paras.item(p);
        // Measure on one very wide line in the probe frame (spike S2): exact, and independent of
        // where the story currently breaks (a letter before a break loses its kerning, a space at a
        // line end has an unreliable width).
        const advances = this.measureParagraph(para, chars.length);
        const size = sizes[p]!;
        const lead = typeof leadings[p] === 'number' ? (leadings[p] as number) : (size * autoLeading[p]!) / 100;
        out.push({
          index: p,
          chars,
          advances,
          language: String(para.appliedLanguage.name),
          hyphenWidth: this.hyphenWidth(para),
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
      for (const w of missing) cache[w] = this.probeWord(frame, w);
      this.doc.insertLabel(PROBE_LABEL, JSON.stringify(this.probeCache));
    }
    return new Map(words.map((w) => [w, cache[w] ?? []]));
  }

  readLines(): ReadLine[] {
    const story = this.story;
    this.story.recompose();
    const text = Array.from(String(story.contents));
    const lines = story.lines;
    const n = lines.length;
    if (!n) return [];
    const contents = asArray(lines.everyItem().contents).map((c: Any) => Array.from(String(c)));
    const xs = asArray(lines.everyItem().horizontalOffset).map(Number);
    const baselines = asArray(lines.everyItem().baseline).map(Number);
    const frames = this.frames();
    const paras = this.paragraphs();
    const sizeOf = new Map(paras.map((p) => [p.index, p.size]));
    if (!this.paraStarts.length) this.paragraphs();
    const out: ReadLine[] = [];
    let first = 0;
    const lineInPara = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const len = contents[i]!.length;
      const p = this.paragraphAt(first);
      const pStart = this.paraStarts[p]!;
      let last = first + len - 1;
      while (last > first && /^[\s\r]$/.test(text[last] ?? '')) last--;
      const lastChar = text[first + len - 1] ?? '';
      const nextChar = text[first + len] ?? '';
      const frame = frames.find((f) => xs[i]! >= f.left - 0.5 && xs[i]! <= f.right + 0.5 && baselines[i]! >= f.top - 0.5 && baselines[i]! <= f.bottom + 0.5) ?? frames[0]!;
      const col = frame.columns.find((c) => xs[i]! >= c.left - 0.5 && xs[i]! <= c.right + 0.5) ?? frame.columns[0]!;
      const slot: LineSlot = { page: frame.page, baseline: baselines[i]!, startX: xs[i]!, columnRight: col.right, gutter: col.gutter, size: sizeOf.get(p) ?? 10 };
      const k = lineInPara.get(p) ?? 0;
      lineInPara.set(p, k + 1);
      out.push({ paragraph: p, line: k, lastVisible: last - pStart, hyphenated: /\p{L}/u.test(lastChar) && /\p{L}/u.test(nextChar), slot });
      first += len;
    }
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
    const none = this.doc.swatches.itemByName('None');
    teeth.forEach((t, i) => {
      const label = `${t.paragraph}:${t.line}`;
      const have = cache[i];
      if (have && have.page === t.page) {
        // Only write what changed: each DOM call costs about a millisecond (spike S4).
        if (have.bounds.some((v, k) => Math.abs(v - t.bounds[k]!) > 1e-4)) {
          have.rect.geometricBounds = t.bounds;
          have.bounds = [...t.bounds];
          this.teethStats.moved++;
        }
        if (have.label !== label) {
          have.rect.insertLabel('flatter-line', label);
          have.label = label;
          this.teethStats.relabelled++;
        }
        return;
      }
      if (have) have.rect.remove();
      const rect = this.doc.pages.item(t.page).rectangles.add({ geometricBounds: t.bounds, strokeWeight: 0, strokeColor: none, fillColor: none, itemLayer: this.layer, nonprinting: true });
      rect.textWrapPreferences.properties = { textWrapMode: id.TextWrapModes.BOUNDING_BOX_TEXT_WRAP, textWrapSide: id.TextWrapSideOptions.LEFT_SIDE, textWrapOffset: [0, 0, 0, 0] };
      rect.insertLabel(TOOTH_LABEL, this.storyKey());
      rect.insertLabel('flatter-line', label);
      cache[i] = { rect, bounds: [...t.bounds], page: t.page, label };
      this.teethStats.created++;
    });
    // Park surplus teeth on the pasteboard instead of deleting them: creating a tooth costs far more
    // than moving one, and the line count changes often while a slider moves (spike S4).
    for (let i = teeth.length; i < cache.length; i++) {
      const c = cache[i]!;
      const parked = this.parkingBounds(c.page, i);
      if (c.bounds.some((v, k) => Math.abs(v - parked[k]!) > 1e-4)) {
        c.rect.geometricBounds = parked;
        c.bounds = parked;
        this.teethStats.parked++;
      }
      if (c.label !== 'parked') {
        c.rect.insertLabel('flatter-line', 'parked');
        c.label = 'parked';
      }
    }
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

  private parkingBounds(page: number, i: number): number[] {
    const b = this.doc.pages.item(Math.max(0, page)).bounds.map(Number);
    const x = b[3]! + 3000;
    const y = b[0]! + i * 0.5;
    return [y, x, y + 0.1, x + 1];
  }

  /** Base tracking per paragraph, recorded the first time Flatter touches its tracking. */
  baseTracking: Record<string, number> = {};
  private trackedNow = new Set<number>();

  setTracking(paragraph: number, spans: readonly TrackingSpan[]): void {
    const para = this.story.paragraphs.item(paragraph);
    if (!spans.length && !this.trackedNow.has(paragraph)) return;
    const key = String(paragraph);
    if (!(key in this.baseTracking)) this.baseTracking[key] = Number(para.characters.item(0).tracking) || 0;
    const base = this.baseTracking[key]!;
    para.texts.item(0).tracking = base;
    for (const s of spans) {
      if (s.to > s.from) para.characters.itemByRange(s.from, s.to - 1).tracking = base + s.units;
    }
    if (spans.length) this.trackedNow.add(paragraph);
    else this.trackedNow.delete(paragraph);
  }

  /** Reset paragraphs to their recorded base tracking (before measuring, and on Remove). */
  resetTracking(base: Record<string, number>): void {
    for (const [p, t] of Object.entries(base)) {
      const para = this.story.paragraphs.item(Number(p));
      if (para.isValid) para.texts.item(0).tracking = t;
    }
    this.baseTracking = { ...base };
  }

  /** Remove the scratch frame used for probing. */
  dispose(): void {
    if (this.scratch?.isValid) this.scratch.remove();
    this.scratch = undefined;
  }

  existingTeeth(): Any[] {
    const items = asArray(this.layer.pageItems.everyItem().getElements());
    return items.filter((it: Any) => it.extractLabel(TOOTH_LABEL) === this.storyKey());
  }

  // --- helpers -------------------------------------------------------------

  private paragraphAt(storyIndex: number): number {
    let p = 0;
    while (p + 1 < this.paraStarts.length && this.paraStarts[p + 1]! <= storyIndex) p++;
    return p;
  }

  private lastComposedIndex(): number {
    const lines = this.story.lines;
    if (!lines.length) return -1;
    const lens = asArray(lines.everyItem().contents).map((c: Any) => Array.from(String(c)).length);
    return lens.reduce((s, x) => s + x, 0) - 1;
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
    return [c.appliedFont?.name, c.pointSize, para.appliedLanguage?.name, para.hyphenateAfterFirst, para.hyphenateBeforeLast, para.hyphenateWordsLongerThan, para.hyphenateCapitalizedWords, String(para.providerHyphenationStyle), c.tracking, c.horizontalScale].join('|');
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
    return this.scratch;
  }

  /** Advances of a paragraph's characters, set on one line in the probe frame with hyphenation off. */
  measureParagraph(para: Any, length: number): number[] {
    const frame = this.scratchFrame(para);
    const story = frame.parentStory;
    const left = Number(frame.geometricBounds[1]);
    frame.geometricBounds = [0, left, 200, left + 9000];
    story.texts.item(0).contents = '';
    para.texts.item(0).duplicate(this.id.LocationOptions.AT_BEGINNING, story.insertionPoints.item(0));
    const all = story.texts.item(0);
    all.properties = { hyphenation: false, composer: 'Adobe Single-line Composer', justification: this.id.Justification.LEFT_ALIGN, leftIndent: 0, rightIndent: 0, firstLineIndent: 0 };
    const xs = asArray(story.characters.everyItem().horizontalOffset).map(Number);
    const xe = asArray(story.characters.everyItem().endHorizontalOffset).map(Number);
    if (story.lines.length > 1 || xs.length < length) throw new Error('paragraph does not fit on one measuring line');
    return Array.from({ length }, (_, i) => xe[i]! - xs[i]!);
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
