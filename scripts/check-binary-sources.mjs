#!/usr/bin/env node
// Binary-source ratchet - fails if any tracked SOURCE file contains a NUL byte.
// Sibling of the font/color/spacing/radius/zindex/typesize ratchets.
//
// WHY THIS EXISTS. Git classifies any file containing a 0x00 byte as BINARY.
// Its diffs then render as "Bin 13332 -> 13635 bytes", so every change to it is
// invisible in review - and the exemption is itself invisible, because the
// thing you would notice it in is the diff.
//
// Not hypothetical. On 2026-09-04 five source files were in that state, and a
// five-line change to one of them (adding build correlation to recordLlmUsage)
// went through a PR unreadable by anyone. All five had the same cause: a NUL
// used as a composite map-key separator, written as a raw byte:
//
//     const key = `${a}<0x00>${b}`;   // file becomes binary
//     const key = `${a}\u0000${b}`;   // identical string, file stays text
//
// The escape produces a byte-identical string, so this is purely about keeping
// source reviewable. NUL is a fine separator; spelling it as a raw byte is not.
//
// Keep the ceiling at 0.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const CEILING = 0;
const ROOTS = ['src', 'scripts', 'drizzle'];
const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.json', '.md', '.sql']);
// _salvaged/ is excluded from TypeScript and ESLint; exclude it here too.
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '_salvaged', 'dist', 'build']);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (EXTS.has(entry.slice(entry.lastIndexOf('.')))) out.push(full);
  }
  return out;
}

const offenders = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const buf = readFileSync(file);
    const index = buf.indexOf(0);
    if (index !== -1) {
      const line = buf.subarray(0, index).toString('utf8').split('\n').length;
      offenders.push(`${relative(process.cwd(), file).split(sep).join('/')}:${line}`);
    }
  }
}

if (offenders.length > CEILING) {
  console.error(`\ncheck:binary - ${offenders.length} source file(s) contain a NUL byte (ceiling ${CEILING}).`);
  console.error('Git treats these as BINARY, so their diffs are unreadable and');
  console.error('every change to them passes through review invisibly.\n');
  for (const o of offenders) console.error(`  ${o}`);
  console.error('\nFix: replace the raw NUL with the \\u0000 escape. The string is');
  console.error('byte-identical; only the source encoding changes.\n');
  process.exit(1);
}

console.log(`check:binary - 0 NUL-bearing source files (ceiling ${CEILING}). OK`);
