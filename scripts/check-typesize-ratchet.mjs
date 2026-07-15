#!/usr/bin/env node
// Type-size ratchet — fails if raw font-size arbitraries in src/ rise above
// the recorded ceiling. Sibling of the font/color/spacing/radius/zindex
// ratchets; independent by design.
//
// "Off-system" means a Tailwind arbitrary font size (text-[13px], text-[0.88rem]).
// The named scale (text-xs/sm/base/... and text-quiet, the ratified 13px
// register — see _docs/STYLE-GUIDE-TYPE.md §3) never matches — it's the point.
// Inline `fontSize:` styles are NOT counted: they are dominated by SVG/canvas/
// share-raster contexts where arbitrary sizing is legitimate (see the 2026-07-15
// audit); revisit if GameplayChat/ceremony get cleaned up.
//
// To LOWER the ceiling after a cleanup: run the script, take the count, update
// CEILING. To raise it: don't — use the named scale, or ratify a new register
// in STYLE-GUIDE-TYPE.md first.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// ── The ceiling ──────────────────────────────────────────────────────────────
// Baseline recorded 2026-07-15 after the text-[13px] → text-quiet sweep (104
// occurrences retired). The remainder is the long tail of px sizes that have
// not earned a named register (9/10/11/15px) plus the rem-form arbitraries
// (text-[0.6rem]/[0.7rem]/… System-label sizes, mostly admin + catchup) that
// the sweep deliberately left in place.
const CEILING = 213;

// ── Exemptions (mirrors the color ratchet; keep this list short) ────────────
const EXEMPT = [
  // Token definitions + doc comments live here.
  'src/app/globals.css',
  // html2canvas raster path: literal values are load-bearing.
  'src/components/knowledge/SharePortraitCard.tsx',
  // Internal tooling, never shipped to users.
  'src/app/dev/',
  'src/app/feed/debug/',
  'src/components/dev/',
];

const isTest = (p) => /(\.test\.|__tests__\/)/.test(p);
const isExempt = (p) => EXEMPT.some((e) => p === e || p.startsWith(e)) || isTest(p);

const TW_TEXT_SIZE = /\btext-\[\d+(?:\.\d+)?(?:px|rem)\]/g;

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
    const n = line.match(TW_TEXT_SIZE)?.length ?? 0;
    if (n > 0) offenders.push({ loc: `${rel}:${i + 1}`, n, text: raw.trim().slice(0, 100) });
  });
}

const count = offenders.reduce((sum, o) => sum + o.n, 0);
if (count > CEILING) {
  console.error(`✖ type-size ratchet: ${count} arbitrary font-size occurrence(s) in src/ (ceiling: ${CEILING})\n`);
  for (const o of offenders.slice(0, 60)) console.error(`  ${o.loc} (${o.n}): ${o.text}`);
  if (offenders.length > 60) console.error(`  … and ${offenders.length - 60} more lines`);
  console.error(
    '\nUse the named scale (text-xs/sm/... or text-quiet for the 13px register);' +
      ' see _docs/STYLE-GUIDE-TYPE.md §3. Do not raise the ceiling.',
  );
  process.exit(1);
}
console.log(`✓ type-size ratchet: ${count} arbitrary font-size occurrence(s) (ceiling: ${CEILING})`);
