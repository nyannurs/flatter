// Speed benchmark as a script (2026-11-18): the same work as the dev panel's "bench" command (packages/panel/src/bench.ts),
// run as a UXP script that InDesign executes to completion. Config: doScript arguments [kind, n] (from the panel) or
// the app label "flatter-bench" as JSON {"kind": "micro" | "apply", "n": number} (from run.sh).
import { runBench, type BenchConfig } from '../../../../packages/panel/src/bench.ts';

declare const require: (m: string) => any;
const { app } = require('indesign');
const script = require('uxp').script;
const args = (script?.args ?? []) as string[];
const config: BenchConfig = args.length >= 2 ? { kind: args[0] as BenchConfig['kind'], n: Number(args[1]), visible: args[2] === 'true' } : JSON.parse(String(app.extractLabel('flatter-bench') || '{"kind":"micro","n":200}'));
const out = JSON.stringify({ context: args.length >= 2 ? 'doScript(file) from the panel' : 'script (run.sh)', ...runBench(config) }, null, 1);
app.insertLabel('flatter-result', out);
try {
  script.setResult(out);
} catch {
  // Not called through doScript.
}
