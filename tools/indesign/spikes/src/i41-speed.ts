// Speed benchmark as a script (2026-11-18): the same work as the dev panel's "bench" command (packages/panel/src/bench.ts),
// run as a UXP script that InDesign executes to completion. Config: doScript arguments [kind, n] (from the panel) or
// the app label "flatter-bench" as JSON {"kind": "micro" | "apply", "n": number} (from run.sh).
import { runBench, type BenchConfig } from '../../../../packages/panel/src/bench.ts';
import { DomPort } from '@flatter/indesign-adapter';

// Time every DomPort method (ms and calls), as i31 does.
const profile: Record<string, { ms: number; calls: number }> = {};
for (const name of Object.getOwnPropertyNames(DomPort.prototype)) {
  const proto = DomPort.prototype as any;
  const orig = proto[name];
  if (name === 'constructor' || typeof orig !== 'function') continue;
  proto[name] = function (this: any, ...a: any[]) {
    const t = Date.now();
    try {
      return orig.apply(this, a);
    } finally {
      const p = (profile[name] ??= { ms: 0, calls: 0 });
      p.ms += Date.now() - t;
      p.calls++;
    }
  };
}
const top = () => Object.fromEntries(Object.entries(profile).sort((a, b) => b[1].ms - a[1].ms).slice(0, 12).map(([k, v]) => [k, `${v.ms} ms / ${v.calls}`]));

declare const require: (m: string) => any;
const { app } = require('indesign');
const script = require('uxp').script;
const args = (script?.args ?? []) as string[];
const config: BenchConfig = args.length >= 2 ? { kind: args[0] as BenchConfig['kind'], n: Number(args[1]), visible: args[2] === 'true' } : JSON.parse(String(app.extractLabel('flatter-bench') || '{"kind":"micro","n":200}'));
const out = JSON.stringify({ context: args.length >= 2 ? 'doScript(file) from the panel' : 'script (run.sh)', ...runBench(config), profile: top() }, null, 1);
app.insertLabel('flatter-result', out);
try {
  script.setResult(out);
} catch {
  // Not called through doScript.
}
