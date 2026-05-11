import {
  ANTHROPIC_MODEL,
  extractTextContent,
  getAnthropicClient,
  parseJsonObject,
} from '@/lib/llm';
import { getNextDailyResetBoundary } from '@/lib/games/timezone';
import { db, generatedQuestions } from '@/server/db';
import {
  getDomainDifficultyOverrides,
  mapAdaptiveLevelToDifficultyHint,
  updateAdaptiveLevel,
} from '@/server/adaptive-difficulty';
import { getKnowledgeBase, getRecentDailyQuestionTexts } from '@/server/db/queries/daily';
import { getDailyPreferences } from '@/server/db/queries/daily-preferences';
import { reconcileProposedDomain } from '@/lib/questions/categorization';
import { isGenericCanonicalAnswer, normalizeCanonicalAnswerLabel } from '@/server/answers/canonical-answer';
import { resolveDailyBasePoints } from './types';

export type GeneratedQuestionRow = typeof generatedQuestions.$inferSelect;

const SYSTEM_PROMPT = `You are generating trivia questions for Joshing, a social trivia game played among friends.
Questions must be:
- Factual with a single objectively correct answer
- Specific and surprising, not the most obvious fact about the topic
- Drawn from the intellectual and cultural world of the domain, not biographical trivia
- Written at a level that would reward genuine knowledge

GRANULARITY RULES:
Domain labels identify a body of knowledge — a work, an artist, a period, a discipline. They never identify a facet, aspect, or angle on that knowledge.

GOOD domain labels:
- "Mrs. Dalloway"
- "Late Tchaikovsky"
- "James Joyce's Ulysses"
- "Italian Renaissance Painting"
- "Weimar Cinema"
- "1956 Hungarian Uprising"
- "Stephen Sondheim"

BAD domain labels (never propose these):
- "Mrs. Dalloway – Characters & Themes" (facet of a work)
- "Ulysses – Structure & Symbolism" (facet of a work)
- "Tchaikovsky's Symphonic Form" (facet of an artist)
- "Italian Renaissance – Color Theory" (facet of a period)
- "Joyce's Use of Stream of Consciousness" (technique, not territory)

If a question is about a facet, assign it to the parent domain. A question about Clarissa Dalloway's character → "Mrs. Dalloway". A question about Bach's fugal technique → "Bach's Well-Tempered Clavier" if it's specific to that work, otherwise "Johann Sebastian Bach" or the appropriate work-level domain.

Do not invent meta-categories. Do not append qualifiers like "themes," "characters," "structure," "technique," "form," "style" to a domain.

When in doubt: prefer the broader, work-level label. Use the exact domain name provided to you — the canonical_subcategory for a question should match the domain it was generated for.

Return ONLY valid JSON. No preamble, no markdown fences, no explanation.

Return format:
{
  "questions": [
    {
      "canonical_subcategory": "string, the domain label at work/artist/period/discipline level — must match the domain this question was generated for",
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

  const domainSection =
    domains.length === count && count > 1
      ? `Generate exactly one trivia question for each of the following ${count} domains:\n${domains.map((d, i) => `${i + 1}. ${d}`).join('\n')}`
      : `Generate ${count} trivia question(s) for the following domain(s): ${domains.join(', ')}`;

  return `${domainSection}${calibration}${difficultyHint}

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
    if (isGenericCanonicalAnswer(answer)) {
      continue;
    }
    result.push({
      canonical_subcategory: canonical,
      broad_category: broad,
      question_text: questionText,
      answer: normalizeCanonicalAnswerLabel(answer),
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
    const { canonicalDomain } = await reconcileProposedDomain(
      question.canonical_subcategory,
      userId,
    ).catch(() => ({ canonicalDomain: question.canonical_subcategory, reconciled: false }));

    const basePoints = resolveDailyBasePoints(question.difficulty_estimate);
    const [row] = await db
      .insert(generatedQuestions)
      .values({
        userId,
        canonicalSubcategory: canonicalDomain,
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

const DECLARED_DOMAIN_WEIGHT = 0.5;

function selectDiverseDomains(
  knowledgeBase: Awaited<ReturnType<typeof getKnowledgeBase>>,
  count: number,
): string[] {
  // Group by broad category so we can pick one domain per category
  const byCategory = new Map<string, (typeof knowledgeBase)[number][]>();
  for (const d of knowledgeBase) {
    const cat = d.broadCategory ?? 'other';
    const arr = byCategory.get(cat) ?? [];
    arr.push(d);
    byCategory.set(cat, arr);
  }

  // Shuffle categories for variety across runs
  const categories = Array.from(byCategory.values());
  for (let i = categories.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [categories[i], categories[j]] = [categories[j], categories[i]];
  }

  const selected: string[] = [];

  // One domain per category, preferring demonstrated; include declared at 50%
  for (const bucket of categories) {
    if (selected.length >= count) break;
    const pool = bucket.filter(
      (d) => d.territoryType === 'demonstrated' || Math.random() < DECLARED_DOMAIN_WEIGHT,
    );
    const eligible = pool.length > 0 ? pool : bucket;
    const pick = eligible[Math.floor(Math.random() * eligible.length)];
    selected.push(pick.domain);
  }

  // Fill remaining slots if there are more slots than categories
  if (selected.length < count) {
    const used = new Set(selected);
    const remaining = knowledgeBase
      .filter((d) => !used.has(d.domain))
      .sort(() => Math.random() - 0.5);
    for (const d of remaining) {
      if (selected.length >= count) break;
      selected.push(d.domain);
    }
  }

  return selected.length > 0 ? selected : knowledgeBase.slice(0, count).map((d) => d.domain);
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

  let domainsForRound: string[];
  if (preferences.domainMode === 'custom' && preferences.selectedDomains.length > 0) {
    // Custom mode: user explicitly selected domains, use as-is
    const filtered = preferences.selectedDomains.filter((domain) => allDomains.includes(domain));
    domainsForRound = filtered.length > 0 ? filtered : allDomains;
  } else {
    // Random mode: pick one domain per category for cross-category variety
    domainsForRound = selectDiverseDomains(knowledgeBase, count);
  }

  const domainDifficultyOverrides = preferences.difficulty === 'adaptive'
    ? await getDomainDifficultyOverrides(userId, domainsForRound).catch(() => undefined)
    : undefined;

  return generateDailyQuestions(
    domainsForRound,
    count,
    userId,
    previousQuestionTexts,
    [],
    undefined,
    preferences.difficulty,
    domainDifficultyOverrides,
    adaptiveLevel,
  );
}
