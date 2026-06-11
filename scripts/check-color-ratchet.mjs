#!/usr/bin/env node
// Color ratchet (B-VISUAL-STYLE-GUIDE-COLOR-01, fix-list step 6) — fails if
// off-system color usage in src/ rises above the recorded ceiling. The
// font-only twin is scripts/check-font-ratchet.mjs; the two are deliberately
// independent (STYLE-GUIDE-COLOR pairs with STYLE-GUIDE-TYPE).
//
// "Off-system" means a color declared outside the tokens in
// src/app/globals.css. Three patterns count:
//   A. hardcoded hex colors (#abc / #aabbcc / #aabbccdd) in code
//   B. raw rgb()/rgba()/hsl()/hsla() calls
//   C. Tailwind arbitrary raw-color values (e.g. bg-[#fff], text-[#1a1208]/70)
// Heuristic: line comments (// …) and block-comment continuation lines (* …)
// are stripped first, so hexes in prose don't count. var(--…) consumers never
// match any pattern — they're the point.
//
// To LOWER the ceiling after a cleanup: run the script, take the count, update
// CEILING. To raise it: don't — route the color through a token instead
// (see _docs/STYLE-GUIDE-COLOR.md; brand/category/gold tokens in globals.css).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// ── The ceiling ──────────────────────────────────────────────────────────────
// Baseline recorded 2026-06-11 after the color fix-list steps 1–5 (grading
// consolidation, neutrals reconciliation, category --cat-* scale + feed/
// expanding routing, gold collapse, triangle decision) — down from the
// audit's ~312. The remainder is dominated by: the ceremony gradient palette
// (open PRs touch it), the LoadingScreen/visual.ts mirrors of brand values,
// warm shadow/scrim rgba() tuples, and SVG art fills.
const CEILING = 180;

// ── Exemptions (mirrors the font ratchet; keep this list short) ─────────────
const EXEMPT = [
  // Token definitions live here — the one place raw colors are correct.
  'src/app/globals.css',
  // html2canvas raster path: literal values are load-bearing (documented
  // "intentionally literal — do NOT tokenize" at the top of the file).
  'src/components/knowledge/SharePortraitCard.tsx',
  // Email HTML cannot use CSS custom properties (no :root in mail clients).
  'src/server/email/templates/',
  // Internal tooling, never shipped to users (same decision as the font
  // ratchet's checkpoint).
  'src/app/dev/',
  'src/app/feed/debug/',
];

const isTest = (p) => /(\.test\.|__tests__\/)/.test(p);
const isExempt = (p) => EXEMPT.some((e) => p === e || p.startsWith(e)) || isTest(p);

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const RGB_HSL = /\b(?:rgba?|hsla?)\(/g;
const TW_RAW_COLOR =
  /(?:bg|text|border|ring|shadow|fill|stroke|from|via|to|decoration|outline|accent|caret)-\[#[0-9a-fA-F]{3,8}/g;

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
    let n = 0;
    for (const re of [HEX, RGB_HSL, TW_RAW_COLOR]) {
      re.lastIndex = 0;
      // TW arbitraries also match the bare-hex pattern; count the max of the
      // pattern hits on the line rather than summing overlaps.
      const hits = line.match(re)?.length ?? 0;
      if (re === TW_RAW_COLOR) n = Math.max(n - hits, 0) + hits;
      else n += hits;
    }
    if (n > 0) offenders.push({ loc: `${rel}:${i + 1}`, n, text: raw.trim().slice(0, 100) });
  });
}

const count = offenders.reduce((sum, o) => sum + o.n, 0);
if (count > CEILING) {
  console.error(`✖ color ratchet: ${count} off-system color occurrence(s) in src/ (ceiling: ${CEILING})\n`);
  for (const o of offenders.slice(0, 60)) console.error(`  ${o.loc} (${o.n}): ${o.text}`);
  if (offenders.length > 60) console.error(`  … and ${offenders.length - 60} more lines`);
  console.error(
    '\nRoute colors through the tokens in globals.css (--brand-* / --cat-* / --accent-gold / --game-*);' +
      ' see _docs/STYLE-GUIDE-COLOR.md. Do not raise the ceiling.',
  );
  process.exit(1);
}
console.log(`✓ color ratchet: ${count} off-system color occurrence(s) (ceiling: ${CEILING})`);
