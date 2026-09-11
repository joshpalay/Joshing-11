#!/usr/bin/env node
// Design-canon conformance (B-FABLE-DESIGN-CANON-01, Phase 5) — per-rule
// violation counts for the structural rules in _docs/DESIGN-SYSTEM.md, each
// pinned to a recorded baseline so drift is a number, not a feeling.
//
// Sibling of the six check-*-ratchet.mjs scripts (same walker, same exemptions,
// same "lower it after a cleanup, never raise it" contract), but multi-rule and
// report-first:
//
//   node scripts/audit-design-conformance.mjs            report every rule
//   node scripts/audit-design-conformance.mjs --verbose  …plus every offender
//   node scripts/audit-design-conformance.mjs --check    exit 1 if ANY rule is
//                                                        above its baseline
//                                                        (this is `npm run check:design`)
//   node scripts/audit-design-conformance.mjs --rule R3  one rule only
//
// The eslint lane (DESIGN_LINT_RULES in eslint.config.mjs) sees string-literal
// classNames only; these line regexes also catch template strings and cn()
// calls, so counts here are ≥ the lint warnings for the same rule.
//
// Rules R9/R10 are heuristics over a <button …> block (the tag plus the next
// six lines). They are counted, not judged: a button whose className lives in
// a constant above it will show as "no focus ring" even when it has one. Use
// them as a trend line for the codemod, not as a per-site verdict.
//
// NOTE (dev breakage, same trap as check-radius-ratchet.mjs): never spell the
// radius token form as one contiguous rounded-[…] literal in a comment here —
// Tailwind v4 scans this file. Say `var(--radius-card)` on its own.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// ── Baselines ────────────────────────────────────────────────────────────────
// Recorded 2026-09-11 against the working tree at the Phase 5 build. Lower a
// number after a cleanup; never raise one. A rule at 0 is a rule that is
// enforced in full.
const BASELINE = {
  R1: 35, // Tailwind shadow utility (§2.1) — 8 of these are the bottom toasts on shadow-lg
  R2: 15, // .btn-* recipe overridden at the call site (§3) — 11 are `min-h-11`, moot once the recipe lands
  R3: 41, // card fill paired with a non-card radius (§1.2) — settings sections, daily panels, knowledge/[domain]
  R4: 31, // hand-rolled chip / pill (§4.1) — ~12 are selectable filter pills awaiting §4.3
  R5: 1, // <Chip> geometry override (§4.1)
  R6: 23, // hand-rolled round icon button, not .btn-icon (§3.4)
  R7: 11, // animate-pulse outside <Skeleton> (§7.1)
  R8: 34, // button or input rendered as a pill (§1.4) — overlaps R4's selectable pills
  R9: 333, // heuristic: <button> block with no focus-visible and not .btn-* (§9.2)
  R10: 321, // heuristic: <button> block with no ≥44px dimension and not .btn-* (§9.1)
};

// ── Exemptions (mirrors the ratchets; plus the canon's named surfaces) ───────
const EXEMPT = ['src/app/globals.css', 'src/app/dev/', 'src/app/feed/debug/'];
const isTest = (p) => /(\.test\.|__tests__\/)/.test(p);
const isExempt = (p) => EXEMPT.some((e) => p === e || p.startsWith(e)) || isTest(p);

// Per-rule file exemptions the canon grants by name (DESIGN-SYSTEM §11).
const RULE_EXEMPT = {
  R7: ['src/components/ui/Skeleton.tsx', 'src/components/knowledge/KnowledgeBubbleMap.tsx'],
  R1: ['src/components/ui/Skeleton.tsx'],
};

const ICON_SIZE = String.raw`\bsize-(?:9|10|11|12|14)\b`;
const BTN_OVERRIDE = String.raw`\b(?:min-h-\d+|h-\d+|rounded-\S+|text-(?:xs|sm|base|lg)|font-(?:medium|semibold|bold)|bg-\[)`;
// `(?![\w-])` so the token name `--btn-primary-bg` never reads as a .btn-primary site.
const BTN_CLASS = String.raw`\bbtn-(?:primary|ghost|danger)(?![\w-])`;

// Line rules: { id, section, title, test(line) → number of hits }.
const LINE_RULES = [
  {
    id: 'R1',
    section: '§2.1',
    title: 'Tailwind shadow utility (use var(--shadow-*))',
    // Lookbehind excludes `drop-shadow-lg` (a filter, not a box-shadow register).
    re: /(?<![\w-])shadow-(?:sm|md|lg|xl|2xl)\b/g,
  },
  {
    id: 'R2',
    section: '§3',
    title: '.btn-* recipe overridden at the call site',
    re: new RegExp(String.raw`${BTN_CLASS}[^"'\`}]*${BTN_OVERRIDE}|${BTN_OVERRIDE}[^"'\`}]*${BTN_CLASS}`, 'g'),
  },
  {
    id: 'R3',
    section: '§1.2',
    title: 'card fill paired with a non-card radius',
    re: /\brounded-(?:lg|xl|2xl|3xl)\b[^"'`}]*(?:\bbg-card\b|bg-\[var\(--brand-card\)\])|(?:\bbg-card\b|bg-\[var\(--brand-card\)\])[^"'`}]*\brounded-(?:lg|xl|2xl|3xl)\b/g,
    skipLine: (l) => /animate-pulse|<input|<textarea/.test(l), // skeletons are R7; inputs are §1.5
  },
  {
    id: 'R4',
    section: '§4.1',
    title: 'hand-rolled chip / pill (should be <Chip>)',
    re: /\brounded-full\b[^"'`}]*\b(?:px-2|px-2\.5|px-3)\b[^"'`}]*\b(?:text-xs|text-\[10px\]|text-sm)\b/g,
    skipLine: (l) => /<(?:button|input|Chip|Link|a)\b|btn-|aria-label|href=/.test(l),
  },
  {
    id: 'R5',
    section: '§4.1',
    title: '<Chip> geometry override (padding / size / radius)',
    re: /<Chip\b[^>]*className=["'{`][^"'`}]*\b(?:p[xy]-|text-(?:xs|sm|\[)|rounded-)/g,
  },
  {
    id: 'R6',
    section: '§3.4',
    title: 'hand-rolled round icon button (should be .btn-icon)',
    re: new RegExp(String.raw`${ICON_SIZE}[^"'\`}]*\brounded-full\b|\brounded-full\b[^"'\`}]*${ICON_SIZE}`, 'g'),
    skipLine: (l) => /btn-icon|<Skeleton|<span|<div|<img|Avatar/.test(l),
  },
  {
    id: 'R7',
    section: '§7.1',
    title: 'animate-pulse outside <Skeleton>',
    re: /\banimate-pulse\b/g,
  },
];

// Block rules: run over each `<button …>` opening block (tag + next 6 lines).
const BLOCK_RULES = [
  {
    id: 'R8',
    section: '§1.4',
    title: 'button or input rendered as a pill',
    tag: /<(?:button|input)\b/,
    test: (b) => /\brounded-full\b/.test(b) && !new RegExp(ICON_SIZE).test(b) && !/btn-icon/.test(b),
  },
  {
    id: 'R9',
    section: '§9.2',
    title: 'heuristic — <button> block with no focus-visible and not .btn-*',
    tag: /<button\b/,
    test: (b) => !/focus-visible|btn-(?:primary|ghost|danger|icon)/.test(b),
  },
  {
    id: 'R10',
    section: '§9.1',
    title: 'heuristic — <button> block with no ≥44px dimension and not .btn-*',
    tag: /<button\b/,
    test: (b) =>
      !/btn-(?:primary|ghost|danger|icon)|min-h-(?:11|12|14)\b|\bsize-(?:11|12|14)\b|\bh-(?:11|12|14)\b|min-h-\[4[4-9]px\]|absolute inset-0|\bpy-(?:3|4)\b/.test(
        b,
      ),
  },
];

function stripComments(line) {
  const t = line.trimStart();
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return '';
  return line.replace(/\/\/.*$/, '');
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.tsx$/.test(name)) yield full;
  }
}

const args = new Set(process.argv.slice(2));
const verbose = args.has('--verbose');
const check = args.has('--check');
const only = [...args].find((a) => a.startsWith('--rule='))?.slice(7);

const root = process.cwd();
const hits = Object.fromEntries([...LINE_RULES, ...BLOCK_RULES].map((r) => [r.id, []]));

for (const file of walk(join(root, 'src'))) {
  const rel = relative(root, file).replaceAll('\\', '/');
  if (isExempt(rel)) continue;
  const raw = readFileSync(file, 'utf8').split('\n');
  const lines = raw.map(stripComments);

  for (const rule of LINE_RULES) {
    if (RULE_EXEMPT[rule.id]?.includes(rel)) continue;
    lines.forEach((line, i) => {
      if (!line) return;
      if (rule.skipLine?.(line)) return;
      rule.re.lastIndex = 0;
      const n = line.match(rule.re)?.length ?? 0;
      if (n > 0) hits[rule.id].push({ loc: `${rel}:${i + 1}`, n, text: raw[i].trim().slice(0, 110) });
    });
  }

  for (const rule of BLOCK_RULES) {
    if (RULE_EXEMPT[rule.id]?.includes(rel)) continue;
    lines.forEach((line, i) => {
      if (!rule.tag.test(line)) return;
      const block = lines.slice(i, i + 7).join('\n');
      if (rule.test(block)) hits[rule.id].push({ loc: `${rel}:${i + 1}`, n: 1, text: raw[i].trim().slice(0, 110) });
    });
  }
}

const rules = [...LINE_RULES, ...BLOCK_RULES].filter((r) => !only || r.id === only);
let failed = false;
const pad = (s, n) => String(s).padEnd(n);

console.log(`design conformance — _docs/DESIGN-SYSTEM.md (src/**/*.tsx; tests, dev, debug exempt)\n`);
console.log(`${pad('rule', 5)}${pad('§', 7)}${pad('count', 7)}${pad('base', 7)}${pad('Δ', 6)}title`);
for (const r of rules) {
  const count = hits[r.id].reduce((s, h) => s + h.n, 0);
  const base = BASELINE[r.id];
  const delta = count - base;
  const mark = delta > 0 ? '✖' : delta < 0 ? '↓' : ' ';
  if (delta > 0) failed = true;
  console.log(
    `${pad(r.id, 5)}${pad(r.section, 7)}${pad(count, 7)}${pad(base, 7)}${pad(mark + (delta === 0 ? '' : delta > 0 ? `+${delta}` : delta), 6)}${r.title}`,
  );
  if (verbose && hits[r.id].length) {
    for (const h of hits[r.id].slice(0, 80)) console.log(`      ${h.loc}${h.n > 1 ? ` (×${h.n})` : ''}: ${h.text}`);
    if (hits[r.id].length > 80) console.log(`      … and ${hits[r.id].length - 80} more`);
  }
}

console.log('');
if (check && failed) {
  console.error(
    '✖ design conformance: a rule rose above its baseline. Fix the new site (see --verbose), or — after a deliberate canon change — record it in _docs/DESIGN-SYSTEM.md before touching BASELINE. Never raise a baseline to make CI pass.',
  );
  process.exit(1);
}
const below = rules.filter((r) => hits[r.id].reduce((s, h) => s + h.n, 0) < BASELINE[r.id]);
if (below.length) {
  console.log(`↓ ${below.map((r) => r.id).join(', ')} below baseline — lower BASELINE in scripts/audit-design-conformance.mjs to lock the gain in.`);
}
console.log(check ? '✓ design conformance: no rule above its baseline' : '(report only — add --check to enforce)');
