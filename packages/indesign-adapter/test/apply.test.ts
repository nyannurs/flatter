import { createHyphenator } from '@flatter/hyphenation';
import { describe, expect, it } from 'vitest';
import { applyToPort, compatibilityAlarms, steeringFailed, type ApplyResult } from '../src/index.ts';
import { FakeInDesign } from './fake-indesign.ts';

const DE = [
  'Ein guter Flattersatz entsteht nicht von selbst. Wer Texte linksbündig setzt, überlässt den rechten Rand scheinbar dem Zufall, doch gerade dieser Rand bestimmt, ob eine Seite ruhig oder unruhig wirkt.',
  'In der Wachstube des alten Rathauses lagen die Druckerzeugnisse der vergangenen Woche auf einem Stapel: Flugblätter, Programmhefte und ein dünnes Verzeichnis der Ausstellungen im Staubecken der ehemaligen Mühle.',
  'Die Rechtschreibreform von 2006 hat das Trennen in einigen Punkten vereinfacht. Das ck bleibt zusammen, das st darf getrennt werden, und bei Zusammensetzungen wie Schifffahrt bleiben alle drei Konsonanten erhalten.',
];
const de = createHyphenator({ language: 'de' });
const ourSafe = (w: string) => de.classify(w).filter((p) => p.quality === 'A' || p.quality === 'B').map((p) => p.index);

describe('a forced line break at the paragraph end', () => {
  it('counts the empty last line as set as planned', () => {
    const fake = new FakeInDesign([`${DE[0]}\n`, DE[1]!], { measure: 240, accepts: ourSafe });
    const r = applyToPort(fake);
    expect(r.linesAsPlanned).toBe(r.linesPlanned);
    expect(r.rounds).toBeLessThanOrEqual(2);
  });
});

describe('right-aligned text (ADR-037)', () => {
  it('steers right-aligned paragraphs with teeth from the left, as planned', () => {
    for (const measure of [220, 260]) {
      const fake = new FakeInDesign(DE, { measure, accepts: ourSafe, alignments: ['RIGHT_ALIGN', 'LEFT_ALIGN', 'RIGHT_ALIGN'] });
      const r = applyToPort(fake, { showBands: true });
      expect(r.linesAsPlanned, `measure ${measure}`).toBe(r.linesPlanned);
      // Teeth of right-aligned paragraphs sit in the left half of the column, the others in the right half.
      for (const t of fake.teeth) {
        const centre = (t.bounds[1] + t.bounds[3]) / 2;
        expect(t.paragraph === 1 ? centre > measure / 2 : centre < measure / 2, `tooth of ¶${t.paragraph + 1}`).toBe(true);
      }
      // Its strips start at the left edge of the measure.
      expect(fake.bands.some((b) => b.kind === 'long' && Math.abs(b.bounds[1]) < 0.01)).toBe(true);
    }
  });
});

describe('apply loop against a greedy composer', () => {
  it('steers every line as planned when InDesign accepts our points', () => {
    for (const measure of [220, 260, 300]) {
      const fake = new FakeInDesign(DE, { measure, accepts: ourSafe });
      const r = applyToPort(fake);
      expect(r.linesAsPlanned, `measure ${measure}`).toBe(r.linesPlanned);
      expect(r.paragraphs.every((p) => p.steered)).toBe(true);
      expect(r.rounds).toBeLessThanOrEqual(3);
    }
  });

  it('never plans a point InDesign refuses when probing is available', () => {
    // The fake dictionary refuses every second of our points.
    const accepts = (w: string) => ourSafe(w).filter((_, i) => i % 2 === 1);
    const fake = new FakeInDesign(DE, { measure: 260, accepts });
    const r = applyToPort(fake);
    expect(r.linesAsPlanned).toBe(r.linesPlanned);
    expect(r.paragraphs.flatMap((p) => p.refused)).toEqual([]);
  });

  it('re-plans refused points without probing (predict and verify)', () => {
    const accepts = (w: string) => ourSafe(w).filter((_, i) => i % 2 === 1);
    let refusedSomewhere = false;
    for (const measure of [200, 220, 240, 260, 280, 300]) {
      const fake = new FakeInDesign(DE, { measure, accepts, probing: false });
      const r = applyToPort(fake, { maxRounds: 10 });
      if (r.paragraphs.some((p) => p.refused.length)) refusedSomewhere = true;
      expect(r.linesAsPlanned, `measure ${measure}`).toBe(r.linesPlanned);
    }
    expect(refusedSomewhere).toBe(true);
  });

  it('moves teeth when an earlier paragraph changes its line count', () => {
    const fake = new FakeInDesign(DE, { measure: 240, accepts: ourSafe, spaceBefore: 6 });
    const r = applyToPort(fake);
    expect(r.linesAsPlanned).toBe(r.linesPlanned);
  });

  it('continues the rhythm across paragraphs when asked', () => {
    const fake = new FakeInDesign(DE, { measure: 260, accepts: ourSafe });
    const r = applyToPort(fake, { continuous: true });
    for (let i = 1; i < r.paragraphs.length; i++) {
      const prev = r.paragraphs[i - 1]!.plan.lines.at(-1)!;
      expect(r.paragraphs[i]!.plan.lines[0]!.role).not.toBe(prev.role);
    }
  });

  it('places one tooth per band line and none on last lines', () => {
    const fake = new FakeInDesign(DE, { measure: 280, accepts: ourSafe });
    const r = applyToPort(fake);
    const bandLines = r.paragraphs.reduce((s, p) => s + p.plan.lines.filter((l) => l.kind === 'band' && l.steerWidth < 280 - 1e-6).length, 0);
    expect(fake.teeth.length).toBe(bandLines);
    expect(r.teeth).toBe(bandLines);
  });
});

describe('tracking rescue in the apply loop', () => {
  it('applies the planned tracking so tracked lines also break as planned', () => {
    let tracked = 0;
    for (const measure of [200, 210, 220, 230, 240]) {
      const fake = new FakeInDesign(DE, { measure, accepts: ourSafe });
      const r = applyToPort(fake, { tracking: { enabled: true, max: 5 } });
      tracked += r.trackedLines;
      expect(r.linesAsPlanned, `measure ${measure}`).toBe(r.linesPlanned);
    }
    expect(tracked).toBeGreaterThan(0);
  });
});

describe('precise tracking with word spaces in the apply loop (ADR-015)', () => {
  it('tracks letters and word spaces, and every line still breaks as planned', () => {
    let spaced = 0;
    for (const measure of [200, 220, 240]) {
      const fake = new FakeInDesign(DE, { measure, accepts: ourSafe });
      const r = applyToPort(fake, { tracking: { enabled: true, mode: 'precise', max: 10 }, wordSpaceShare: 0.3 });
      spaced += r.spacedLines;
      expect(r.linesAsPlanned, `measure ${measure}`).toBe(r.linesPlanned);
      // Each spaced line's word spaces carry its letter tracking plus its word-space tracking.
      for (const p of r.paragraphs) {
        const track = fake.tracking.get(p.index) ?? [];
        const text = [...DE[p.index]!];
        const spaceValues = new Set(track.filter((_, k) => text[k] === ' ').map((v) => v.toFixed(4)));
        for (const l of p.plan.lines.filter((x) => x.wordSpace !== 0)) expect(spaceValues.has((l.tracking + l.wordSpace).toFixed(4)), l.text).toBe(true);
      }
    }
    expect(spaced).toBeGreaterThan(0);
  });
});

describe('typed hyphens InDesign will not break after', () => {
  // Like "master-builder" with hyphenation on: the composer never breaks after "master-".
  // Long compounds: breaking at the typed hyphen is often the only good break.
  const text = Array.from({ length: 10 }, () => 'Der Schifffahrtsgesellschafts-Vorsitzende und die Donaudampfschiffahrts-Kapitäne trafen sich').join(' ');
  const refuses = (c: string) => c.startsWith('Schifffahrtsgesellschafts') || c.startsWith('Donaudampfschiffahrts');

  it('probes compounds and never plans the refused break', () => {
    const fake = new FakeInDesign([text], { measure: 260, accepts: ourSafe, probing: true, refusesAfterHyphen: refuses });
    const r = applyToPort(fake, {});
    expect(r.linesAsPlanned).toBe(r.linesPlanned);
    expect(r.paragraphs[0]!.plan.lines.some((l) => /(gesellschafts|schiffahrts)-$/.test(l.text))).toBe(false);
    expect(r.paragraphs[0]!.refused).toEqual([]);
  });

  it('without probing, refuses a point in every occurrence of the word at once', () => {
    // The same text four times: a refused point costs one round, not one round per occurrence.
    const repeated = [Array.from({ length: 4 }, () => DE[0]).join(' ')];
    const accepts = (w: string) => ourSafe(w).filter((_, i) => i % 2 === 1);
    let refused = 0;
    for (const measure of [200, 220, 240, 260, 280, 300]) {
      const fake = new FakeInDesign(repeated, { measure, accepts, probing: false });
      const r = applyToPort(fake, { maxRounds: 10 });
      expect(r.linesAsPlanned, `measure ${measure}`).toBe(r.linesPlanned);
      const words = r.paragraphs[0]!.refused;
      // Each refused word once, although every word occurs four times.
      expect(new Set(words).size).toBe(words.length);
      refused += words.length;
    }
    expect(refused).toBeGreaterThan(0);
  });
});

describe('threaded frames of different widths', () => {
  it('plans each line at the width of the frame it sits in', () => {
    for (const [line, wide] of [[4, 330], [6, 160], [9, 300]] as const) {
      const fake = new FakeInDesign(DE, { measure: 220, accepts: ourSafe, frameFrom: { line, measure: wide } });
      const r = applyToPort(fake, {});
      expect(r.linesAsPlanned, `frame change after line ${line}`).toBe(r.linesPlanned);
      // Lines in the second frame were planned for its width.
      const lines = r.paragraphs.flatMap((p) => p.plan.lines);
      expect(lines.slice(line).every((l) => l.available + l.indent === wide)).toBe(true);
      expect(lines.slice(0, Math.min(line, lines.length)).every((l) => l.available + l.indent === 220)).toBe(true);
    }
  });
});

describe('compatibility alarms', () => {
  // Lower-case long words with safe points, as German text has plenty of.
  const text = ['die verschiedensten unterschiedlichen zusammenhänge entstehen nachträglich durch verantwortungsvolle überlegungen und gemeinsame entscheidungen über wirtschaftliche bedingungen, sowie durch regelmäßige veranstaltungen mit ausgezeichneten teilnehmern aus benachbarten gemeinden und landwirtschaftlichen betrieben, die gelegentlich erhebliche schwierigkeiten bereiten'];

  it('stay quiet when InDesign behaves as expected', () => {
    const r = applyToPort(new FakeInDesign(text, { measure: 220, accepts: ourSafe }), {});
    expect(r.probeCheck.checked).toBeGreaterThan(10);
    expect(compatibilityAlarms(r)).toEqual([]);
  });

  it('report InDesign giving no hyphenation points', () => {
    const r = applyToPort(new FakeInDesign(text, { measure: 220, accepts: () => [] }), {});
    expect(compatibilityAlarms(r).join(' ')).toMatch(/no hyphenation points/);
  });

  it('report InDesign ignoring the steering', () => {
    const fake = new FakeInDesign(DE, { measure: 220, accepts: ourSafe });
    // Teeth stop working, as if an update changed how text wrap affects the composer.
    fake.setTeeth = () => {};
    const r = applyToPort(fake, {});
    expect(compatibilityAlarms(r).join(' ')).toMatch(/did not follow/);
  });
});

describe('band view', () => {
  it('shows the bands when asked and removes them when switched off', () => {
    const fake = new FakeInDesign(DE, { measure: 220, accepts: ourSafe });
    applyToPort(fake, { showBands: true });
    expect(fake.bands.length).toBeGreaterThanOrEqual(2 * DE.length);
    expect(fake.bands.filter((b) => b.kind === 'long').length).toBe(fake.bands.filter((b) => b.kind === 'short').length);
    applyToPort(fake, { showBands: false });
    expect(fake.bands).toEqual([]);
  });
});

describe('live session (panel)', () => {
  it('takes many slider ticks without reading back, then verifies to every line as planned', async () => {
    const { FlatterSession } = await import('../src/index.ts');
    const fake = new FakeInDesign(DE, { measure: 260, accepts: ourSafe });
    const s = new FlatterSession(fake);
    s.prepare({});
    s.plan({ zoneShare: 0.2, bandShare: 0.5 });
    s.steer();
    s.verify();
    const reads = fake.compositions;
    for (let k = 0; k < 20; k++) {
      s.plan({ zoneShare: 0.12 + (0.13 * k) / 19, bandShare: 0.5 });
      s.steer();
    }
    expect(fake.compositions).toBe(reads); // no read-back during the drag
    const r = s.verify();
    expect(r.linesAsPlanned).toBe(r.linesPlanned);
  });
});

describe('overset stories', () => {
  it('steers the visible lines, places no teeth below the frame, and reports overset lines', () => {
    const fake = new FakeInDesign(DE, { measure: 260, accepts: ourSafe, maxLines: 10 });
    const r = applyToPort(fake);
    expect(r.oversetLines).toBeGreaterThan(0);
    expect(r.linesAsPlanned).toBe(r.linesPlanned);
    expect(r.linesPlanned).toBe(10);
    expect(fake.teeth.every((t) => t.bounds[2] <= 13 * 10 + 1)).toBe(true);
  });
});

describe('paragraphs with unusual content', () => {
  // A big story with several paragraph styles crashed in verify (designer's report, 2026-10-28): a paragraph that
  // starts with a forced line break plans an empty first line.
  const long = 'Ein guter Flattersatz entsteht nicht von selbst und braucht viel Pflege bei jedem einzelnen Wort';
  const cases: Record<string, string> = {
    'forced break first': '\u2028' + long,
    'forced break last': long + '\u2028',
    'two forced breaks': long + '\u2028\u2028' + long,
    'only forced breaks': '\u2028\u2028',
    'only spaces': '     ',
    'only no-break spaces': '\u00a0\u00a0',
    'only tabs': '\t\t',
    'spaces first': '   ' + long,
    'two characters': 'ab',
  };
  for (const [name, text] of Object.entries(cases)) {
    it(`does not fail on a paragraph with ${name}`, () => {
      const fake = new FakeInDesign([long + ' ' + long, text, long], { measure: 200, accepts: ourSafe });
      const r = applyToPort(fake, { tracking: { enabled: true, mode: 'precise', max: 5 }, wordSpaceShare: 0.25 });
      expect(r.paragraphs.length).toBeGreaterThan(0);
    });
  }

  it('sets the lines of a paragraph that starts with a forced line break as planned', () => {
    const fake = new FakeInDesign(['\u2028' + long + ' ' + long], { measure: 200, accepts: ourSafe });
    const r = applyToPort(fake);
    expect(r.linesAsPlanned).toBe(r.linesPlanned);
  });
});


describe('discretionary line breaks', () => {
  it('lets a URL break after a discretionary line break, without a hyphen', () => {
    const url = 'Mehr unter https://www.example.org/\u200bverzeichnis/\u200bausstellungen/\u200b2026/\u200bstaubecken-der-muehle im Netz und noch etwas mehr Text danach.';
    const fake = new FakeInDesign([url], { measure: 160, accepts: ourSafe });
    const r = applyToPort(fake);
    expect(r.linesAsPlanned).toBe(r.linesPlanned);
    const ends = r.paragraphs[0]!.plan.lines.map((l) => l.text);
    expect(ends.some((t) => /\/\u200b$/.test(t.trimEnd()))).toBe(true);
    expect(r.paragraphs[0]!.plan.lines.every((l) => !l.endsWithHyphen || !/\u200b$/.test(l.text))).toBe(true);
  });
});

describe('steering check with unsupported content', () => {
  it('still notices a failed story when one paragraph has a tab', () => {
    const para = (unsupported: string[], visibleLines: number, linesAsPlanned: number) => ({ unsupported, visibleLines, linesAsPlanned }) as unknown as ApplyResult['paragraphs'][number];
    const r = { paragraphs: [para(['tab'], 5, 5), para([], 20, 4)], linesPlanned: 25, linesAsPlanned: 9 } as unknown as ApplyResult;
    expect(steeringFailed(r)).toBe(true);
    expect(compatibilityAlarms({ ...r, probeCheck: { checked: 0, empty: 0 } })[0]).toContain('only 4 of 20');
    const fine = { paragraphs: [para(['tab'], 5, 0), para([], 20, 20)], linesPlanned: 25, linesAsPlanned: 20 } as unknown as ApplyResult;
    expect(steeringFailed(fine)).toBe(false);
  });
});
