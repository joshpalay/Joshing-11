// Backfill GeneratedQuestion.subject_entity / Question.subject_entity for the
// existing pool (B-DEDUP-SUBJECT-COOLDOWN, Tier 2). The generator emits
// subject_entity going forward; this derives it for pre-existing rows via a
// batched Haiku pass so the subject-cooldown gate can see a user's prior
// answered history (otherwise Tier 2 only covers questions generated after it
// shipped).
//
// Two steps, cheapest first:
//   0) FREE copy-from-twin: a canonical row whose GeneratedQuestion twin already
//      has subject_entity copies it across (no LLM call).
//   1) Haiku-derive subject_entity for whatever is still NULL (question + answer
//      → primary subject), then write it back.
//
// APPROVAL GATE: dry-run first — reports row counts and an estimated Haiku cost.
// Idempotent: only NULL rows are processed; re-running resumes.
// Secrets are in .env.local here, so run with:
//   npx tsx -r dotenv/config scripts/backfill-subject-entity.ts --apply dotenv_config_path=.env.local
//
// Usage:
//   npx tsx scripts/backfill-subject-entity.ts            # dry-run
//   npx tsx scripts/backfill-subject-entity.ts --apply    # copy + derive + write

import 'dotenv/config';

import { eq, isNull, and, sql } from 'drizzle-orm';

import { db, pool, generatedQuestions, questions } from '../src/server/db';
import { getAnthropicClient, HAIKU_MODEL } from '../src/lib/llm';

const APPLY = process.argv.slice(2).includes('--apply');

// claude-haiku-4-5 list price (USD per 1M tokens). Input-dominated here.
const HAIKU_INPUT_PER_MTOK = 1.0;
const estimateTokens = (text: string) => Math.ceil((text?.length ?? 0) / 4);
const BATCH = 25;

type PendingRow = { id: string; origin: 'machine' | 'human'; questionText: string; answer: string };

async function countCopyableFromTwins(): Promise<number> {
  const res = await db.execute(sql`
    SELECT count(*)::int AS n
    FROM "Question" q
    JOIN "GeneratedQuestion" g ON g.id = q.generated_question_id
    WHERE q.subject_entity IS NULL AND g.subject_entity IS NOT NULL AND q.deleted_at IS NULL
  `);
  return Number((res.rows[0] as { n: number } | undefined)?.n ?? 0);
}

async function copyFromTwins(): Promise<number> {
  const res = await db.execute(sql`
    UPDATE "Question" q
    SET subject_entity = g.subject_entity
    FROM "GeneratedQuestion" g
    WHERE q.generated_question_id = g.id
      AND q.subject_entity IS NULL AND g.subject_entity IS NOT NULL AND q.deleted_at IS NULL
  `);
  return res.rowCount ?? 0;
}

async function loadPending(): Promise<PendingRow[]> {
  const [machine, human] = await Promise.all([
    db
      .select({ id: generatedQuestions.id, q: generatedQuestions.questionText, a: generatedQuestions.answer })
      .from(generatedQuestions)
      .where(isNull(generatedQuestions.subjectEntity)),
    db
      .select({ id: questions.id, q: questions.questionText, a: questions.answerText })
      .from(questions)
      .where(and(isNull(questions.subjectEntity), isNull(questions.deletedAt))),
  ]);
  return [
    ...machine.map((r) => ({ id: r.id, origin: 'machine' as const, questionText: r.q, answer: r.a })),
    ...human.map((r) => ({ id: r.id, origin: 'human' as const, questionText: r.q, answer: r.a })),
  ];
}

const SYSTEM_PROMPT = `You label trivia questions with their primary SUBJECT ENTITY — the single person, work, character, place, or thing the question is most centrally about. It is COARSER than the specific fact: many different questions about Peter Pettigrew all share the subject "Peter Pettigrew". Name the most specific recurring entity a fan would point to, NOT the broad domain (not "Harry Potter", not "Music"). Keep it under 60 characters, no leading article.

You receive a JSON array of questions, each with an index, the question text, and the answer. Return ONLY valid JSON: { "results": [ { "i": <index>, "subject": "<subject entity>" }, ... ] } with one entry per input index. No preamble, no markdown.`;

function extractJson(text: string): { results?: Array<{ i: number; subject: string }> } | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function normalizeSubject(value: string): string | null {
  const s = value?.trim();
  if (!s) return null;
  return s.replace(/^(the|a|an)\s+/i, '').slice(0, 80).trim() || null;
}

async function deriveBatch(
  client: NonNullable<ReturnType<typeof getAnthropicClient>>,
  batch: PendingRow[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const payload = batch.map((r, i) => ({ i, question: r.questionText, answer: r.answer }));
  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 1500,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
  });
  const text = response.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');
  const parsed = extractJson(text);
  if (!parsed?.results) return out;
  for (const entry of parsed.results) {
    if (typeof entry?.i !== 'number' || entry.i < 0 || entry.i >= batch.length) continue;
    const subject = typeof entry.subject === 'string' ? normalizeSubject(entry.subject) : null;
    if (subject) out.set(batch[entry.i].id, subject);
  }
  return out;
}

async function storeSubject(origin: 'machine' | 'human', id: string, subject: string): Promise<void> {
  if (origin === 'machine') {
    await db.update(generatedQuestions).set({ subjectEntity: subject }).where(eq(generatedQuestions.id, id));
  } else {
    await db.update(questions).set({ subjectEntity: subject }).where(eq(questions.id, id));
  }
}

async function main() {
  console.log(`[backfill-subject-entity] ${APPLY ? 'APPLY' : 'DRY RUN'} mode\n`);

  const copyable = await countCopyableFromTwins();
  console.log(`[backfill-subject-entity] canonical rows backfillable FREE from generated twin: ${copyable}`);
  if (APPLY && copyable > 0) {
    const copied = await copyFromTwins();
    console.log(`[backfill-subject-entity] copied ${copied} subjects from twins (no Haiku cost)`);
  }

  const pending = await loadPending();
  const machineCount = pending.filter((p) => p.origin === 'machine').length;
  const totalTokens = pending.reduce(
    (sum, p) => sum + estimateTokens(p.questionText) + estimateTokens(p.answer) + 20,
    0,
  );
  const estCost = (totalTokens / 1_000_000) * HAIKU_INPUT_PER_MTOK;
  console.log(`[backfill-subject-entity] rows still NULL: ${pending.length} (machine=${machineCount}, human=${pending.length - machineCount})`);
  console.log(`[backfill-subject-entity] est. input tokens: ~${totalTokens.toLocaleString()} → est. Haiku cost: ~$${estCost.toFixed(4)} (at $${HAIKU_INPUT_PER_MTOK}/1M input tok)`);

  if (!APPLY) {
    console.log('\n[backfill-subject-entity] dry run only — re-run with --apply once the cost is approved.');
    return;
  }

  const client = getAnthropicClient();
  if (!client) {
    console.error('[backfill-subject-entity] ANTHROPIC client unavailable (key missing?) — cannot --apply.');
    process.exitCode = 1;
    return;
  }

  let written = 0;
  for (let start = 0; start < pending.length; start += BATCH) {
    const batch = pending.slice(start, start + BATCH);
    let derived: Map<string, string>;
    try {
      derived = await deriveBatch(client, batch);
    } catch (err) {
      console.warn(`[backfill-subject-entity] batch ${start}-${start + batch.length} failed; skipping`, {
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    for (const row of batch) {
      const subject = derived.get(row.id);
      if (!subject) continue;
      await storeSubject(row.origin, row.id, subject);
      written += 1;
    }
    console.log(`[backfill-subject-entity] processed ${Math.min(start + batch.length, pending.length)}/${pending.length}, written=${written}`);
  }

  console.log(`\n[backfill-subject-entity] done. copied_from_twin=${copyable}, haiku_written=${written}`);
}

main()
  .catch((err) => {
    console.error('[backfill-subject-entity] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
