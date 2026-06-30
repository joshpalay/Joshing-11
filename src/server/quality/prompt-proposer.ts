/**
 * Phase 5 of B-QUESTION-QUALITY-AGENTS-01 — the prompt-diff proposer. PROPOSAL
 * ONLY: it reads the LIVE generation prompt at runtime, takes the above-floor
 * clusters from the Phase-4 aggregation plus a few example defects, and emits a
 * markdown artifact (evidence → concrete diff → "DO NOT AUTO-APPLY"). It has NO
 * write path to any prompt file — an approved diff lands later as a normal,
 * human-reviewed commit to generate-questions.ts:SYSTEM_PROMPT.
 *
 * Divergence ② (flagged + ratified): the proposer targets the DAILY GENERATION
 * prompt (generate-questions.ts:SYSTEM_PROMPT) — the prompt that actually writes
 * the questions the verifier demotes — NOT suggest-question.ts's author-assist
 * GENERATION_SYSTEM_PROMPT named in the original D-doc.
 *
 * This is the single 'quality-aggregation'-scoped LLM call (Decision F); it is
 * fail-open (a model error yields a "could not generate proposals" note, never a
 * thrown route).
 */

import { and, eq, gte, or, sql } from 'drizzle-orm';

import {
  ANTHROPIC_MODEL,
  extractTextContent,
  getAnthropicClient,
  loggedMessagesCreate,
  wrapUserInput,
} from '@/lib/llm';
import { db, generatedQuestions, questions } from '@/server/db';
// Reads the LIVE generation prompt — the proposal diffs against exactly what is
// deployed, never a copy.
import { SYSTEM_PROMPT as LIVE_GENERATION_PROMPT } from '@/server/daily/generate-questions';
import {
  buildQualityAggregation,
  type ClusterStats,
} from '@/server/quality/quality-aggregation';

// Code-enforced so the warning is present regardless of model output.
const PROPOSAL_HEADER = '# Prompt improvement proposals — DO NOT AUTO-APPLY';

const MAX_CLUSTERS = Math.max(1, Number(process.env.PROMPT_PROPOSAL_MAX_CLUSTERS ?? 6));
const EVIDENCE_PER_CLUSTER = Math.max(1, Number(process.env.PROMPT_PROPOSAL_EVIDENCE_PER_CLUSTER ?? 3));

export type ClusterEvidence = {
  cluster: ClusterStats;
  examples: Array<{ questionText: string; answer: string; defect: string; reason: string | null }>;
};

/**
 * Pure: wrap a proposal body with the mandatory DO-NOT-AUTO-APPLY header and a
 * human-review caveat. Exported so the guarantee is unit-tested. The body is the
 * model's per-cluster diffs (or a "nothing to propose" note).
 */
export function wrapProposalArtifact(body: string, meta: { periodStart: Date; periodEnd: Date }): string {
  const span = `${meta.periodStart.toISOString().slice(0, 10)}–${meta.periodEnd.toISOString().slice(0, 10)}`;
  return [
    PROPOSAL_HEADER,
    '',
    `_Window ${span}. PROPOSALS for human review only — no code path applies these. ` +
      'An approved change lands as a normal reviewed commit to `generate-questions.ts:SYSTEM_PROMPT`._',
    '',
    body.trim(),
  ].join('\n');
}

async function gatherEvidence(cluster: ClusterStats, start: string): Promise<ClusterEvidence> {
  const matchQ = and(
    sql`coalesce(${questions.broadCategory}, '—') = ${cluster.broadCategory}`,
    sql`coalesce(${questions.canonicalSubcategory}, '—') = ${cluster.canonicalSubcategory}`,
    or(
      and(eq(questions.verificationVerdict, 'demoted'), gte(questions.verifiedAt, new Date(start))),
      and(eq(questions.publicStatus, 'rejected'), gte(questions.updatedAt, new Date(start))),
    ),
  );
  const matchG = and(
    sql`coalesce(${generatedQuestions.broadCategory}, '—') = ${cluster.broadCategory}`,
    sql`coalesce(${generatedQuestions.canonicalSubcategory}, '—') = ${cluster.canonicalSubcategory}`,
    eq(generatedQuestions.verificationVerdict, 'demoted'),
    gte(generatedQuestions.verifiedAt, new Date(start)),
  );

  const [qRows, gRows] = await Promise.all([
    db
      .select({
        questionText: questions.questionText,
        answer: questions.answerText,
        verdict: questions.verificationVerdict,
        reason: questions.publicEligibilityReason,
      })
      .from(questions)
      .where(matchQ)
      .limit(EVIDENCE_PER_CLUSTER),
    db
      .select({ questionText: generatedQuestions.questionText, answer: generatedQuestions.answer })
      .from(generatedQuestions)
      .where(matchG)
      .limit(EVIDENCE_PER_CLUSTER),
  ]);

  const examples = [
    ...qRows.map((r) => ({
      questionText: r.questionText,
      answer: r.answer,
      defect: r.verdict === 'demoted' ? 'verification: demoted' : 'vet: rejected',
      reason: r.reason ?? null,
    })),
    ...gRows.map((r) => ({
      questionText: r.questionText,
      answer: r.answer,
      defect: 'verification: demoted (generated)',
      reason: null,
    })),
  ].slice(0, EVIDENCE_PER_CLUSTER);

  return { cluster, examples };
}

const SYSTEM_PROMPT = `You propose MINIMAL improvements to the system prompt that GENERATES trivia questions, to reduce recurring factual defects seen in production. You are given the CURRENT prompt verbatim and clusters of recently demoted/rejected questions (the defects), grouped by topic.

Rules:
- Propose the smallest concrete change that would have prevented each defect class: an added rule, a sharpened sentence, or ONE exemplar. Prefer a single GENERAL rule over many topic-specific ones.
- Quote the EXACT current text you would change (or name the insertion point), then show the proposed text. Keep the prompt's voice.
- Do NOT rewrite the whole prompt. Do NOT invent defects beyond the evidence.
- These are PROPOSALS only; never claim they are applied.

Output GitHub-flavored markdown: one "### <category › subcategory>" section per cluster, each with **Evidence** (the defect pattern + 1–2 example questions) and **Proposed change** (current → proposed). If the clusters share a root cause, add a single "### Cross-cutting" section with one unifying rule.`;

function buildUserMessage(evidence: ClusterEvidence[]): string {
  const clusterBlocks = evidence
    .map((e) => {
      const examples = e.examples
        .map(
          (x, i) =>
            `  ${i + 1}. [${x.defect}] Q: ${x.questionText}\n     A: ${x.answer}${x.reason ? `\n     reason: ${x.reason}` : ''}`,
        )
        .join('\n');
      return `### ${e.cluster.broadCategory} › ${e.cluster.canonicalSubcategory} (verified ${e.cluster.sampleSize}, demoted ${e.cluster.demoted}, vet-rejected ${e.cluster.vetRejected})\n${examples}`;
    })
    .join('\n\n');

  return [
    wrapUserInput('current_generation_prompt', LIVE_GENERATION_PROMPT),
    wrapUserInput('defect_clusters', clusterBlocks),
    'Propose minimal prompt changes. Markdown only.',
  ].join('\n');
}

/**
 * Build the full proposal artifact for the trailing window. Returns markdown that
 * ALWAYS carries the DO-NOT-AUTO-APPLY header. Makes at most one LLM call (skipped
 * entirely when no eligible cluster has evidence). Never writes any prompt file.
 */
export async function buildPromptProposals(windowDays = 30): Promise<{ markdown: string; clusters: number; usedLlm: boolean }> {
  const aggregation = await buildQualityAggregation(windowDays);
  const meta = { periodStart: aggregation.periodStart, periodEnd: aggregation.periodEnd };
  const start = aggregation.periodStart.toISOString();

  const top = aggregation.eligible.slice(0, MAX_CLUSTERS);
  const evidence = (await Promise.all(top.map((c) => gatherEvidence(c, start)))).filter(
    (e) => e.examples.length > 0,
  );

  if (evidence.length === 0) {
    return {
      markdown: wrapProposalArtifact(
        '_No eligible cluster had demoted/rejected examples this window — nothing to propose._',
        meta,
      ),
      clusters: 0,
      usedLlm: false,
    };
  }

  const client = getAnthropicClient();
  if (!client) {
    return {
      markdown: wrapProposalArtifact('_LLM unavailable — could not generate proposals this run._', meta),
      clusters: evidence.length,
      usedLlm: false,
    };
  }

  try {
    const response = await loggedMessagesCreate(client, 'quality-aggregation', {
      model: ANTHROPIC_MODEL,
      max_tokens: 2400,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage(evidence) }],
    });
    const body = extractTextContent(response.content).trim();
    return { markdown: wrapProposalArtifact(body || '_Model returned no proposals._', meta), clusters: evidence.length, usedLlm: true };
  } catch (error) {
    console.warn('[prompt-proposer] request_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      markdown: wrapProposalArtifact('_Proposal generation failed — see logs; retry on the next run._', meta),
      clusters: evidence.length,
      usedLlm: false,
    };
  }
}
