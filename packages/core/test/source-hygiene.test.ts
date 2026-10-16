/**
 * Guards against invisible characters in source files. Writing escapes such as
 * \u2028 through a shell can store the real character instead, which silently
 * breaks regular expressions and strings (this happened three times).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../..');
const DIRS = ['packages', 'tools'];
// Built from code points so this file can never contain the characters it looks for.
const FORBIDDEN = new RegExp('[' + [0x2028, 0x2029, 0x00ad, 0x00a0, 0x202f, 0x2007, 0x200b, 0xfeff, 0xfffc].map((c) => String.fromCharCode(c)).join('') + ']');

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'out' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sources(p);
    else if (/\.(ts|mjs|jsx|sh|html)$/.test(name)) yield p;
  }
}

describe('source hygiene', () => {
  it('has no literal invisible or special-space characters in source files (write them as \\u escapes)', () => {
    const offenders: string[] = [];
    for (const d of DIRS) {
      for (const file of sources(join(ROOT, d))) {
        const text = readFileSync(file, 'utf8');
        text.split('\n').forEach((line, i) => {
          const m = FORBIDDEN.exec(line);
          if (m) offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1} U+${m[0].codePointAt(0)!.toString(16).padStart(4, '0')}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
