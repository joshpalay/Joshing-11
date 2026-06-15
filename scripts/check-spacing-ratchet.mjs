#!/usr/bin/env node
// Spacing ratchet (CONS-5) — fails if arbitrary spacing usage in src/ rises
// above the recorded ceiling. The color/font twins are scripts/check-color-
// ratchet.mjs and scripts/check-font-ratchet.mjs; this is the spacing sibling
// and is deliberately independent.
//
// "Off-system" spacing means a padding / margin / gap / space-between value
// written as a Tailwind arbitrary (e.g. `gap-[18px]`, `px-[0.95rem]`,
// `space-y-[14px]`) instead of a scale step (`gap-4`, `px-4`, `space-y-3.5`).
// Tailwind's spacing scale IS the system; arbitraries are the drift.
//
// SCOPE NOTE — sizing (h-/w-/min-/max-/size-) is intentionally NOT counted.
// Arbitrary widths/heights (`w-[min(540px,100%)]`, `h-[90vh]`, `size-[34px]`)
// are frequently legitimate (viewport units, content-specific dims) with no
// "right" scale step, so ratcheting them would create friction without a clear
// target. This ratchet covers the box-model spacing properties only.
//
// To LOWER the ceiling after a cleanup: run the script, take the count, update
// CEILING. To raise it: don't — use a scale step (or, if a value is genuinely
// off-scale, make it a deliberate design decision rather than a new arbitrary).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// ── The ceiling ──────────────────────────────────────────────────────────────
// Baseline recorded 2026-06-15 (CONS-5). Freezes arbitrary spacing at today's
// count so no new drift can land; burn down by snapping arbitraries to scale
// steps (start with the ones already equal to a step — 14px→3.5, 6px→1.5,
// 10px→2.5 — which move zero pixels) and lowering this number.
const CEILING = 44;

// ── Exemptions (mirrors the color/font ratchets; keep this list short) ───────
const EXEMPT = [
  // Token definitions / global styles — not className arbitraries.
  'src/app/globals.css',
  // Internal tooling, never shipped to users (same decision as the other
  // ratchets' dev/debug exemptions).
  'src/app/dev/',
  'src/app/feed/debug/',
];

const isTest = (p) => /(\.test\.|__tests__\/)/.test(p);
const isExempt = (p) => EXEMPT.some((e) => p === e || p.startsWith(e)) || isTest(p);

// Arbitrary spacing utilities: optional negative, a spacing prefix, then `-[…]`.
// Prefixes: p/px/py/pt/pb/pl/pr/ps/pe, m/mx/my/mt/mb/ml/mr/ms/me,
// gap / gap-x / gap-y, space-x / space-y. The negative lookbehind keeps us from
// matching inside a longer token (e.g. `top-[`, `min-w-[`, `leading-[`).
const SPACING =
  /(?<![\w-])-?(?:p[xytblrse]?|m[xytblrse]?|gap(?:-[xy])?|space-[xy])-\[[^\]]+\]/g;

function stripComments(line) {
  const t = line.trimStart();
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return '';
  return line.replace(/\/\/.*$/, '');
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(tsx?|jsx?)$/.test(name)) yield full;
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
    SPACING.lastIndex = 0;
    const n = line.match(SPACING)?.length ?? 0;
    if (n > 0) offenders.push({ loc: `${rel}:${i + 1}`, n, text: raw.trim().slice(0, 100) });
  });
}

const count = offenders.reduce((sum, o) => sum + o.n, 0);
if (count > CEILING) {
  console.error(`✖ spacing ratchet: ${count} arbitrary spacing occurrence(s) in src/ (ceiling: ${CEILING})\n`);
  for (const o of offenders.slice(0, 60)) console.error(`  ${o.loc} (${o.n}): ${o.text}`);
  if (offenders.length > 60) console.error(`  … and ${offenders.length - 60} more lines`);
  console.error(
    '\nUse Tailwind spacing-scale steps (p-4 / gap-5 / space-y-3.5) instead of arbitrary' +
      ' p-[…]/m-[…]/gap-[…]/space-[…]. Do not raise the ceiling.',
  );
  process.exit(1);
}
console.log(`✓ spacing ratchet: ${count} arbitrary spacing occurrence(s) (ceiling: ${CEILING})`);
