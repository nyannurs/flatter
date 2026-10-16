// Load, reload or unload the Flatter panel in InDesign through the running UXP Developer Tool service,
// without clicks in its window. Speaks the same WebSocket protocol as Adobe's uxp CLI
// (ws://localhost:14001/socket/cli). The UXP Developer Tool must be open.
//   node tools/indesign/uxp-load.mjs load|reload|unload
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pluginDir = resolve(here, '../../packages/panel/plugin');
const sessionFile = resolve(here, '../../packages/panel/.uxp-session.json');
const action = process.argv[2] ?? 'load';
const port = Number(process.env.UXP_PORT ?? 14001);

const ws = new WebSocket(`ws://localhost:${port}/socket/cli`);
const clients = new Map();
const pending = new Map();
let nextId = 0;

function send(msg) {
  return new Promise((res, rej) => {
    msg.requestId = ++nextId;
    pending.set(msg.requestId, { res, rej });
    ws.send(JSON.stringify(msg));
  });
}
const proxy = (clientId, message) => send({ command: 'proxy', clientId, message });

ws.addEventListener('message', (ev) => {
  const data = JSON.parse(String(ev.data));
  if (data.command === 'didAddRuntimeClient') clients.set(data.id, data);
  else if (data.command === 'didRemoveRuntimeClient') clients.delete(data.id);
  else if (data.command === 'reply' && pending.has(data.requestId)) {
    const p = pending.get(data.requestId);
    pending.delete(data.requestId);
    data.error ? p.rej(new Error(data.error)) : p.res(data);
  }
});
ws.addEventListener('error', () => {
  console.error(`Cannot reach the UXP Developer Tool service on port ${port}. Is the UXP Developer Tool open?`);
  process.exit(1);
});

ws.addEventListener('open', async () => {
  await new Promise((r) => setTimeout(r, 1500));
  const indesign = [...clients.values()].find((c) => c.app?.appId === 'ID' || c.appId === 'ID' || JSON.stringify(c).includes('"ID"'));
  if (!indesign) {
    console.error('InDesign is not connected to the UXP Developer Tool service. Is InDesign running?');
    console.error('Connected clients:', JSON.stringify([...clients.values()]));
    process.exit(1);
  }
  try {
    if (action === 'load') {
      const reply = await proxy(indesign.id, { command: 'Plugin', action: 'load', params: { provider: { type: 'disk', path: pluginDir } }, breakOnStart: false });
      writeFileSync(sessionFile, JSON.stringify({ pluginSessionId: reply.pluginSessionId, clientId: indesign.id }));
      console.log('Loaded Flatter in InDesign', reply.pluginSessionId ?? '');
    } else {
      if (!existsSync(sessionFile)) throw new Error('No loaded session recorded; run "load" first.');
      const { pluginSessionId } = JSON.parse(readFileSync(sessionFile, 'utf8'));
      const reply = await proxy(indesign.id, { command: 'Plugin', action, pluginSessionId });
      if (action === 'unload') unlinkSync(sessionFile);
      console.log(`${action} done`, reply.pluginSessionId ?? '');
    }
  } catch (e) {
    console.error(`${action} failed:`, e.message);
    process.exitCode = 1;
  }
  ws.close();
});
