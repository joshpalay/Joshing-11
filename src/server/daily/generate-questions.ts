/**
 * B9 — Personal Daily bot question generation.
 *
 * Generates novel trivia questions that fill out the player's daily queue
 * when friend authored content doesn't reach 5.  Persists each generated
 * question to `GeneratedQuestion` scoped to the user with an `expires_at`
 * aligned to the daily reset.
 */

import {
  ANTHROPIC_MODEL,
  extractTextContent,
  getAnthropicClient,
  parseJsonObject,
} from '@/lib/llm';
import { resolveDailyBasePoints } from './types';
import { getNextDailyResetBoundary } from '@/lib/games/timezone';
import { db, generatedQuestions } from '@/server/db';
import { getDailyPreferences, getKnowledgeBase, getRecentDailyQuestionTexts } from '@/server/db/queries/daily';

export type GeneratedQuestionRow = typeof generatedQuestions.$inferSelect;

const SYSTEM_PROMPT = `You are generating trivia questions for Joshing, a social trivia game played among friends.
Questions must be:
- Factual with a single objectively correct answer
- Specific and surprising — not the most obvious fact about the topic
- Drawn from the intellectual and cultural world of the domain, not biographical trivia
- Written at a level that would reward genuine knowledge

Return ONLY valid JSON. No preamble, no markdown fences, no explanation.

Return format:
{
  "questions": [
    {
      "canonical_subcategory": "string — hyper-specific, never 'Other'",
      "broad_category": "string",
      "question_text": "string",
      "answer": "string",
      "explainer": "string — 2-3 sentences of educational context",
      "difficulty_estimate": "accessible | moderate | specialist"
    }
  ]
}`;

type LlmQuestion = {
  canonical_subcategory: string;
  broad_category: string;
  question_text: string;
  answer: string;
  explainer: string;
  difficulty_estimate: 'accessible' | 'moderate' | 'specialist';
};

const DIFFICULTY_HINTS: Record<string, string> = {
  moderate: 'Aim for moderate difficulty — questions that reward genuine knowledge but are not obscure.',
  challenging: 'Write specialist-level questions that require real expert knowledge of the domain.',
  ridiculous: 'Write the most demanding questions possible — highly specific facts, precise dates or numbers, arcane terminology, or details only a true expert would know. Mark all questions difficulty_estimate: "specialist".',
};

function buildUserPrompt(
  domains: string[],
  count: number,
  prev: string[],
  domainSkips: ReadonlyMap<string, number> | undefined,
  difficultyPreference?: string,
  domainDifficultyOverrides?: ReadonlyMap<string, string>
): string {
  const prevBlock = prev.length > 0 ? prev.slice(-40).join('\n') : '(none yet)';

  let calibration = '';
  if (domainSkips && domainSkips.size > 0) {
    const lines: string[] = [];
    for (const d of domains) {
      const c = domainSkips.get(d);
      if (c !== undefined && c > 0) {
        lines.push(`- ${d} (${c} pass${c === 1 ? '' : 'es'} in the last 7 days)`);
      }
    }
    if (lines.length > 0) {
      calibration = `

The player has recently passed on questions in these areas (among the domains you are writing for). Use a different sub-angle, era, or facet — do not recapitulate the same kind of fact they have been setting aside:
${lines.join('\n')}`;
    }
  }

  // Build per-domain difficulty hints. When overrides are present some domains
  // may need harder questions than the user's base preference (mastery step-up).
  let difficultyHint = '';
  if (domainDifficultyOverrides && domainDifficultyOverrides.size > 0) {
    const perDomain: string[] = [];
    for (const d of domains) {
      const pref = domainDifficultyOverrides.get(d) ?? difficultyPreference;
      if (pref && DIFFICULTY_HINTS[pref]) {
        perDomain.push(`- ${d}: ${DIFFICULTY_HINTS[pref]}`);
      }
    }
    if (perDomain.length > 0) {
      // If all domains share the same hint, use a single global instruction.
      const unique = new Set(perDomain.map((l) => l.split(': ').slice(1).join(': ')));
      if (unique.size === 1) {
        const sharedPref =
          domainDifficultyOverrides.get(domains[0]) ?? difficultyPreference ?? '';
        if (DIFFICULTY_HINTS[sharedPref]) {
          difficultyHint = `\n\nDifficulty instruction: ${DIFFICULTY_HINTS[sharedPref]}`;
        }
      } else {
        difficultyHint = `\n\nDifficulty instruction (per domain — the player's mastery level varies):\n${perDomain.join('\n')}`;
      }
    }
  } else if (difficultyPreference && DIFFICULTY_HINTS[difficultyPreference]) {
    difficultyHint = `\n\nDifficulty instruction: ${DIFFICULTY_HINTS[difficultyPreference]}`;
  }

  return `Generate ${count} trivia question(s) for the following domain(s): ${domains.join(', ')}.
${calibration}${difficultyHint}

Previously generated questions to avoid repeating:
${prevBlock}`;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asDifficulty(value: unknown): LlmQuestion['difficulty_estimate'] | null {
  if (value === 'accessible' || value === 'moderate' || value === 'specialist') {
    return value;
  }
  return null;
}

function parseQuestions(raw: string): LlmQuestion[] {
  const parsed = parseJsonObject(raw);
  if (!parsed) return [];
  const rawList = parsed.questions;
  if (!Array.isArray(rawList)) return [];

  const result: LlmQuestion[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const canonical = asString(rec.canonical_subcategory);
    const broad = asString(rec.broad_category);
    const qtext = asString(rec.question_text);
    const answer = asString(rec.answer);
    const explainer = asString(rec.explainer);
    const difficulty = asDifficulty(rec.difficulty_estimate);
    if (!canonical || !broad || !qtext || !answer || !explainer || !difficulty) {
      continue;
    }
    result.push({
      canonical_subcategory: canonical,
      broad_category: broad,
      question_text: qtext,
      answer,
      explainer,
      difficulty_estimate: difficulty,
    });
  }
  return result;
}

async function callLlmOnce(
  domains: string[],
  count: number,
  previousQuestionTexts: string[],
  domainSkips: ReadonlyMap<string, number> | undefined,
  difficultyPreference?: string,
  domainDifficultyOverrides?: ReadonlyMap<string, string>
): Promise<LlmQuestion[]> {
  const client = getAnthropicClient();
  if (!client) return [];

  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 2000,
    temperature: 0.8,
    system: SYSTEM_PROMPT,
    messages: [
      { role: 'user', content: buildUserPrompt(domains, count, previousQuestionTexts, domainSkips, difficultyPreference, domainDifficultyOverrides) },
    ],
  });

  const text = extractTextContent(response.content);
  return parseQuestions(text);
}

export async function generateDailyQuestions(
  domains: string[],
  count: number,
  userId: string,
  previousQuestionTexts: string[],
  /** Text from questions the user skipped (same "never again" as thumbs down) — help the LLM avoid near-duplicates. */
  extraAvoidTexts: string[] = [],
  /** Recent per-domain pass counts — steers the model away from repeated angles. */
  domainSkips: ReadonlyMap<string, number> | undefined = undefined,
  /** Player's base difficulty preference — passed as a hint to the LLM prompt. */
  difficultyPreference?: string,
  /** Per-domain difficulty overrides derived from mastery step-up logic. */
  domainDifficultyOverrides?: ReadonlyMap<string, string>
): Promise<GeneratedQuestionRow[]> {
  if (count <= 0 || domains.length === 0) return [];

  const avoidList = [...extraAvoidTexts, ...previousQuestionTexts].slice(-40);

  let generated: LlmQuestion[] = [];
  try {
    generated = await callLlmOnce(domains, count, avoidList, domainSkips, difficultyPreference, domainDifficultyOverrides);
    if (generated.length === 0) {
      console.warn('[daily/generate-questions] first attempt returned no usable questions, retrying');
      generated = await callLlmOnce(domains, count, avoidList, domainSkips, difficultyPreference, domainDifficultyOverrides);
    }
  } catch (err) {
    console.warn('[daily/generate-questions] retrying after error', {
      error: err instanceof Error ? err.message : 'unknown',
    });
    try {
      generated = await callLlmOnce(domains, count, avoidList, domainSkips, difficultyPreference, domainDifficultyOverrides);
    } catch (err2) {
      console.error('[daily/generate-questions] second attempt failed', {
        error: err2 instanceof Error ? err2.message : 'unknown',
      });
      return [];
    }
  }

  if (generated.length === 0) return [];

  // Persist each question with the correct expires_at (next daily reset).
  const expiresAt = getNextDailyResetBoundary();
  const limited = generated.slice(0, count);

  const persisted: GeneratedQuestionRow[] = [];
  for (const q of limited) {
    const basePoints = resolveDailyBasePoints(q.difficulty_estimate);
    const [row] = await db
      .insert(generatedQuestions)
      .values({
        userId,
        canonicalSubcategory: q.canonical_subcategory,
        broadCategory: q.broad_category,
        questionText: q.question_text,
        answer: q.answer,
        explainer: q.explainer,
        difficultyEstimate: q.difficulty_estimate,
        basePoints,
        expiresAt,
        usedInQueue: false,
      })
      .returning();
    persisted.push(row);
  }

  return persisted;
}

export async function generateDailyQuestionsFromKnowledgeBase(
  userId: string,
  count: number,
): Promise<GeneratedQuestionRow[]> {
  const [knowledgeBase, preferences, previousQuestionTexts] = await Promise.all([
    getKnowledgeBase(userId),
    getDailyPreferences(userId),
    getRecentDailyQuestionTexts(userId),
  ]);

  const allDomains = knowledgeBase.map((domain) => domain.domain);
  const selectedDomains = preferences?.selectedDomains?.length
    ? preferences.selectedDomains.filter((domain) => allDomains.includes(domain))
    : allDomains;

  return generateDailyQuestions(
    selectedDomains.length > 0 ? selectedDomains : allDomains,
    count,
    userId,
    previousQuestionTexts,
    [],
    undefined,
    preferences?.difficultyPreference ?? 'adaptive',
  );
}
