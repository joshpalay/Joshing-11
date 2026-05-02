import {
  ANTHROPIC_MODEL,
  extractTextContent,
  getAnthropicClient,
  parseJsonObject,
} from '@/lib/llm';
import { getNextDailyResetBoundary } from '@/lib/games/timezone';
import { db, generatedQuestions } from '@/server/db';
import {
  mapAdaptiveLevelToDifficultyHint,
  updateAdaptiveLevel,
} from '@/server/adaptive-difficulty';
import { getKnowledgeBase, getRecentDailyQuestionTexts } from '@/server/db/queries/daily';
import { getDailyPreferences } from '@/server/db/queries/daily-preferences';
import { resolveDailyBasePoints } from './types';

export type GeneratedQuestionRow = typeof generatedQuestions.$inferSelect;

const SYSTEM_PROMPT = `You are generating trivia questions for Joshing, a social trivia game played among friends.
Questions must be:
- Factual with a single objectively correct answer
- Specific and surprising, not the most obvious fact about the topic
- Drawn from the intellectual and cultural world of the domain, not biographical trivia
- Written at a level that would reward genuine knowledge

Return ONLY valid JSON. No preamble, no markdown fences, no explanation.

Return format:
{
  "questions": [
    {
      "canonical_subcategory": "string, hyper-specific, never 'Other'",
      "broad_category": "string",
      "question_text": "string",
      "answer": "string",
      "explainer": "string, 2-3 sentences of educational context",
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

const FIXED_DIFFICULTY_LEVELS: Record<string, number> = {
  normal: 1.0,
  moderate: 2.0,
  challenging: 3.0,
  ridiculous: 4.0,
};

function difficultyInstruction(preference: string | undefined, adaptiveLevel?: number | null): string | null {
  if (!preference) return null;
  if (preference === 'adaptive') {
    return mapAdaptiveLevelToDifficultyHint(adaptiveLevel ?? 1).promptHint;
  }
  const fixedLevel = FIXED_DIFFICULTY_LEVELS[preference];
  return fixedLevel === undefined ? null : mapAdaptiveLevelToDifficultyHint(fixedLevel).promptHint;
}

function buildUserPrompt(
  domains: string[],
  count: number,
  prev: string[],
  domainSkips: ReadonlyMap<string, number> | undefined,
  difficultyPreference?: string,
  domainDifficultyOverrides?: ReadonlyMap<string, string>,
  adaptiveLevel?: number | null,
): string {
  const prevBlock = prev.length > 0 ? prev.slice(-40).join('\n') : '(none yet)';

  let calibration = '';
  if (domainSkips && domainSkips.size > 0) {
    const lines: string[] = [];
    for (const domain of domains) {
      const countForDomain = domainSkips.get(domain);
      if (countForDomain !== undefined && countForDomain > 0) {
        lines.push(`- ${domain} (${countForDomain} pass${countForDomain === 1 ? '' : 'es'} in the last 7 days)`);
      }
    }
    if (lines.length > 0) {
      calibration = `

The player has recently passed on questions in these areas. Use a different sub-angle, era, or facet, and do not repeat the same kind of fact:
${lines.join('\n')}`;
    }
  }

  let difficultyHint = '';
  if (domainDifficultyOverrides && domainDifficultyOverrides.size > 0) {
    const perDomain: string[] = [];
    for (const domain of domains) {
      const instruction = difficultyInstruction(
        domainDifficultyOverrides.get(domain) ?? difficultyPreference,
        adaptiveLevel,
      );
      if (instruction) perDomain.push(`- ${domain}: ${instruction}`);
    }

    if (perDomain.length > 0) {
      const uniqueInstructions = new Set(perDomain.map((line) => line.split(': ').slice(1).join(': ')));
      difficultyHint = uniqueInstructions.size === 1
        ? `\n\nDifficulty instruction: ${Array.from(uniqueInstructions)[0]}`
        : `\n\nDifficulty instruction by domain:\n${perDomain.join('\n')}`;
    }
  } else {
    const instruction = difficultyInstruction(difficultyPreference, adaptiveLevel);
    if (instruction) difficultyHint = `\n\nDifficulty instruction: ${instruction}`;
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
    const questionText = asString(rec.question_text);
    const answer = asString(rec.answer);
    const explainer = asString(rec.explainer);
    const difficulty = asDifficulty(rec.difficulty_estimate);
    if (!canonical || !broad || !questionText || !answer || !explainer || !difficulty) {
      continue;
    }
    result.push({
      canonical_subcategory: canonical,
      broad_category: broad,
      question_text: questionText,
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
  domainDifficultyOverrides?: ReadonlyMap<string, string>,
  adaptiveLevel?: number | null,
): Promise<LlmQuestion[]> {
  const client = getAnthropicClient();
  if (!client) return [];

  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 2000,
    temperature: 0.8,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: buildUserPrompt(
          domains,
          count,
          previousQuestionTexts,
          domainSkips,
          difficultyPreference,
          domainDifficultyOverrides,
          adaptiveLevel,
        ),
      },
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
  extraAvoidTexts: string[] = [],
  domainSkips: ReadonlyMap<string, number> | undefined = undefined,
  difficultyPreference?: string,
  domainDifficultyOverrides?: ReadonlyMap<string, string>,
  adaptiveLevel?: number | null,
): Promise<GeneratedQuestionRow[]> {
  if (count <= 0 || domains.length === 0) return [];

  const avoidList = [...extraAvoidTexts, ...previousQuestionTexts].slice(-40);

  let generated: LlmQuestion[] = [];
  try {
    generated = await callLlmOnce(
      domains,
      count,
      avoidList,
      domainSkips,
      difficultyPreference,
      domainDifficultyOverrides,
      adaptiveLevel,
    );
    if (generated.length === 0) {
      console.warn('[daily/generate-questions] first attempt returned no usable questions, retrying');
      generated = await callLlmOnce(
        domains,
        count,
        avoidList,
        domainSkips,
        difficultyPreference,
        domainDifficultyOverrides,
        adaptiveLevel,
      );
    }
  } catch (err) {
    console.warn('[daily/generate-questions] retrying after error', {
      error: err instanceof Error ? err.message : 'unknown',
    });
    try {
      generated = await callLlmOnce(
        domains,
        count,
        avoidList,
        domainSkips,
        difficultyPreference,
        domainDifficultyOverrides,
        adaptiveLevel,
      );
    } catch (err2) {
      console.error('[daily/generate-questions] second attempt failed', {
        error: err2 instanceof Error ? err2.message : 'unknown',
      });
      return [];
    }
  }

  if (generated.length === 0) return [];

  const expiresAt = getNextDailyResetBoundary();
  const persisted: GeneratedQuestionRow[] = [];

  for (const question of generated.slice(0, count)) {
    const basePoints = resolveDailyBasePoints(question.difficulty_estimate);
    const [row] = await db
      .insert(generatedQuestions)
      .values({
        userId,
        canonicalSubcategory: question.canonical_subcategory,
        broadCategory: question.broad_category,
        questionText: question.question_text,
        answer: question.answer,
        explainer: question.explainer,
        difficultyEstimate: question.difficulty_estimate,
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
  const adaptiveLevel = preferences.difficulty === 'adaptive'
    ? await updateAdaptiveLevel(userId)
    : FIXED_DIFFICULTY_LEVELS[preferences.difficulty] ?? null;

  const allDomains = knowledgeBase.map((domain) => domain.domain);
  const selectedDomains = preferences.domainMode === 'custom' && preferences.selectedDomains.length > 0
    ? preferences.selectedDomains.filter((domain) => allDomains.includes(domain))
    : allDomains;
  const domainsForRound = selectedDomains.length > 0 ? selectedDomains : allDomains;

  return generateDailyQuestions(
    domainsForRound,
    count,
    userId,
    previousQuestionTexts,
    [],
    undefined,
    preferences.difficulty,
    undefined,
    adaptiveLevel,
  );
}
