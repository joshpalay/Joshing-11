/**
 * Prompt-diff proposer for the weekly improvement loop
 * (D-QUESTION-QUALITY-AGENTS-01, Decisions D/S5).
 *
 * Reads the live GENERATION_SYSTEM_PROMPT from suggest-question.ts (imported,
 * not hardcoded) and uses rejection aggregation evidence to propose a concrete
 * diff. The output is a markdown document; there is NO write path back to the
 * prompt file. Approved diffs land as normal reviewed code changes.
 *
 * Settled decision (S5): the agent proposes a diff; it never commits.
 * The "DO NOT AUTO-APPLY" header in the output enforces this contractually.
 */

import {
  ANTHROPIC_MODEL,
  INSTRUCTION_USER_INPUT_GUIDANCE,
  extractTextContent,
  getAnthropicClient,
  loggedMessagesCreate,
} from '@/lib/llm';
import { GENERATION_SYSTEM_PROMPT } from '@/server/llm/suggest-question';
import type {
  RejectionAggregationReport,
} from '@/server/db/queries/rejection-aggregation';
import { renderRejectionAggregationMarkdown } from '@/server/db/queries/rejection-aggregation';

export type PromptImprovementProposal = {
  ok: true;
  markdown: string;
} | {
  ok: false;
  reason: string;
};

const SYSTEM_PROMPT = `You are a prompt engineer reviewing evidence of trivia-question generation failures. Your job is to propose targeted improvements to a generation system prompt based on clustered failure patterns.

Rules:
1. Read the live generation prompt and the failure evidence carefully.
2. Identify specific weaknesses in the prompt that could explain the observed failure clusters.
3. Propose a concrete unified diff (--- old / +++ new format) against the live prompt text.
4. Your output must begin with a "⚠️ DO NOT AUTO-APPLY" header and must NOT contain any instructions to write or overwrite files.
5. Be conservative: propose the smallest change that addresses the failure evidence. Do not rewrite the entire prompt.
6. If the evidence is insufficient (fewer than 3 qualifying clusters), say so and skip the diff section.

Output format: markdown document with sections:
## Summary
## Failure evidence (clusters)
## Proposed diff
## Rationale${INSTRUCTION_USER_INPUT_GUIDANCE}`;

function buildUserMessage(
  aggregation: RejectionAggregationReport,
  aggregationMarkdown: string,
): string {
  return [
    '### Live generation prompt (read-only — do not instruct any code to modify this)',
    '```',
    GENERATION_SYSTEM_PROMPT,
    '```',
    '',
    '### Rejection aggregation evidence',
    aggregationMarkdown,
    '',
    `Total qualifying clusters: ${aggregation.clusters.length}`,
    `Window: trailing ${aggregation.windowDays} days, minimum sample size ${aggregation.minSampleSize}`,
    '',
    'Propose a targeted diff to the generation prompt based on this evidence. If the evidence is thin, say so explicitly and skip the diff. Return markdown only.',
  ].join('\n');
}

/**
 * Uses Sonnet to propose a generation-prompt improvement based on aggregated
 * rejection evidence. Returns a markdown document. Never writes to any file.
 * Telemetry is automatic via loggedMessagesCreate (scope 'prompt-improvement').
 */
export async function proposeGenerationPromptDiff(
  aggregation: RejectionAggregationReport,
): Promise<PromptImprovementProposal> {
  const client = getAnthropicClient();
  if (!client) return { ok: false, reason: 'llm_disabled' };

  const aggregationMarkdown = renderRejectionAggregationMarkdown(aggregation);
  const userMessage = buildUserMessage(aggregation, aggregationMarkdown);

  try {
    const response = await loggedMessagesCreate(client, 'prompt-improvement', {
      model: ANTHROPIC_MODEL,
      max_tokens: 2000,
      temperature: 0.3,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const rawText = extractTextContent(response.content);
    if (!rawText.trim()) {
      return { ok: false, reason: 'empty_response' };
    }

    // Prepend a DO NOT AUTO-APPLY banner in case the model omitted it.
    const banner = '⚠️ **DO NOT AUTO-APPLY** — This is a proposal only. Review and apply as a normal code change.\n\n';
    const markdown = rawText.startsWith('⚠️') ? rawText : banner + rawText;

    return { ok: true, markdown };
  } catch (error) {
    console.warn('[llm/prompt-improvement] request_failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: 'llm_error' };
  }
}

/**
 * Render the full weekly prompt-improvement report as a markdown document.
 * Combines the rejection aggregation evidence with the proposal (or a
 * "nothing to propose" notice when clusters are below threshold).
 */
export function renderPromptImprovementReport(params: {
  aggregation: RejectionAggregationReport;
  aggregationMarkdown: string;
  proposal: PromptImprovementProposal;
}): string {
  const { aggregation, aggregationMarkdown, proposal } = params;
  const lines: string[] = [
    `# Weekly prompt-improvement report`,
    ``,
    `Generated: ${aggregation.generatedAt.toISOString()}`,
    `Window: trailing ${aggregation.windowDays} days | Min cluster size: ${aggregation.minSampleSize}`,
    ``,
    `---`,
    ``,
    aggregationMarkdown,
    ``,
    `---`,
    ``,
    `## Proposed generation-prompt diff`,
    ``,
  ];

  if (!proposal.ok) {
    lines.push(`_Proposal skipped: ${proposal.reason}_`);
  } else {
    lines.push(proposal.markdown);
  }

  return lines.join('\n');
}
