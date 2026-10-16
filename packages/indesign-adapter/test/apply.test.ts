import { createHyphenator } from '@flatter/hyphenation';
import { describe, expect, it } from 'vitest';
import { applyToPort } from '../src/index.ts';
import { FakeInDesign } from './fake-indesign.ts';

const DE = [
  'Ein guter Flattersatz entsteht nicht von selbst. Wer Texte linksbündig setzt, überlässt den rechten Rand scheinbar dem Zufall, doch gerade dieser Rand bestimmt, ob eine Seite ruhig oder unruhig wirkt.',
  'In der Wachstube des alten Rathauses lagen die Druckerzeugnisse der vergangenen Woche auf einem Stapel: Flugblätter, Programmhefte und ein dünnes Verzeichnis der Ausstellungen im Staubecken der ehemaligen Mühle.',
  'Die Rechtschreibreform von 2006 hat das Trennen in einigen Punkten vereinfacht. Das ck bleibt zusammen, das st darf getrennt werden, und bei Zusammensetzungen wie Schifffahrt bleiben alle drei Konsonanten erhalten.',
];
const de = createHyphenator({ language: 'de' });
const ourSafe = (w: string) => de.classify(w).filter((p) => p.quality === 'A' || p.quality === 'B').map((p) => p.index);

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
