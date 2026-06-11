#!/usr/bin/env node
// Font ratchet (B-VISUAL-STYLE-GUIDE-TYPE-01, Phase 4) — fails if off-system
// font usage in src/ rises above the recorded ceiling.
//
// "Off-system" means a font declared outside the voice tokens defined in
// src/app/globals.css (--font-serif / --font-mono / --font-sans / --font-neutral
// / --font-display / the next-font load vars). Three patterns count:
//   A. font-family / fontFamily declarations whose value is not var(--font-…)
//      (or `inherit`)
//   B. Tailwind arbitrary font values: font-[…] not wrapping var(--font-…)
//      (or inherit)
//   C. string constants that define a literal font stack by face name
//      (e.g. const FM = '"Courier New", monospace')
//
// Color is deliberately NOT counted here — the color half of the style guide
// gets its own ratchet (see _docs/STYLE-GUIDE-TYPE.md, "Part 2"), and the two
// must stay independently enforceable.
//
// To LOWER the ceiling after a cleanup: run the script, take the reported
// count, update CEILING. To raise it: don't — route the new use through a
// voice token instead (see _docs/STYLE-GUIDE-TYPE.md §6).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// ── The ceiling ──────────────────────────────────────────────────────────────
// Set 2026-06-11, after the Phase 1–3 token routing. Product code is fully on
// the voice tokens, so the ceiling is 0: any new raw font-family literal in a
// shipped surface fails this check.
const CEILING = 0;

// ── Exemptions (each documented; keep this list short) ──────────────────────
const EXEMPT = [
  // Token definitions live here — the one place raw stacks are correct.
  'src/app/globals.css',
  // html2canvas raster path: literal font names are load-bearing (the hashed
  // next-font vars aren't reliably available to the detached canvas render).
  // Documented at the top of the file: "intentionally literal — do NOT tokenize".
  'src/components/knowledge/SharePortraitCard.tsx',
  // Email HTML cannot use CSS custom properties (no :root in mail clients);
  // inline literal stacks are the only option there.
  'src/server/email/templates/',
  // Internal tooling, never shipped to users: deliberately unstyled
  // monospace/system-ui diagnostics. Exempt so the product ceiling stays at 0.
  'src/app/dev/',
  'src/app/feed/debug/',
];

const isTest = (p) => /(\.test\.|__tests__\/)/.test(p);
const isExempt = (p) => EXEMPT.some((e) => p === e || p.startsWith(e)) || isTest(p);

// A. raw font-family / fontFamily declarations (TS/TSX inline styles, CSS)
const DECL_TS = /fontFamily\s*[:=]\s*\{?\s*['"`](?!var\(--font-|inherit\b)/g;
const DECL_CSS = /font-family\s*:\s*(?!var\(--font-|inherit\b)/g;
// B. Tailwind arbitrary font value
const TW_ARBITRARY = /font-\[(?!var\(--font-|inherit\])/g;
// C. literal font-stack string constants, recognized by face name + generic
//    family. Strings that LEAD with a token (e.g. 'var(--font-serif), Georgia,
//    serif') are on-system — the face names there are only fallbacks.
const STACK_CONST =
  /(['"`])(?!var\(--font-)(?:(?!\1)[^\n])*?(?:Courier New|Georgia|Times New Roman|Caveat|Playfair Display|Helvetica|Arial|Inter)(?:(?!\1)[^\n])*?(?:serif|monospace|cursive|sans)(?:(?!\1)[^\n])*?\1/g;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(tsx?|jsx?|css)$/.test(name)) yield full;
  }
}

const root = process.cwd();
// One offense per offending line (a line matching several patterns is still
// one declaration to fix), keyed file:line.
const offenders = new Set();

for (const file of walk(join(root, 'src'))) {
  const rel = relative(root, file).replaceAll('\\', '/');
  if (isExempt(rel)) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const patterns = rel.endsWith('.css') ? [DECL_CSS, TW_ARBITRARY] : [DECL_TS, TW_ARBITRARY, STACK_CONST];
    for (const re of patterns) {
      re.lastIndex = 0;
      if (re.test(line)) {
        offenders.add(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
      }
    }
  });
}

const count = offenders.size;
if (count > CEILING) {
  console.error(`✖ font ratchet: ${count} off-system font declaration(s) in src/ (ceiling: ${CEILING})\n`);
  for (const o of offenders) console.error(`  ${o}`);
  console.error(
    '\nRoute fonts through the voice tokens (--font-serif / --font-mono / --font-sans);' +
      ' see _docs/STYLE-GUIDE-TYPE.md §6. Do not raise the ceiling.',
  );
  process.exit(1);
}
console.log(`✓ font ratchet: ${count} off-system font declaration(s) (ceiling: ${CEILING})`);
