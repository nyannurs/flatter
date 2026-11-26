// Builds the release panel and packages it as an installable .ccx (a zip with manifest.json at its root).
//   npm run package      → dist/Flatter-<version>.ccx, and the same file as dist/Flatter.ccx
// Upload both to the GitHub release: Flatter.ccx gives the README one download link that always gets the newest version
// (https://github.com/nyannurs/flatter/releases/latest/download/Flatter.ccx).
// Install by double-clicking the .ccx (Creative Cloud asks to confirm), or with Adobe's installer:
//   "/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent" --install dist/Flatter-<version>.ccx
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = resolve(root, 'packages/panel/plugin');
const stage = resolve(root, 'dist/ccx-stage');
const manifest = JSON.parse(readFileSync(resolve(plugin, 'manifest.json'), 'utf8'));
const out = resolve(root, `dist/Flatter-${manifest.version}.ccx`);

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const f of ['manifest.json', 'index.html', 'icons']) cpSync(resolve(plugin, f), resolve(stage, f), { recursive: true });
// Flatter's own licence (PolyForm Shield 1.0.0) and the licences of the bundled hyphenation library and patterns travel
// with every copy.
cpSync(resolve(root, 'LICENSE.md'), resolve(stage, 'LICENSE.md'));
cpSync(resolve(root, 'packages/panel/licenses/THIRD-PARTY-LICENSES.txt'), resolve(stage, 'THIRD-PARTY-LICENSES.txt'));
// Release bundle: no dev command channel.
execFileSync(process.execPath, [resolve(root, 'packages/panel/build.mjs'), '--out', resolve(stage, 'index.js')], { stdio: 'inherit' });
rmSync(out, { force: true });
execFileSync('zip', ['-r', '-X', '-q', out, '.'], { cwd: stage, stdio: 'inherit' });
cpSync(out, resolve(root, 'dist/Flatter.ccx'));
console.log(`packaged ${out} (and dist/Flatter.ccx)`);
