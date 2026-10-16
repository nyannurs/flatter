// Bundles the playground into one self-contained HTML file (font and texts inlined).
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const result = await build({
  entryPoints: [resolve(here, 'playground/main.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  write: false,
  loader: { '.woff': 'binary', '.txt': 'text' },
  logLevel: 'warning',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const page = readFileSync(resolve(here, 'playground/template.html'), 'utf8').replace('/*SCRIPT*/', () => js);
mkdirSync(resolve(here, 'out'), { recursive: true });
// Published page: content only, the artifact host adds the document skeleton.
writeFileSync(resolve(here, 'out/playground-artifact.html'), page);
// Local page: same content wrapped in a full document.
const local = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n${page}</body>\n</html>\n`;
const out = resolve(here, 'out/playground.html');
writeFileSync(out, local);
console.log(`Playground written to ${out} (${(local.length / 1024).toFixed(0)} KB)`);
