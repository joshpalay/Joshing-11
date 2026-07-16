/**
 * reconcile-twin-drift.mjs — Question ⇄ GeneratedQuestion content-drift reconciler.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every daily-generated question exists as TWO rows: the original
 * `GeneratedQuestion` and a `Question` "twin" linked by `generated_question_id`.
 * The daily/bonus/catch-up serving path reads the stem/answer/explainer LIVE from
 * the GeneratedQuestion (src/server/db/queries/daily.ts:833). But the quality/edit
 * pipeline writes content to only ONE store at a time:
 *   - approveEditedQuestion  (machine-demotions.ts:212) — XOR write, keyed on target.table
 *   - adminEditQuestion      (admin-questions.ts:153)    — writes `questions` only
 * So a correction applied to the twin never reaches the copy players are served
 * (and vice-versa). The two texts drift. This script surfaces every drifted pair
 * and (with --apply) converges each pair onto its canonical copy.
 *
 * CANONICAL DIRECTION (per row, NOT a blanket direction — drift goes both ways)
 * ----------------------------------------------------------------------------
 * The canonical copy is the one most recently blessed:
 *   twinStamp = max(Question.verified_at, Question.updated_at)
 *   genStamp  = GeneratedQuestion.verified_at
 * Whichever is later wins. Tie / both-null → the twin wins (it's the store the
 * human/quality pipeline corrects, and it carries trust_tier=human_validated).
 * Convergence copies the winner's question_text / answer / explainer onto the loser.
 *
 * EMBEDDINGS: the two rows already share one (stale) embedding vector copied at
 * twin-creation; whichever text we converge to, the embedding was ALREADY stale
 * relative to at least one edited stem. This script does NOT re-embed — a separate
 * re-embed pass (dedup relies on embeddings) is the right follow-up. It only reports
 * the count of rows whose embedding should be recomputed after convergence.
 *
 * USAGE
 * -----
 *   node scripts/ops/reconcile-twin-drift.mjs            # DRY RUN (default) — no writes
 *   node scripts/ops/reconcile-twin-drift.mjs --apply    # WRITES TO PROD (DATABASE_URL is prod)
 *   node scripts/ops/reconcile-twin-drift.mjs --only-answers   # restrict to answer drift
 *
 * DATABASE_URL is read from .env — in this repo that IS prod. --apply performs
 * prod DML; clear it with Josh before running.
 */

import pg from 'pg';
import 'dotenv/config';

const APPLY = process.argv.includes('--apply');
const ONLY_ANSWERS = process.argv.includes('--only-answers');

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });

function trunc(s, n = 90) {
  if (s == null) return '∅';
  const one = String(s).replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n - 1) + '…' : one;
}

/** max of a set of timestamps, ignoring null/undefined; null if all empty. */
function maxStamp(...vals) {
  const ts = vals.filter(Boolean).map((v) => new Date(v).getTime());
  return ts.length ? Math.max(...ts) : null;
}

async function main() {
  await client.connect();

  // Pull every live twin whose content diverges from its GeneratedQuestion source.
  const { rows } = await client.query(`
    select
      q.id                     as q_id,
      q.question_text          as q_text,
      q.answer_text            as q_answer,
      q.factual_explanation    as q_expl,
      q.verified_at            as q_verified_at,
      q.updated_at             as q_updated_at,
      q.trust_tier             as q_trust,
      g.id                     as g_id,
      g.question_text          as g_text,
      g.answer                 as g_answer,
      g.explainer              as g_expl,
      g.verified_at            as g_verified_at,
      (q.question_text is distinct from g.question_text)       as text_drift,
      (q.answer_text  is distinct from g.answer)               as answer_drift,
      (coalesce(q.factual_explanation,'') is distinct from coalesce(g.explainer,'')) as expl_drift
    from "Question" q
    join "GeneratedQuestion" g on g.id = q.generated_question_id
    where q.generated_question_id is not null
      and q.deleted_at is null
      and (
        q.question_text is distinct from g.question_text
        or q.answer_text is distinct from g.answer
        or coalesce(q.factual_explanation,'') is distinct from coalesce(g.explainer,'')
      )
    order by q.updated_at desc nulls last
  `);

  const targets = ONLY_ANSWERS ? rows.filter((r) => r.answer_drift) : rows;

  console.log(`\n${APPLY ? '🛠  APPLY MODE (writing to prod)' : '🔎 DRY RUN (no writes)'}`);
  console.log(`Drifted twin pairs: ${targets.length}${ONLY_ANSWERS ? ' (answer drift only)' : ''}`);
  console.log('='.repeat(100));

  let toGen = 0; // convergence direction: twin wins → write GeneratedQuestion
  let toTwin = 0; // GeneratedQuestion wins → write Question twin
  let answerFixes = 0;
  const plan = [];

  for (const r of targets) {
    const twinStamp = maxStamp(r.q_verified_at, r.q_updated_at);
    const genStamp = maxStamp(r.g_verified_at);
    // Later stamp wins; tie / both-null → twin (the corrected store).
    const winner = genStamp != null && twinStamp != null && genStamp > twinStamp ? 'gen' : 'twin';

    const canonical =
      winner === 'twin'
        ? { text: r.q_text, answer: r.q_answer, expl: r.q_expl }
        : { text: r.g_text, answer: r.g_answer, expl: r.g_expl };

    if (winner === 'twin') toGen++;
    else toTwin++;
    if (r.answer_drift) answerFixes++;

    plan.push({ r, winner, canonical });

    const flags = [r.text_drift && 'TEXT', r.answer_drift && 'ANSWER', r.expl_drift && 'EXPL']
      .filter(Boolean)
      .join('+');
    console.log(`\n• ${flags}  canonical=${winner.toUpperCase()}  q=${r.q_id}  g=${r.g_id}`);
    console.log(`    twinStamp=${twinStamp ? new Date(twinStamp).toISOString() : '∅'}  genStamp=${genStamp ? new Date(genStamp).toISOString() : '∅'}  trust=${r.q_trust}`);
    if (r.text_drift) {
      console.log(`    twin text: ${trunc(r.q_text)}`);
      console.log(`    gen  text: ${trunc(r.g_text)}`);
    }
    if (r.answer_drift) {
      console.log(`    twin ans : ${trunc(r.q_answer, 60)}`);
      console.log(`    gen  ans : ${trunc(r.g_answer, 60)}`);
    }
    console.log(`    ⇒ converge both to ${winner.toUpperCase()}: ${trunc(canonical.text)}`);
  }

  console.log('\n' + '='.repeat(100));
  console.log(`Summary: ${targets.length} drifted pairs`);
  console.log(`  • twin is canonical → will overwrite GeneratedQuestion: ${toGen}`);
  console.log(`  • gen  is canonical → will overwrite Question twin:      ${toTwin}`);
  console.log(`  • pairs with an ANSWER drift (higher risk):             ${answerFixes}`);
  console.log(`  • embeddings needing recompute after convergence:       ${targets.length} (out of scope — follow-up re-embed pass)`);

  if (!APPLY) {
    console.log('\nDRY RUN — no rows written. Re-run with --apply to converge (prod DML).');
    await client.end();
    return;
  }

  // --apply: converge each pair to its canonical copy in a single transaction.
  await client.query('BEGIN');
  try {
    const now = new Date();
    for (const { r, winner, canonical } of plan) {
      if (winner === 'twin') {
        // Push twin content onto the served GeneratedQuestion.
        await client.query(
          `update "GeneratedQuestion"
             set question_text = $1, answer = $2, explainer = $3
           where id = $4`,
          [canonical.text, canonical.answer, canonical.expl ?? null, r.g_id],
        );
      } else {
        // Push GeneratedQuestion content onto the twin (keeps admin view in sync).
        await client.query(
          `update "Question"
             set question_text = $1, answer_text = $2, factual_explanation = $3, updated_at = $4
           where id = $5`,
          [canonical.text, canonical.answer, canonical.expl ?? null, now, r.q_id],
        );
      }
    }
    await client.query('COMMIT');
    console.log(`\n✅ Applied. Converged ${plan.length} pairs.`);
    console.log('   NOTE: embeddings NOT recomputed — run a re-embed pass before relying on dedup.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Rolled back — no changes written.', err);
    process.exitCode = 1;
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
