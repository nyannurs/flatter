// Edge cases (designer, 2026-11-26): Flatter should work on every left- or right-aligned story. Each case gets its own
// page(s) and story in a throwaway document: images with text wrap on either side, right-aligned text, indents
// (left, right, first-line, hanging), text aligned to the spine across a spread, mixed alignments, columns, drop caps,
// frame insets. Per case: Preview on the whole story (live steering), then Apply to whole story (frozen), Unfreeze,
// Remove. Reports lines as planned, missed lines, whether right-aligned text stayed flush and the text came back.
// App label "flatter-i50-only" runs only the cases whose name contains it; "flatter-i50-tracking" = yes adds Laufweite.
import { DE_TEXT, app, asArray, id, inNewDocument, type Any } from './lib.ts';
import { compatibilityAlarms, openSession, removeFlatter, setWholeStory, unfreezeFlatter } from '@flatter/indesign-adapter';

interface Case {
  name: string;
  /** Content Flatter reports as unsupported: only robustness counts (no error, text and alignments back). */
  unsupported?: boolean;
  pages?: number;
  build: (doc: Any, page: number) => Any;
}

const W = 595;
const H = 842;
const text = (n: number, from = 0) => Array.from({ length: n }, (_, k) => DE_TEXT[(k + from) % DE_TEXT.length]).join('\r');

function frame(doc: Any, page: number, bounds: [number, number, number, number], contents: string, props: Record<string, unknown> = {}): Any {
  const f = doc.pages.item(page).textFrames.add({ geometricBounds: bounds });
  f.textFramePreferences.properties = { insetSpacing: [0, 0, 0, 0], firstBaselineOffset: id.FirstBaseline.LEADING_OFFSET, ...props };
  f.contents = contents;
  f.parentStory.texts.item(0).properties = { appliedFont: 'Minion Pro\tRegular', pointSize: 9.5, leading: 12.5, appliedLanguage: 'German: 2006 Reform', hyphenation: true };
  return f;
}

function image(doc: Any, page: number, bounds: [number, number, number, number], offset = 6): Any {
  const r = doc.pages.item(page).rectangles.add({ geometricBounds: bounds, fillColor: doc.swatches.itemByName('Black'), fillTint: 20 });
  r.textWrapPreferences.textWrapMode = id.TextWrapModes.BOUNDING_BOX_TEXT_WRAP;
  r.textWrapPreferences.textWrapOffset = [offset, offset, offset, offset];
  return r;
}

const paragraphs = (story: Any, f: (p: Any, k: number) => void) => {
  const n = Number(story.paragraphs.length);
  for (let k = 0; k < n; k++) f(story.paragraphs.item(k), k);
};


/**
 * InDesign's special characters at word boundaries (2026-11-26): every `every`-th word gets the next one of `specials`,
 * either replacing the space before it (spaces) or inserted in front of it (markers). Names are SpecialCharacters
 * enum names; plain strings are inserted as they are. Names this InDesign does not know are reported, not fatal.
 */
const missingSpecials = new Set<string>();
function sprinkle(story: Any, specials: readonly string[], mode: 'replaceSpace' | 'insert', every = 6): void {
  const text = Array.from(String(story.contents));
  const at: number[] = [];
  let words = 0;
  for (let k = 1; k < text.length; k++) {
    if (text[k - 1] === ' ' && /\p{L}/u.test(text[k]!)) {
      words++;
      if (words % every === 0) at.push(k);
    }
  }
  at.reverse().forEach((k, n) => {
    const name = specials[(at.length - 1 - n) % specials.length]!;
    const value = name.length > 1 && /^[A-Z_]+$/.test(name) ? id.SpecialCharacters[name] : name;
    if (value === undefined) {
      missingSpecials.add(name);
      return;
    }
    try {
      if (mode === 'replaceSpace') {
        story.characters.item(k - 1).remove();
        story.insertionPoints.item(k - 1).contents = value;
      } else story.insertionPoints.item(k).contents = value;
    } catch {
      missingSpecials.add(name);
    }
  });
}

const SPACES = ['EM_SPACE', 'EN_SPACE', 'THIN_SPACE', 'HAIR_SPACE', 'SIXTH_SPACE', 'QUARTER_SPACE', 'THIRD_SPACE', 'FIGURE_SPACE', 'PUNCTUATION_SPACE', 'NONBREAKING_SPACE', 'FIXED_WIDTH_NONBREAKING_SPACE', 'FLUSH_SPACE'];
const MARKERS = ['END_NESTED_STYLE', 'AUTO_PAGE_NUMBER', 'SECTION_MARKER', 'NEXT_PAGE_NUMBER', 'ZERO_WIDTH_NONJOINER', 'ZERO_WIDTH_JOINER', 'DISCRETIONARY_LINE_BREAK'];
const HYPHENS = ['DISCRETIONARY_HYPHEN', 'NONBREAKING_HYPHEN', '–', '—', '…', '„', '“', '«', '»'];

const CASES: Case[] = [
  { name: 'left, plain', build: (d, p) => frame(d, p, [60, 60, 400, 300], text(4)).parentStory },
  { name: 'left, image right in the column', build: (d, p) => (image(d, p, [120, 220, 260, 320]), frame(d, p, [60, 60, 500, 300], text(5)).parentStory) },
  { name: 'left, image left in the column', build: (d, p) => (image(d, p, [120, 40, 260, 140]), frame(d, p, [60, 60, 500, 300], text(5)).parentStory) },
  { name: 'right, plain', build: (d, p) => { const s = frame(d, p, [60, 60, 400, 300], text(4)).parentStory; s.texts.item(0).justification = id.Justification.RIGHT_ALIGN; return s; } },
  { name: 'right, image left in the column', build: (d, p) => { image(d, p, [120, 40, 260, 140]); const s = frame(d, p, [60, 60, 500, 300], text(5)).parentStory; s.texts.item(0).justification = id.Justification.RIGHT_ALIGN; return s; } },
  { name: 'right, image right in the column', build: (d, p) => { image(d, p, [120, 220, 260, 320]); const s = frame(d, p, [60, 60, 500, 300], text(5)).parentStory; s.texts.item(0).justification = id.Justification.RIGHT_ALIGN; return s; } },
  {
    name: 'left, indents (left 12, right 18, first 10)',
    build: (d, p) => { const s = frame(d, p, [60, 60, 450, 300], text(4)).parentStory; s.texts.item(0).properties = { leftIndent: 12, rightIndent: 18, firstLineIndent: 10 }; return s; },
  },
  {
    name: 'right, indents (left 12, right 18, first 10)',
    build: (d, p) => { const s = frame(d, p, [60, 60, 450, 300], text(4)).parentStory; s.texts.item(0).properties = { justification: id.Justification.RIGHT_ALIGN, leftIndent: 12, rightIndent: 18, firstLineIndent: 10 }; return s; },
  },
  {
    name: 'left, hanging indent (left 14, first -14)',
    build: (d, p) => { const s = frame(d, p, [60, 60, 450, 300], text(4)).parentStory; s.texts.item(0).properties = { leftIndent: 14, firstLineIndent: -14 }; return s; },
  },
  {
    name: 'left, indents with image left',
    build: (d, p) => { image(d, p, [120, 40, 260, 140]); const s = frame(d, p, [60, 60, 500, 300], text(5)).parentStory; s.texts.item(0).properties = { leftIndent: 12, rightIndent: 18, firstLineIndent: 10 }; return s; },
  },
  {
    name: 'left, indents with image right',
    build: (d, p) => { image(d, p, [120, 220, 260, 320]); const s = frame(d, p, [60, 60, 500, 300], text(5)).parentStory; s.texts.item(0).properties = { leftIndent: 12, rightIndent: 18, firstLineIndent: 10 }; return s; },
  },
  {
    name: 'right, indents with image left',
    build: (d, p) => { image(d, p, [120, 40, 260, 140]); const s = frame(d, p, [60, 60, 500, 300], text(5)).parentStory; s.texts.item(0).properties = { justification: id.Justification.RIGHT_ALIGN, leftIndent: 12, rightIndent: 18, firstLineIndent: 10 }; return s; },
  },
  {
    name: 'mixed: centred head, left and right paragraphs',
    build: (d, p) => {
      const s = frame(d, p, [60, 60, 600, 300], `Kapitel eins\r${text(5)}`).parentStory;
      s.paragraphs.item(0).justification = id.Justification.CENTER_ALIGN;
      paragraphs(s, (q, k) => { if (k > 0 && k % 2 === 0) q.justification = id.Justification.RIGHT_ALIGN; });
      return s;
    },
  },
  {
    name: 'right, three columns',
    build: (d, p) => { const s = frame(d, p, [60, 40, 500, 555], text(10), { textColumnCount: 3, textColumnGutter: 12 }).parentStory; s.texts.item(0).justification = id.Justification.RIGHT_ALIGN; return s; },
  },
  {
    name: 'spine: towards binding across a spread',
    pages: 2,
    build: (d, p) => {
      const a = frame(d, p, [60, 60, 780, 535], text(8));
      const b = frame(d, p + 1, [60, 60, 780, 535], '');
      a.nextTextFrame = b;
      a.parentStory.texts.item(0).justification = id.Justification.TO_BINDING_SIDE;
      return a.parentStory;
    },
  },
  {
    name: 'left, drop cap (3 lines)',
    build: (d, p) => { const s = frame(d, p, [60, 60, 450, 300], text(3)).parentStory; s.texts.item(0).properties = { dropCapCharacters: 1, dropCapLines: 3 }; return s; },
  },
  {
    name: 'left, frame inset 12',
    build: (d, p) => frame(d, p, [60, 60, 450, 300], text(4), { insetSpacing: [12, 12, 12, 12] }).parentStory,
  },
  {
    name: 'right, two frames of different widths',
    pages: 1,
    build: (d, p) => {
      const a = frame(d, p, [60, 60, 300, 260], text(6));
      const b = frame(d, p, [330, 60, 780, 420], '');
      a.nextTextFrame = b;
      a.parentStory.texts.item(0).justification = id.Justification.RIGHT_ALIGN;
      return a.parentStory;
    },
  },
  {
    name: 'left, special spaces',
    build: (d, p) => { const s = frame(d, p, [60, 60, 500, 300], text(5)).parentStory; sprinkle(s, SPACES, 'replaceSpace', 4); return s; },
  },
  {
    name: 'left, markers (nested style end, page number, section, zero-width, discretionary break)',
    build: (d, p) => { const s = frame(d, p, [60, 60, 500, 300], text(5)).parentStory; sprinkle(s, MARKERS, 'insert', 5); return s; },
  },
  {
    name: 'left, soft and non-breaking hyphens, dashes, quotes',
    build: (d, p) => {
      const s = frame(d, p, [60, 60, 500, 300], text(5)).parentStory;
      // Soft hyphens inside long words, where the second opinion would hyphenate too.
      const t = Array.from(String(s.contents));
      for (let k = t.length - 4; k > 3; k--) if (/\p{Ll}/u.test(t[k]!) && /\p{Ll}{4}/u.test(t.slice(k - 4, k).join('')) && /\p{Ll}{4}/u.test(t.slice(k, k + 4).join('')) && k % 11 === 0) s.insertionPoints.item(k).contents = id.SpecialCharacters.DISCRETIONARY_HYPHEN;
      sprinkle(s, HYPHENS.slice(1), 'insert', 7);
      return s;
    },
  },
  {
    name: 'left, indent to here',
    build: (d, p) => {
      const s = frame(d, p, [60, 60, 500, 300], text(4)).parentStory;
      // After the first word of every paragraph (a hanging layout made with Indent to Here).
      const starts = asArray(s.paragraphs.everyItem().index).map(Number).reverse();
      for (const st of starts) {
        const t = String(s.paragraphs.item(0).parent.contents);
        const k = Array.from(t).indexOf(' ', st);
        if (k > st) s.insertionPoints.item(k + 1).contents = id.SpecialCharacters.INDENT_HERE_TAB;
      }
      return s;
    },
  },
  {
    name: 'left, footnotes',
    build: (d, p) => {
      const s = frame(d, p, [60, 60, 600, 300], text(4)).parentStory;
      const t = Array.from(String(s.contents));
      for (let k = t.length - 1; k > 0; k--) if (t[k] === '.' && k % 3 === 0) {
        const fn = s.insertionPoints.item(k + 1).footnotes.add();
        fn.texts.item(0).contents = 'Eine Fußnote.';
      }
      return s;
    },
  },
  {
    name: 'left, inline graphics',
    build: (d, p) => {
      const s = frame(d, p, [60, 60, 500, 300], text(4)).parentStory;
      const t = Array.from(String(s.contents));
      for (let k = t.length - 1; k > 0; k--) if (t[k] === ' ' && k % 37 === 0) s.insertionPoints.item(k + 1).rectangles.add({ geometricBounds: [0, 0, 7, 7], fillColor: d.swatches.itemByName('Black') });
      return s;
    },
  },
  {
    name: 'left, tabs (reported as unsupported)',
    unsupported: true,
    build: (d, p) => { const s = frame(d, p, [60, 60, 500, 300], text(4)).parentStory; sprinkle(s, ['\t'], 'replaceSpace', 9); return s; },
  },
  {
    name: 'left, right indent tab (reported as unsupported)',
    unsupported: true,
    build: (d, p) => { const s = frame(d, p, [60, 60, 500, 300], text(4)).parentStory; sprinkle(s, ['RIGHT_INDENT_TAB'], 'insert', 20); return s; },
  },
  {
    name: 'right, special spaces and markers',
    build: (d, p) => { const s = frame(d, p, [60, 60, 500, 300], text(5)).parentStory; s.texts.item(0).justification = id.Justification.RIGHT_ALIGN; sprinkle(s, [...SPACES.slice(0, 6), ...MARKERS.slice(0, 3)], 'replaceSpace', 5); return s; },
  },
];

inNewDocument((doc: Any) => {
  const only = String(app.extractLabel('flatter-i50-only') || '');
  const cases = CASES.filter((c) => !only || c.name.includes(only));
  const pages = cases.reduce((n, c) => n + (c.pages ?? 1), 0) + 1;
  doc.documentPreferences.properties = { pageWidth: W, pageHeight: H, facingPages: true, pagesPerDocument: pages + 1 };
  // Coordinates per page, not per spread: cases on the same spread must not overlap.
  doc.viewPreferences.rulerOrigin = id.RulerOrigin.PAGE_ORIGIN;
  // App label "flatter-i50-tracking" = yes: with precise Laufweite (letters and word spaces).
  const tracked = app.extractLabel('flatter-i50-tracking') === 'yes';
  const settings = { showBands: true, sense: true, zoneShare: 0.2, bandShare: 0.5, ...(tracked ? { tracking: { enabled: true, mode: 'precise' as const, max: 5 }, wordSpaceShare: 0.25 } : {}) };
  const out: Record<string, unknown> = {};
  // Page 0 is a single right-hand page; start every case on a left-hand page so spreads line up.
  let page = 1;
  for (const c of cases) {
    const t0 = Date.now();
    try {
      const story = c.build(doc, page);
      const original = String(story.contents);
      const alignments = Array.from({ length: Number(story.paragraphs.length) }, (_, k) => String(story.paragraphs.item(k).justification));
      const { report } = openSession(story, settings);
      const errors = report.paragraphs.flatMap((p) => p.plan.violations.filter((v) => v.severity === 'error').map((v) => `¶${p.index + 1} l${v.line + 1} ${v.kind}`));
      const notSteered = report.paragraphs.filter((p) => !p.steered).map((p) => `¶${p.index + 1}${p.mismatch ? ` line ${p.mismatch.line + 1}: planned …${p.mismatch.planned.text.trim().slice(-14)} got …${p.mismatch.got?.text.trim().slice(-14) ?? 'nothing'}` : ''}`);
      // Right-aligned lines must still end flush at their measure (only the left edge is ragged).
      const ragged = alignments.map((a) => a === 'RIGHT_ALIGN');
      let flushOff = 0;
      let flushWorst = '';
      paragraphs(story, (q, k) => {
        if (!ragged[k]) return;
        const lines = q.lines;
        for (let i = 0; i < Number(lines.length); i++) {
          const l = lines.item(i);
          const f = asArray(l.parentTextFrames)[0];
          if (!f || Number(f.textFramePreferences.textColumnCount) > 1) continue;
          const right = Number(f.geometricBounds[3]) - Number(q.rightIndent);
          const chars = asArray(l.characters.everyItem().getElements());
          let c = chars.length - 1;
          while (c > 0 && /^[\s\r]$/.test(String(chars[c].contents))) c--;
          const end = Number(chars[c].endHorizontalOffset);
          if (right - end > 0.5 && right - end > flushOff) {
            flushOff = right - end;
            flushWorst = `¶${k + 1} line ${i + 1} at y ${Number(l.baseline).toFixed(0)}: …${String(l.contents).slice(-12)}`;
          }
        }
      });
      const alignmentKept = alignments.every((a, k) => a === 'CENTER_ALIGN' || String(story.paragraphs.item(k).justification) === a || a.endsWith('JUSTIFIED'));
      const whole = setWholeStory(story, settings);
      const unfrozen = unfreezeFlatter(story);
      const textBack = String(story.contents) === original;
      removeFlatter(story);
      const alignmentBack = alignments.every((a, k) => String(story.paragraphs.item(k).justification) === a);
      out[c.name] = {
        live: `${report.linesAsPlanned}/${report.linesPlanned}`,
        rounds: report.rounds,
        alarms: compatibilityAlarms(report).length,
        notSteered: notSteered.slice(0, 3),
        unsupported: [...new Set(report.paragraphs.flatMap((q) => q.unsupported))],
        errors: errors.length,
        flushOff: +flushOff.toFixed(2),
        flushWorst,
        alignmentKept,
        whole: `${whole.lines - whole.missed}/${whole.lines}`,
        unfrozen,
        textBack,
        alignmentBack,
        ms: Date.now() - t0,
      };
    } catch (e) {
      out[c.name] = { error: String(e), stack: String((e as Error).stack ?? '').split('\n').slice(0, 4).join(' | ') };
    }
    page += c.pages ?? 1;
  }
  // Every case: every visible line as planned live (overset lines aside), every line of the whole story at its fixed
  // break, no compatibility alarm, text and alignments back after Unfreeze and Remove.
  const failed = Object.entries(out).filter(([k, v]) => {
    const r = v as { error?: string; live: string; whole: string; alarms: number; textBack: boolean; alignmentBack: boolean };
    if (r.error) return true;
    if (!r.textBack || !r.alignmentBack) return true;
    if (CASES.find((c) => c.name === k)?.unsupported) return false;
    const [a, b] = r.live.split('/').map(Number);
    const [c, d] = r.whole.split('/').map(Number);
    return a !== b || c !== d || r.alarms > 0;
  }).map(([k]) => k);
  return { pass: failed.length === 0, failed, missingSpecials: [...missingSpecials], ...out };
});
