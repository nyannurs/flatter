// Bundles the panel into packages/panel/plugin/index.js. Load packages/panel/plugin in the UXP Developer Tool.
//   node packages/panel/build.mjs [--dev] [--watch]
import { context } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dev = process.argv.includes('--dev');
const watch = process.argv.includes('--watch');
// --out <file>: write the bundle elsewhere (the release package is staged outside plugin/).
const outArg = process.argv.indexOf('--out');
const outfile = outArg > 0 ? resolve(process.argv[outArg + 1]) : resolve(here, 'plugin/index.js');
const ctx = await context({
  entryPoints: [resolve(here, 'src/main.ts')],
  outfile,
  bundle: true,
  format: 'iife',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  target: 'es2020',
  external: ['uxp', 'indesign'],
  define: { FLATTER_DEV: String(dev) },
  logLevel: 'warning',
});
if (watch) {
  await ctx.watch();
  console.log(`watching (${dev ? 'dev' : 'release'} build) → packages/panel/plugin/index.js`);
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log(`built ${dev ? 'dev' : 'release'} panel → ${outfile}`);
}
