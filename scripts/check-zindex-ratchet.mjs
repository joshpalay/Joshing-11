#!/usr/bin/env node
// Z-index ratchet — fails if raw stacking-layer literals in src/ rise above
// the recorded ceiling. Sibling of the font/color/spacing/radius ratchets;
// independent by design.
//
// "Off-system" means an above-the-page layer declared as a raw number instead
// of the --z-* scale in src/app/globals.css (nav 40 < sheet 50 < modal 60 <
// toast 70 < takeover 80). Two patterns count:
//   A. Tailwind arbitrary numeric z (e.g. z-[55], z-[100])
//   B. inline zIndex with a numeric literal >= 30 (below 30 is local,
//      within-component stacking — decorative layers, not the overlay bands)
// var(--z-*) consumers never match — they're the point. Standard Tailwind
// utilities (z-10..z-50) are not counted: they're on Tailwind's own scale and
// the overlay surfaces have all been swept onto the tokens; new overlay work
// should use the z arbitrary form with a var(--z-*) value. (Spelled apart
// here because Tailwind v4 scans comments and a * inside a var() arbitrary
// compiles into invalid CSS.)
//
// To LOWER the ceiling after a cleanup: run the script, take the count, update
// CEILING. To raise it: don't — use the --z-* scale instead.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// ── The ceiling ──────────────────────────────────────────────────────────────
// Baseline recorded 2026-07-15 after the z-scale sweep: every sheet/modal/
// toast/takeover surface routes through var(--z-*). Keep this at 0.
const CEILING = 0;

// ── Exemptions (mirrors the color ratchet; keep this list short) ────────────
const EXEMPT = [
  // Internal tooling, never shipped to users.
  'src/app/dev/',
  'src/app/feed/debug/',
  'src/components/dev/',
];

const isTest = (p) => /(\.test\.|__tests__\/)/.test(p);
const isExempt = (p) => EXEMPT.some((e) => p === e || p.startsWith(e)) || isTest(p);

const TW_Z = /\bz-\[\d+\]/g;
const INLINE_Z = /\bzIndex:\s*(\d+)/g;
const INLINE_Z_MIN = 30;

function stripComments(line) {
  const t = line.trimStart();
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return '';
  return line.replace(/\/\/.*$/, '');
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(tsx?|jsx?|css)$/.test(name)) yield full;
  }
}

const root = process.cwd();
const offenders = [];

for (const file of walk(join(root, 'src'))) {
  const rel = relative(root, file).replaceAll('\\', '/');
  if (isExempt(rel)) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((raw, i) => {
    const line = stripComments(raw);
    if (!line) return;
    let n = line.match(TW_Z)?.length ?? 0;
    INLINE_Z.lastIndex = 0;
    for (let m; (m = INLINE_Z.exec(line)); ) {
      if (Number(m[1]) >= INLINE_Z_MIN) n++;
    }
    if (n > 0) offenders.push({ loc: `${rel}:${i + 1}`, n, text: raw.trim().slice(0, 100) });
  });
}

const count = offenders.reduce((sum, o) => sum + o.n, 0);
if (count > CEILING) {
  console.error(`✖ z-index ratchet: ${count} raw stacking-layer literal(s) in src/ (ceiling: ${CEILING})\n`);
  for (const o of offenders.slice(0, 60)) console.error(`  ${o.loc} (${o.n}): ${o.text}`);
  if (offenders.length > 60) console.error(`  … and ${offenders.length - 60} more lines`);
  console.error(
    '\nRoute overlay layers through the --z-* scale in globals.css' +
      ' (z-[var(--z-sheet|modal|toast|takeover)] / zIndex: "var(--z-*)"). Do not raise the ceiling.',
  );
  process.exit(1);
}
console.log(`✓ z-index ratchet: ${count} raw stacking-layer literal(s) (ceiling: ${CEILING})`);
