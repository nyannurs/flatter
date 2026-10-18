// Bundles the panel.
//   node packages/panel/build.mjs --dev [--watch]   → dist/dev-panel/ as "Flatter (dev)" (own plugin id, so it runs
//                                                   beside an installed release); load it with tools/indesign/uxp-load.mjs
//   node packages/panel/build.mjs [--out <file>]     → release bundle (packages/panel/plugin/index.js, or <file>)
import { context } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dev = process.argv.includes('--dev');
const watch = process.argv.includes('--watch');
// --out <file>: write the bundle elsewhere (the release package is staged outside plugin/).
const outArg = process.argv.indexOf('--out');
const manifest = JSON.parse(readFileSync(resolve(here, 'plugin/manifest.json'), 'utf8'));
let outfile = outArg > 0 ? resolve(process.argv[outArg + 1]) : resolve(here, 'plugin/index.js');
if (dev && outArg < 0) {
  // The dev panel gets its own id and name, so it never clashes with an installed release.
  const stage = resolve(here, '../../dist/dev-panel');
  mkdirSync(stage, { recursive: true });
  cpSync(resolve(here, 'plugin/index.html'), resolve(stage, 'index.html'));
  cpSync(resolve(here, 'plugin/icons'), resolve(stage, 'icons'), { recursive: true });
  const devManifest = { ...manifest, id: `${manifest.id}.dev`, name: `${manifest.name} (dev)` };
  devManifest.entrypoints = manifest.entrypoints.map((e) => ({ ...e, label: { default: `${e.label.default} (dev)` } }));
  writeFileSync(resolve(stage, 'manifest.json'), JSON.stringify(devManifest, null, 2));
  outfile = resolve(stage, 'index.js');
}
const ctx = await context({
  entryPoints: [resolve(here, 'src/main.ts')],
  outfile,
  bundle: true,
  format: 'iife',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  target: 'es2020',
  external: ['uxp', 'indesign'],
  define: { FLATTER_DEV: String(dev), FLATTER_VERSION: JSON.stringify(dev ? `${manifest.version}-dev` : manifest.version) },
  logLevel: 'warning',
});
if (watch) {
  await ctx.watch();
  console.log(`watching (${dev ? 'dev' : 'release'} build) → ${outfile}`);
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log(`built ${dev ? 'dev' : 'release'} panel → ${outfile}`);
}
