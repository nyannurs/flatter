// Bundles the panel into packages/panel/plugin/index.js. Load packages/panel/plugin in the UXP Developer Tool.
//   node packages/panel/build.mjs [--dev] [--watch]
import { context } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dev = process.argv.includes('--dev');
const watch = process.argv.includes('--watch');
const ctx = await context({
  entryPoints: [resolve(here, 'src/main.ts')],
  outfile: resolve(here, 'plugin/index.js'),
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
  console.log(`built ${dev ? 'dev' : 'release'} panel → packages/panel/plugin/index.js`);
}
