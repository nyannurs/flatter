// The panel's self-check passes on this InDesign, leaves no document open, and catches a broken
// behaviour: with probing made to return nothing (as with the Hyphenate Last Word bug) it must fail.
import { DomPort, selfCheck } from '@flatter/indesign-adapter';
import { app, type Any } from './lib.ts';

const docsBefore = app.documents.length;
let out: unknown;
try {
  const healthy = selfCheck();
  const proto = DomPort.prototype as Any;
  const probe = proto.probe;
  proto.probe = function (words: string[]) {
    return new Map(words.map((w) => [w, []]));
  };
  let broken: Any;
  try {
    broken = selfCheck();
  } finally {
    proto.probe = probe;
  }
  const caught = broken.checks.filter((c: Any) => !c.ok).map((c: Any) => `${c.name}: ${c.detail}`);
  out = {
    pass: healthy.ok && !broken.ok && caught.some((c: string) => c.startsWith('Hyphenation points')) && app.documents.length === docsBefore,
    healthy: { ok: healthy.ok, ms: healthy.ms, indesign: healthy.indesign, failed: healthy.checks.filter((c) => !c.ok) },
    brokenProbing: caught,
    docsLeftOpen: app.documents.length - docsBefore,
  };
} catch (e) {
  out = { pass: false, error: String(e) };
}
app.insertLabel('flatter-result', JSON.stringify(out, null, 1));
