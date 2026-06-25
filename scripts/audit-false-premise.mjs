/**
 * One-off audit: does a stronger model on the question gate catch internal-
 * consistency / false-premise defects that the current Haiku-tier gate misses?
 *
 * Read-only: SELECTs recent GeneratedQuestion rows, runs a focused
 * false-premise critique at three Anthropic tiers (Haiku = current gate, Sonnet,
 * Opus = frontier ceiling), and diffs what each flags. No writes; ~small token
 * spend. Run from repo root:
 *   node --env-file=.env --env-file=.env.local scripts/audit-false-premise.mjs
 * Optional: SAMPLE=40 node ... (default 25)
 */
import pg from 'pg';
import Anthropic from '@anthropic-ai/sdk';

const SAMPLE = Number(process.env.SAMPLE || 25);
const DB_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;
const KEY = process.env.ANTHROPIC_API_KEY;

if (!DB_URL) { console.error('No DIRECT_URL/DATABASE_URL'); process.exit(1); }
if (!KEY) { console.error('No ANTHROPIC_API_KEY'); process.exit(1); }

const anthropic = new Anthropic({ apiKey: KEY });

const TIERS = [
  { label: 'Haiku  (current gate)', model: 'claude-haiku-4-5-20251001', temp: true },
  { label: 'Sonnet (mid)',          model: 'claude-sonnet-4-6',          temp: true },
  // Opus 4.8 removed sampling params — sending temperature 400s, so omit it.
  { label: 'Opus   (frontier)',     model: 'claude-opus-4-8',            temp: false },
];

const SYSTEM = `You are a strict reviewer judging ONLY the internal consistency and factual premise of a trivia QUESTION, given its intended answer.

Mark a question INCONSISTENT if its setup asserts a relationship, cause, or premise that is false or does not actually lead to the stated answer — EVEN IF the answer is independently correct. The classic failure: the answer is right, but the question's framing ("X, whose Y underpins Z, becomes what?") embeds a claim that isn't true.

Do NOT nitpick wording, difficulty, or style. Only flag genuine internal-consistency / false-premise problems.

Return JSON only: {"consistent": true|false, "severity": "none"|"minor"|"major", "issue": "<one sentence, or null>"}`;

function userMsg(q) {
  return `<question>${q.question_text}</question>
<intended_answer>${q.answer}</intended_answer>
<explainer>${q.explainer ?? ''}</explainer>
Judge internal consistency. Return JSON only.`;
}

function parseJson(text) {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch { return null; }
}

async function judge(tier, q) {
  try {
    const params = {
      model: tier.model, max_tokens: 400,
      system: SYSTEM,
      messages: [{ role: 'user', content: userMsg(q) }],
    };
    if (tier.temp) params.temperature = 0;
    const r = await anthropic.messages.create(params, { signal: AbortSignal.timeout(60000) });
    const text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const j = parseJson(text);
    if (!j || typeof j.consistent !== 'boolean') return { error: 'parse' };
    return { consistent: j.consistent, severity: j.severity ?? 'none', issue: j.issue ?? null };
  } catch (e) {
    return { error: (e?.message || e?.name || 'err').slice(0, 100) };
  }
}

async function main() {
  const pool = new pg.Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false }, max: 3 });

  // Recent generated questions + force-include any Ganondorf/TotK rows (the known offender).
  const recent = await pool.query(
    `SELECT question_text, answer, explainer, generated_by_provider, created_at
       FROM "GeneratedQuestion"
      ORDER BY created_at DESC
      LIMIT $1`, [SAMPLE]);
  const known = await pool.query(
    `SELECT question_text, answer, explainer, generated_by_provider, created_at
       FROM "GeneratedQuestion"
      WHERE question_text ILIKE '%Ganondorf%' OR question_text ILIKE '%Tears of the Kingdom%'
      ORDER BY created_at DESC LIMIT 5`);
  await pool.end();

  const seen = new Set();
  const rows = [...known.rows, ...recent.rows].filter((q) => {
    const k = q.question_text.slice(0, 80);
    if (seen.has(k)) return false; seen.add(k); return true;
  });

  console.log(`\nAuditing ${rows.length} questions × ${TIERS.length} tiers (${known.rows.length} known-offender row(s) force-included)\n`);

  const knownKeys = new Set(known.rows.map((q) => q.question_text.slice(0, 80)));
  const tally = TIERS.map(() => ({ flagged: 0, major: 0, errors: 0 }));
  const caughtByStronger = []; // Haiku says consistent, Sonnet OR Opus says inconsistent
  const knownVerdicts = [];     // all verdicts for the force-included TotK/Ganondorf rows

  let i = 0;
  for (const q of rows) {
    i++;
    const verdicts = await Promise.all(TIERS.map((t) => judge(t, q)));
    if (knownKeys.has(q.question_text.slice(0, 80))) knownVerdicts.push({ q, verdicts });
    verdicts.forEach((v, idx) => {
      if (v.error) { tally[idx].errors++; return; }
      if (!v.consistent) { tally[idx].flagged++; if (v.severity === 'major') tally[idx].major++; }
    });
    const haiku = verdicts[0];
    const strongerFlag = verdicts.slice(1).some((v) => !v.error && v.consistent === false);
    const haikuPassed = haiku && !haiku.error && haiku.consistent === true;
    if (haikuPassed && strongerFlag) {
      caughtByStronger.push({ q, verdicts });
    }
    process.stdout.write(`  [${i}/${rows.length}] ${verdicts.map((v, idx) => v.error ? `${TIERS[idx].label.split(' ')[0]}:ERR` : (v.consistent ? '·' : `${TIERS[idx].label.split(' ')[0]}:FLAG`)).join('  ')}\n`);
  }

  console.log('\n──────── TIER TALLY ────────');
  TIERS.forEach((t, idx) => {
    console.log(`${t.label}:  flagged ${tally[idx].flagged}/${rows.length}  (major ${tally[idx].major})  errors ${tally[idx].errors}`);
  });

  console.log('\n──────── KNOWN OFFENDERS (TotK / Ganondorf rows), all tiers ────────');
  for (const { q, verdicts } of knownVerdicts) {
    console.log(`\nQ: ${q.question_text}`);
    console.log(`   answer: ${q.answer}   [gen_by: ${q.generated_by_provider ?? 'null'}]`);
    TIERS.forEach((t, idx) => {
      const v = verdicts[idx];
      console.log(`   ${t.label}: ${v.error ? 'ERROR ' + v.error : (v.consistent ? 'consistent' : `INCONSISTENT (${v.severity}) — ${v.issue}`)}`);
    });
  }

  console.log(`\n──────── CAUGHT BY A STRONGER TIER (Haiku passed, Sonnet/Opus flagged): ${caughtByStronger.length} ────────`);
  for (const { q, verdicts } of caughtByStronger) {
    console.log(`\nQ: ${q.question_text}`);
    console.log(`   answer: ${q.answer}   [gen_by: ${q.generated_by_provider ?? 'null'}]`);
    TIERS.forEach((t, idx) => {
      const v = verdicts[idx];
      console.log(`   ${t.label}: ${v.error ? 'ERROR ' + v.error : (v.consistent ? 'consistent' : `INCONSISTENT (${v.severity}) — ${v.issue}`)}`);
    });
  }
  console.log('');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
