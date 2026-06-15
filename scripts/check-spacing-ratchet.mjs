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
// 10px→2.5 — which move zero pixels) and lowering this number. Burned down to
// 0 on 2026-06-15: all box-model spacing now uses the scale (env() safe-area
// insets are exempt; h-/w- sizing is out of scope). Stay at 0 — use a scale
// step.
const CEILING = 0;

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

// Exact px for each standard Tailwind spacing step (--spacing 0.25rem × step).
// A value matching one of these is an on-scale equivalent that can be snapped
// with zero pixels moved (the rest are off-scale → a design call).
const STEP_PX = {
  2: '0.5', 4: '1', 6: '1.5', 8: '2', 10: '2.5', 12: '3', 14: '3.5', 16: '4',
  20: '5', 24: '6', 28: '7', 32: '8', 36: '9', 40: '10', 44: '11', 48: '12',
  56: '14', 64: '16',
};
function scaleHint(value) {
  const px = value.endsWith('px') ? parseFloat(value)
    : value.endsWith('rem') ? parseFloat(value) * 16
    : NaN;
  if (Number.isNaN(px)) return 'off-scale';
  return STEP_PX[px] ? `snap → ${STEP_PX[px]}` : 'off-scale';
}

const root = process.cwd();
const LIST = process.argv.includes('--list');
const offenders = [];          // per-line, for the over-ceiling dump
const byToken = new Map();     // token -> { count, value }, for --list

for (const file of walk(join(root, 'src'))) {
  const rel = relative(root, file).replaceAll('\\', '/');
  if (isExempt(rel)) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((raw, i) => {
    const line = stripComments(raw);
    if (!line) return;
    SPACING.lastIndex = 0;
    let n = 0;
    for (const m of line.matchAll(SPACING)) {
      const token = m[0];
      // env() values (iOS safe-area insets, e.g. pb-[max(1rem,env(safe-area-
      // inset-bottom))]) are legitimate — there is no scale step for a notch
      // inset — so they are not drift and don't count.
      if (token.includes('env(')) continue;
      n += 1;
      const value = token.slice(token.indexOf('[') + 1, -1);
      const entry = byToken.get(token) ?? { count: 0, value };
      entry.count += 1;
      byToken.set(token, entry);
    }
    if (n > 0) offenders.push({ loc: `${rel}:${i + 1}`, n, text: raw.trim().slice(0, 100) });
  });
}

const count = offenders.reduce((sum, o) => sum + o.n, 0);

// `--list`: print every current arbitrary grouped by value with a snap/off-scale
// hint, so a burn-down pass can be reviewed at a glance. Exits 0 (report only).
if (LIST) {
  const rows = [...byToken.entries()].sort((a, b) => b[1].count - a[1].count);
  console.log(`spacing ratchet — ${count} arbitrary occurrence(s), ${rows.length} distinct value(s):\n`);
  for (const [token, { count: c, value }] of rows) {
    console.log(`  ${String(c).padStart(3)}  ${token.padEnd(30)} ${scaleHint(value)}`);
  }
  console.log('\n"snap → N" = exact scale equivalent (zero pixels move). "off-scale" = design call.');
  process.exit(0);
}

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
