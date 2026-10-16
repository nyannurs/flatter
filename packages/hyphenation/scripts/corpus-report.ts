// Review report: prints every corpus word where Safe mode would use an unlisted point or a wrong class A,
// and the share of acceptable points Safe mode can use. Usage: npm run corpus-report -- de de
import { createHyphenator, render, type HyphenLanguage } from '../src/index.ts';
import { readCorpus } from '../test/corpus.ts';
const [file, lang] = process.argv.slice(2) as [string, HyphenLanguage];
const h = createHyphenator({ language: lang });
let allowedTotal = 0, safeTotal = 0;
for (const e of readCorpus(file)) {
  const pts = h.classify(e.word);
  const safe = pts.filter((p) => p.quality === 'A' || p.quality === 'B');
  const bad = safe.filter((p) => !e.allowed.includes(p.index));
  const badA = pts.filter((p) => p.quality === 'A' && !e.joints.includes(p.index));
  const reachable = e.allowed.filter((i) => i >= 2 && e.word.length - i >= 3);
  allowedTotal += reachable.length; safeTotal += safe.filter((p) => e.allowed.includes(p.index)).length;
  if (bad.length || badA.length) console.log(`L${e.line} ${e.word}: corpus ${render(e.word, e.allowed)} | safe ${safe.map((p) => p.quality + ':' + render(e.word, [p.index])).join(' ')}${badA.length ? ' | A-not-joint ' + badA.map((p) => render(e.word, [p.index])).join(' ') : ''}`);
}
console.log(`coverage: ${safeTotal}/${allowedTotal} acceptable points are usable in Safe mode (${((100 * safeTotal) / allowedTotal).toFixed(0)} %)`);
