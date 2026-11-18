// What starting a separate UXP script through app.doScript costs (2026-11-18): a tiny one, one padded to 100 KB and
// one to 1 MB, and one that receives 200 KB of JSON as its argument. Decides how heavy work can be handed to a script
// that InDesign runs to completion.
import { app, id } from './lib.ts';

const tiny = "require('indesign').app.insertLabel('flatter-ping', String(Date.now()));";
const pad = (kb: number) => `${tiny}\n/*${'x'.repeat(kb * 1024)}*/`;
const withArg = "const a = require('uxp').script.args[0]; const j = JSON.parse(a); require('uxp').script.setResult(String(j.length));";
const time = (src: string, times: number, args: string[] = []) => {
  const out: number[] = [];
  let r: unknown;
  for (let k = 0; k < times; k++) {
    const t = Date.now();
    r = app.doScript(src, id.ScriptLanguage.UXPSCRIPT, args, id.UndoModes.AUTO_UNDO, 'Flatter ping');
    out.push(Date.now() - t);
  }
  return { ms: out, result: r };
};
const json = JSON.stringify(Array.from({ length: 9000 }, (_, k) => [k * 7, k * 7 + 5, (k % 11) - 5]));
let out: unknown;
try {
  const requireOnly = "const id = require('indesign'); require('uxp').script.setResult('ok');";
  const requireAndRead = "const id = require('indesign'); require('uxp').script.setResult(String(id.app.documents.length));";
  const nothing = "require('uxp').script.setResult('ok');";
  out = { nothing: time(nothing, 3).ms, requireOnly: time(requireOnly, 3).ms, requireAndRead: time(requireAndRead, 3).ms, tiny: time(tiny, 3).ms, kb100: time(pad(100), 3).ms, mb1: time(pad(1024), 2).ms, json200kb: { kb: Math.round(json.length / 1024), ...time(withArg, 3, [json]) } };
} catch (e) {
  out = { error: String(e) };
}
app.insertLabel('flatter-result', JSON.stringify(out));
