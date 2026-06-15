#!/usr/bin/env node
// Radius ratchet (CONS-6) — fails if arbitrary corner-radius usage in src/
// rises above the recorded ceiling. The color/font/spacing siblings are
// scripts/check-{color,font,spacing}-ratchet.mjs; this is the radii one and is
// deliberately independent.
//
// "Off-system" radius means a literal Tailwind arbitrary (e.g. `rounded-[4px]`,
// `rounded-[2rem]`) instead of a scale step (`rounded-md`) or the radius tokens
// (`rounded-[var(--radius-md)]`). The Tailwind `rounded-*` scale + the
// `--radius-*` tokens in globals.css ARE the system; literal arbitraries are the
// drift. `rounded-[var(--…)]` consumers never match — they're the point.
//
// To LOWER the ceiling after a cleanup: run the script, take the count, update
// CEILING. To raise it: don't — use `rounded-md`/`rounded-lg` or
// `rounded-[var(--radius-*)]`. A genuinely new radius value is a deliberate
// token decision in globals.css, not a new literal arbitrary.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// ── The ceiling ──────────────────────────────────────────────────────────────
// Baseline recorded 2026-06-15 (CONS-6). Freezes literal arbitrary radii at
// today's count. Burn down by routing them through the scale/tokens
// (`rounded-md`, `rounded-[var(--radius-*)]`) and lowering this number. Note the
// pervasive `rounded-[4px]` is the button/card corner — a candidate for a
// `--radius-xs` token (added 2026-06-15) — burn-down 1 snapped the nine
// `rounded-[4px]` to `rounded-[var(--radius-xs)]`, lowering this 25 → 16.
const CEILING = 16;

// ── Exemptions (mirrors the color/font/spacing ratchets) ────────────────────
const EXEMPT = [
  'src/app/globals.css',
  'src/app/dev/',
  'src/app/feed/debug/',
];

const isTest = (p) => /(\.test\.|__tests__\/)/.test(p);
const isExempt = (p) => EXEMPT.some((e) => p === e || p.startsWith(e)) || isTest(p);

// Literal arbitrary radius utilities: `rounded`, an optional corner suffix
// (-t/-b/-l/-r/-tl/-tr/-bl/-br/-s/-e/-ss/…), then `-[<literal>]`. The
// `(?!var\()` lookahead skips token consumers (`rounded-[var(--radius-md)]`),
// which are on-system. The lookbehind avoids matching inside a longer token.
const RADIUS = /(?<![\w-])rounded(?:-[tlbrse]{1,2})?-\[(?!var\()[^\]]+\]/g;

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
    RADIUS.lastIndex = 0;
    const n = line.match(RADIUS)?.length ?? 0;
    if (n > 0) offenders.push({ loc: `${rel}:${i + 1}`, n, text: raw.trim().slice(0, 100) });
  });
}

const count = offenders.reduce((sum, o) => sum + o.n, 0);
if (count > CEILING) {
  console.error(`✖ radius ratchet: ${count} arbitrary radius occurrence(s) in src/ (ceiling: ${CEILING})\n`);
  for (const o of offenders.slice(0, 60)) console.error(`  ${o.loc} (${o.n}): ${o.text}`);
  if (offenders.length > 60) console.error(`  … and ${offenders.length - 60} more lines`);
  console.error(
    '\nUse the rounded-* scale or the radius tokens (rounded-md / rounded-[var(--radius-*)])' +
      ' instead of literal rounded-[Npx]/[Nrem]. Do not raise the ceiling.',
  );
  process.exit(1);
}
console.log(`✓ radius ratchet: ${count} arbitrary radius occurrence(s) (ceiling: ${CEILING})`);
