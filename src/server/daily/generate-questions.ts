import {
  ANTHROPIC_MODEL,
  extractTextContent,
  getAnthropicClient,
  loggedMessagesCreate,
  parseJsonObject,
} from '@/lib/llm';
import { getNextDailyResetBoundary } from '@/lib/games/timezone';
import { db, generatedQuestions } from '@/server/db';
import {
  getDomainDifficultyOverrides,
  mapAdaptiveLevelToDifficultyHint,
  updateAdaptiveLevel,
} from '@/server/adaptive-difficulty';
import { getKnowledgeBase, getRecentDailyQuestionTexts, getRecentFactKeys } from '@/server/db/queries/daily';
import { getDailyPreferences } from '@/server/db/queries/daily-preferences';
import { reconcileProposedDomain } from '@/lib/questions/categorization';
import { isGenericCanonicalAnswer, normalizeCanonicalAnswerLabel } from '@/server/answers/canonical-answer';
import { isGenericSubcategory } from '@/server/questions/canonical-subcategory';
import { normalizeFactKey } from '@/server/questions/fact-key';
import { resolveDailyBasePoints } from './types';

// Cap the recent question-text block at this many entries inside the prompt.
// The full recent history (up to 200) is still used to derive the fact-key
// avoid set; only this slice is shown verbatim to stay within a reasonable
// token budget.
const RECENT_QUESTION_TEXT_LIMIT = 80;
// Cap the recent fact-key block at this many entries inside the prompt.
const RECENT_FACT_KEY_LIMIT = 200;

export type GeneratedQuestionRow = typeof generatedQuestions.$inferSelect;

const SYSTEM_PROMPT = `You are generating trivia questions for Joshing, a social trivia game played among friends.
Questions must be:
- Factual with a single objectively correct answer
- Drawn from the intellectual and cultural world of the domain, not biographical trivia
- Calibrated to the difficulty instruction below: at easier tiers, lean on well-known, recognizable facts that anyone interested in the domain would have encountered; save specific, surprising deep cuts for higher difficulty tiers

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

REPETITION RULES (read carefully):
The user will supply two avoid lists: previous question texts and previous fact_keys. A "fact" is the underlying piece of trivia, independent of phrasing. Two questions are the SAME FACT if they probe the same answer about the same subject under the same angle — even if the wording, framing, or sentence structure is completely different.

- "What instrument does Hagen play to summon the Gibichungs in Götterdämmerung?" and "Hagen calls the Gibichung vassals to assembly using which instrument?" are the SAME FACT.
- Do NOT generate a question whose fact appears in either avoid list, even if you can phrase it differently.
- Pick a genuinely new angle on the domain: a different work, character, scene, technique, year, person, or detail.

For each question, also emit a fact_key: a short hyphenated lowercase identifier for the underlying fact, in the form "<domain-slug>-<subject>-<answer-topic>". Examples:
- "gotterdammerung-hagen-summons-vassals-instrument"
- "mrs-dalloway-clarissa-party-guest-arrival-order"
- "tchaikovsky-pathetique-symphony-final-tempo-marking"

Keep fact_keys under 80 characters. Two questions with the same fact_key are duplicates and will be rejected.

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
      "difficulty_estimate": "accessible | moderate | specialist",
      "fact_key": "string, short hyphenated lowercase identifier for the underlying fact (see REPETITION RULES)"
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
  fact_key: string | null;
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
  prevFactKeys: string[],
  domainSkips: ReadonlyMap<string, number> | undefined,
  difficultyPreference?: string,
  domainDifficultyOverrides?: ReadonlyMap<string, string>,
  adaptiveLevel?: number | null,
): string {
  const prevBlock = prev.length > 0
    ? prev.slice(0, RECENT_QUESTION_TEXT_LIMIT).join('\n')
    : '(none yet)';
  const factKeyBlock = prevFactKeys.length > 0
    ? prevFactKeys.slice(0, RECENT_FACT_KEY_LIMIT).join('\n')
    : '(none yet)';

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

Previously generated questions to avoid repeating (do not re-ask any of these facts, even rephrased):
${prevBlock}

Fact keys already covered for this user (do not produce any question whose fact_key matches one of these):
${factKeyBlock}`;
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
    // Reject LLM responses that pick a bucket-level subcategory ("general",
    // "general knowledge", "trivia", etc.) — those questions are not tied
    // to any of the user's declared/demonstrated domains and must not be
    // served. This is the upstream guard on the generated_questions write
    // boundary; the LLM is told to use the exact domain it was given, so
    // anything generic here is a prompt violation we discard.
    if (isGenericSubcategory(canonical)) {
      continue;
    }
    result.push({
      canonical_subcategory: canonical,
      broad_category: broad,
      question_text: questionText,
      answer: normalizeCanonicalAnswerLabel(answer),
      explainer,
      difficulty_estimate: difficulty,
      fact_key: normalizeFactKey(asString(rec.fact_key)),
    });
  }
  return result;
}

async function callLlmOnce(
  domains: string[],
  count: number,
  previousQuestionTexts: string[],
  previousFactKeys: string[],
  domainSkips: ReadonlyMap<string, number> | undefined,
  difficultyPreference?: string,
  domainDifficultyOverrides?: ReadonlyMap<string, string>,
  adaptiveLevel?: number | null,
): Promise<LlmQuestion[]> {
  const client = getAnthropicClient();
  if (!client) return [];

  const response = await loggedMessagesCreate(client, 'generate-questions', {
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
          previousFactKeys,
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
  previousFactKeys: string[] = [],
): Promise<GeneratedQuestionRow[]> {
  if (count <= 0 || domains.length === 0) return [];

  // Avoid list ordering: newest first so the slice in buildUserPrompt keeps
  // recency. extraAvoidTexts (caller-supplied, e.g. same-batch peers) goes
  // first so it always reaches the prompt even if the recent history is long.
  const avoidList = [...extraAvoidTexts, ...previousQuestionTexts];
  const factKeyAvoidSet = new Set(previousFactKeys);

  let generated: LlmQuestion[] = [];
  try {
    generated = await callLlmOnce(
      domains,
      count,
      avoidList,
      previousFactKeys,
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
        previousFactKeys,
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
        previousFactKeys,
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
  const seenFactKeysThisBatch = new Set<string>();

  for (const question of generated.slice(0, count)) {
    const { canonicalDomain } = await reconcileProposedDomain(
      question.canonical_subcategory,
      userId,
    ).catch(() => ({ canonicalDomain: question.canonical_subcategory, reconciled: false }));

    if (isGenericSubcategory(canonicalDomain)) {
      console.warn('[daily/generate-questions] skipping question with generic canonical subcategory', {
        proposed: question.canonical_subcategory,
        reconciled: canonicalDomain,
      });
      continue;
    }

    // Belt-and-suspenders: even with the avoid list, the LLM occasionally
    // returns a fact_key that matches a recent one (or duplicates another
    // question in the same batch). Drop those rather than persist them.
    const factKey = question.fact_key;
    if (factKey) {
      if (factKeyAvoidSet.has(factKey) || seenFactKeysThisBatch.has(factKey)) {
        console.warn('[daily/generate-questions] skipping question with already-seen fact_key', {
          factKey,
          canonicalDomain,
        });
        continue;
      }
      seenFactKeysThisBatch.add(factKey);
    }

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
        factKey,
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
    const cat = d.broadCategory ?? 'General Knowledge';
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
  const [knowledgeBase, preferences, previousQuestionTexts, previousFactKeys] = await Promise.all([
    getKnowledgeBase(userId),
    getDailyPreferences(userId),
    getRecentDailyQuestionTexts(userId),
    getRecentFactKeys(userId),
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
    previousFactKeys,
  );
}
