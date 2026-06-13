#!/usr/bin/env node
// B-CATEGORY-AUTHORED-RECONCILE-01 — Phase 2 gate aggregator.
//
// The authored path shadow-logs one line per authored question (flag-off):
//   [questions/authored-reconcile] {"proposed":"Hamlet","reconciled":"…",…}
// (src/app/api/questions/route.ts). The payload is a JSON string by design, so
// this script can parse exported logs deterministically — no util.inspect
// guessing. It summarizes how bad the pre-fix duplication is so the Phase 2
// flag flip is a data-backed decision, not a guess.
//
// Usage:
//   vercel logs <deployment> | node scripts/authored-reconcile-telemetry.mjs
//   node scripts/authored-reconcile-telemetry.mjs path/to/exported-logs.txt
//   cat logs/*.ndjson | node scripts/authored-reconcile-telemetry.mjs --json
//
// Input is line-oriented text from ANY source. Each line is scanned for the
// marker; everything from the first '{' after it to the matching end is parsed
// as JSON. Lines that are themselves JSON log objects (Vercel log drains wrap
// the console output in a `message` field) are unwrapped first via --json or
// auto-detected. Non-matching lines are ignored.

import { readFileSync } from 'node:fs';

const MARKER = '[questions/authored-reconcile]';

const args = process.argv.slice(2);
const forceJson = args.includes('--json');
const topN = (() => {
  const i = args.indexOf('--top');
  const n = i >= 0 ? Number(args[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 15;
})();
const fileArg = args.find((a) => !a.startsWith('--') && a !== String(topN));

function readInput() {
  if (fileArg) return readFileSync(fileArg, 'utf8');
  try {
    return readFileSync(0, 'utf8'); // stdin
  } catch {
    return '';
  }
}

// Pull the JSON object that follows the marker out of one raw log line. Log
// drains often wrap the line as {"message":"[…] {…}"} — when the line parses as
// JSON with a string `message`, recurse into it. Brace-matching (not greedy to
// end-of-line) so trailing log decoration after the object is tolerated.
function extractPayload(line, allowUnwrap = true) {
  // A fully-JSON line is a log-drain record that wraps the console output in a
  // `message`/`text`/`log` field — unwrap it FIRST, before trying to brace-match
  // the (escaped) inner payload, which would otherwise fail to parse.
  if (allowUnwrap) {
    const trimmed = line.trim();
    if (trimmed.startsWith('{')) {
      try {
        const rec = JSON.parse(trimmed);
        const msg = typeof rec?.message === 'string' ? rec.message
          : typeof rec?.text === 'string' ? rec.text
            : typeof rec?.log === 'string' ? rec.log : null;
        if (msg) return extractPayload(msg, false);
      } catch {
        // Not a wrapper record — fall through to plain marker extraction.
      }
    }
  }
  const markerAt = line.indexOf(MARKER);
  if (markerAt < 0) return null;
  const braceAt = line.indexOf('{', markerAt);
  if (braceAt < 0) return null;
  // Scan to the matching close brace, respecting strings/escapes.
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = braceAt; i < line.length; i++) {
    const ch = line[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const slice = line.slice(braceAt, i + 1);
        try { return JSON.parse(slice); } catch { return null; }
      }
    }
  }
  return null;
}

function pct(n, d) {
  if (!d) return '0.0%';
  return `${((n / d) * 100).toFixed(1)}%`;
}

function topEntries(map, n) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

const input = readInput();
const lines = input.split(/\r?\n/);

let total = 0;
let differs = 0;
let applied = 0;
let tooGeneric = 0;
const byMethod = new Map();        // method -> count
const foldPairs = new Map();       // "proposed → reconciled" -> count (only when differs)
const fuzzyNearMiss = new Map();   // similarity band -> count (fuzzy candidates on a non-fold)
let withFuzzy = 0;
let malformed = 0;

for (const line of lines) {
  if (!line.includes(MARKER) && !forceJson && !line.trim().startsWith('{')) continue;
  const p = extractPayload(line);
  if (!p) {
    if (line.includes(MARKER)) malformed++;
    continue;
  }
  total++;
  byMethod.set(p.method ?? 'unknown', (byMethod.get(p.method ?? 'unknown') ?? 0) + 1);
  if (p.differs) {
    differs++;
    foldPairs.set(`${p.proposed} → ${p.reconciled}`, (foldPairs.get(`${p.proposed} → ${p.reconciled}`) ?? 0) + 1);
  }
  if (p.applied) applied++;
  if (p.reconciledTooGeneric) tooGeneric++;
  if (Array.isArray(p.trgmFuzzy) && p.trgmFuzzy.length > 0) {
    withFuzzy++;
    if (!p.differs) {
      // Near-misses we deliberately did NOT auto-fold — useful for threshold tuning.
      const best = Math.max(...p.trgmFuzzy.map((c) => Number(c.similarity) || 0));
      const band = best >= 0.8 ? '≥0.80' : best >= 0.7 ? '0.70–0.79' : best >= 0.6 ? '0.60–0.69' : '<0.60';
      fuzzyNearMiss.set(band, (fuzzyNearMiss.get(band) ?? 0) + 1);
    }
  }
}

if (total === 0) {
  console.error(`No "${MARKER}" records found in input.`);
  console.error('Pipe Vercel/exported logs in, or pass a log file path. Try --json for log-drain NDJSON.');
  process.exit(1);
}

const out = [];
out.push(`\n${MARKER} — Phase 2 gate summary`);
out.push('='.repeat(52));
out.push(`authored questions logged : ${total}`);
out.push(`would fold (differs=true) : ${differs}  (${pct(differs, total)})   ← duplication being closed`);
out.push(`actually applied          : ${applied}  (${pct(applied, total)})   ← nonzero only once the flag is ON`);
out.push(`reconciled-too-generic    : ${tooGeneric}  (guard fall-through; expect ~0)`);
if (malformed > 0) out.push(`malformed marker lines    : ${malformed}  (skipped)`);

out.push('\nmethod histogram');
out.push('-'.repeat(52));
for (const [method, count] of topEntries(byMethod, 10)) {
  out.push(`  ${method.padEnd(12)} ${String(count).padStart(6)}  ${pct(count, total)}`);
}

out.push(`\ntop folds (proposed → reconciled), n=${topN}`);
out.push('-'.repeat(52));
if (foldPairs.size === 0) {
  out.push('  (none — no folds observed)');
} else {
  for (const [pair, count] of topEntries(foldPairs, topN)) {
    out.push(`  ${String(count).padStart(4)} × ${pair}`);
  }
}

if (fuzzyNearMiss.size > 0) {
  out.push('\ntrgm fuzzy near-misses on non-folds (threshold-tuning signal)');
  out.push('-'.repeat(52));
  for (const band of ['≥0.80', '0.70–0.79', '0.60–0.69', '<0.60']) {
    if (fuzzyNearMiss.has(band)) out.push(`  ${band.padEnd(12)} ${String(fuzzyNearMiss.get(band)).padStart(6)}`);
  }
  out.push(`  (${withFuzzy} records carried fuzzy candidates total)`);
}

out.push('');
console.log(out.join('\n'));
