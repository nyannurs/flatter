// Bundles tools/indesign/spikes/src/<name>.ts (with @flatter/core and @flatter/hyphenation) into
// tools/indesign/spikes/dist/<name>.idjs, a UXP script runnable with tools/indesign/run.sh.
import { build } from 'esbuild';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, 'spikes/src');
const only = process.argv[2];
const entries = readdirSync(src).filter((f) => /^[si]\d.*\.ts$/.test(f) && (!only || f.startsWith(only)));
const variants = { 's1-steer.ts': [['s1-steer-a', false], ['s1-steer-b', true]] };
for (const f of entries) {
  for (const [name, hyph] of variants[f] ?? [[f.replace(/\.ts$/, ''), undefined]]) {
  await build({
    entryPoints: [resolve(src, f)],
    outfile: resolve(here, 'spikes/dist', `${name}.idjs`),
    define: hyph === undefined ? {} : { SPIKE_HYPHENATION: String(hyph) },
    bundle: true,
    format: 'cjs',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    target: 'es2020',
    external: ['indesign', 'uxp'],
    logLevel: 'warning',
    // Report load-time errors (a UXP script that throws while loading otherwise returns nothing).
    banner: { js: 'try {' },
    footer: { js: '} catch (e) { require("indesign").app.insertLabel("flatter-result", JSON.stringify({ loadError: String(e), stack: String(e && e.stack) })); }' },
  });
  // InDesign runs a UXP script asynchronously (time-shared, doScript returns at once) when its text contains "async"
  // followed by a word, even in a string. The only one is an error message in the hyphen package (2026-11-18).
  const out = resolve(here, 'spikes/dist', `${name}.idjs`);
  const code = readFileSync(out, 'utf8');
  const sync = code.replace(/\basync mode\b/g, 'asynchronous mode');
  if (/\basync\s+[A-Za-z_$(]/.test(sync)) console.warn(`${name}.idjs still contains "async": InDesign will run it asynchronously`);
  if (sync !== code) writeFileSync(out, sync);
  console.log(`built spikes/dist/${name}.idjs`);
  }
}
