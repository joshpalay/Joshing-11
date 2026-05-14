/**
 * Joshing LLM utilities — all Claude API calls are server-side only.
 * Model: claude-sonnet-4-6 | Prompts from joshing-llm-prompts.md
 *
 * PRD Section 9:
 *   Prompt 1 — gradeAnswerWithLLM:  lenient grader, correct/wrong + reason
 *   Prompt 2 — categorizeQuestion:  assign category to question text
 *   Prompt 3 — generateExplainer:   brief + full JSON (tests only; not private play)
 *            — generateFactualReflectionExplanation: factual_explanation backfill
 *   Prompt 4 — suggestAnswer:       canonical answer + type + difficulty_estimate
 */

import Anthropic from '@anthropic-ai/sdk';

// ─── Types ────────────────────────────────────────────────────────────────────

export type GradeResult = 'correct' | 'wrong';

export type GradingResponse = {
  result: GradeResult;
  confidence: number;
  reason: string;
  // "Snarky but Sweet" — a short, warm quip when the answer is wrong but thematically close.
  // null if the answer is simply off-base or unrelated.
  consolation: string | null;
};

export type CategoryResult = {
  subcategory: string;
  broad_category: string;
  confidence: number;
};

export type ExplainerResult = {
  brief: string;
  full: string;
};

export type AnswerSuggestionResult = {
  type: 'factual' | 'personal' | 'ambiguous' | 'factual_uncertain';
  suggested_answer: string | null;
  note: string | null;
  is_list: boolean;
  min_list_items: number | null;
  difficulty_estimate: 'accessible' | 'moderate' | 'specialist' | null;
  suggested_phrasings?: string[];
};

export const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
// Grading is a simple binary task — Haiku is ~5-10x faster than Sonnet with adequate accuracy.
const GRADING_MODEL = 'claude-haiku-4-5';
const GENERIC_SUBCATEGORY_NORMALIZED = new Set([
  'pop culture',
  'music',
  'literature',
  'history',
  'world history',
  'film',
  'television',
  'film and television',
  'film tv',
  'sports',
  'sport',
  'science',
  'philosophy',
  'language',
  'other',
  'general knowledge',
  'trivia',
]);
const VALID_SUGGESTION_TYPES = ['factual', 'personal', 'ambiguous', 'factual_uncertain'] as const;
const VALID_DIFFICULTY_ESTIMATES = ['accessible', 'moderate', 'specialist'] as const;
const PLACEHOLDER_API_KEYS = new Set(['', 'placeholder', 'your_api_key_here', 'changeme', 'undefined', 'null']);

let cachedClient: Anthropic | null = null;
let cachedClientKey: string | null = null;
let hasLoggedInvalidApiKey = false;

function isValidAnthropicApiKey(apiKey: string | undefined): apiKey is string {
  if (!apiKey) return false;
  const normalized = apiKey.trim();
  if (!normalized || PLACEHOLDER_API_KEYS.has(normalized.toLowerCase())) {
    return false;
  }
  return normalized.startsWith('sk-ant-') && normalized.length > 'sk-ant-'.length + 8;
}

export function getAnthropicClient(): Anthropic | null {
  // Explicit kill-switch — set LLM_ENABLED=false to disable all LLM calls and save API spend
  if (process.env.LLM_ENABLED === 'false') {
    return null;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!isValidAnthropicApiKey(apiKey)) {
    if (!hasLoggedInvalidApiKey) {
      console.warn('[LLM] Anthropic disabled: ANTHROPIC_API_KEY is missing or invalid');
      hasLoggedInvalidApiKey = true;
    }
    return null;
  }

  hasLoggedInvalidApiKey = false;
  if (!cachedClient || cachedClientKey !== apiKey) {
    cachedClient = new Anthropic({ apiKey });
    cachedClientKey = apiKey;
  }
  return cachedClient;
}

function summarizeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { type: typeof error };
  }

  const status = (error as { status?: number }).status;
  const code = (error as { code?: string }).code;
  return {
    name: error.name,
    message: error.message,
    ...(typeof status === 'number' ? { status } : {}),
    ...(typeof code === 'string' ? { code } : {}),
  };
}

function logFallback(scope: string, reason: string, extra?: Record<string, unknown>) {
  console.warn(`[LLM] ${scope} fallback: ${reason}`, extra ?? {});
}

function clampConfidence(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, value));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return asTrimmedString(value);
}

function normalizeCategoryLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isTooGenericSubcategory(subcategory: string, broadCategory: string): boolean {
  const normalizedSubcategory = normalizeCategoryLabel(subcategory);
  const normalizedBroad = normalizeCategoryLabel(broadCategory);
  if (!normalizedSubcategory) return true;
  if (normalizedSubcategory === normalizedBroad) return true;
  return GENERIC_SUBCATEGORY_NORMALIZED.has(normalizedSubcategory);
}

function asIntegerOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value >= 0 ? value : null;
}

export function extractTextContent(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function extractFirstBalancedObject(text: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (char === '}') {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start !== -1) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

export function parseJsonObject(rawText: string): Record<string, unknown> | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  const candidates: string[] = [trimmed];
  const fencedJsonBlocks = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const match of fencedJsonBlocks) {
    const block = match[1]?.trim();
    if (block) candidates.push(block);
  }

  const balanced = extractFirstBalancedObject(trimmed);
  if (balanced) candidates.push(balanced);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const record = asRecord(parsed);
      if (record) return record;
    } catch {
      // continue
    }
  }

  return null;
}

function fallbackGrading(): GradingResponse {
  return { result: 'wrong', confidence: 0, reason: 'llm_error', consolation: null };
}

function fallbackCategorization(): CategoryResult {
  return { subcategory: 'Potpourri', broad_category: 'General Knowledge', confidence: 0 };
}

function fallbackExplainer(canonicalAnswer: string): ExplainerResult {
  return {
    brief: `The answer is ${canonicalAnswer}. No additional context is available right now.`,
    full: `The answer is ${canonicalAnswer}. No additional context is available right now.`,
  };
}

function fallbackSuggestion(): AnswerSuggestionResult {
  return {
    type: 'factual_uncertain',
    suggested_answer: null,
    note: null,
    is_list: false,
    min_list_items: null,
    difficulty_estimate: null,
  };
}

// ─── Prompt 1: Answer Grading ─────────────────────────────────────────────────

export async function gradeAnswerWithLLM(
  question: string,
  canonicalAnswer: string,
  submittedAnswer: string,
  questionType: string
): Promise<GradingResponse> {
  const userMessage = `Question: ${question}
Correct answer: ${canonicalAnswer}
Submitted answer: ${submittedAnswer}
Answer type: ${questionType}
Is the submitted answer correct? Return JSON only.`;

  const systemPrompt = `You are a lenient but fair answer grader for a personal trivia game called Joshing.
Your job is to determine whether a submitted answer is correct, and — when the answer is wrong but in the right ballpark — write a short, warm, slightly snarky consolation line. You are part of the friend group, not a proctor.

LENIENCY RULES — mark as correct if:
- The answer conveys the same meaning, even if worded differently
- There are spelling errors that don't change the meaning (e.g. "Bucephelus" for "Bucephalus" is correct)
- The answer is a reasonable abbreviation or shortened form (e.g. "Eroica" for "The Eroica" is correct)
- For list questions: the answer meets the minimum required count and all included items are correct
- The answer is phonetically close and contextually plausible (account for voice transcription errors)
- The answer includes the correct answer among other text (e.g. "I think it's Bucephalus" is correct)
- If the canonical answer is long or explanatory (more than ~10 words), focus on whether the submitted answer captures the core concept or mechanism. Do not require matching supporting detail, background context, or explanatory sentences. A short answer that demonstrates clear understanding of the key idea should be marked correct even if it omits elaboration.

STRICTNESS RULES — mark as wrong if:
- The answer is a different person, place, or thing entirely
- The answer is vague to the point of being meaningless (e.g. "some horse" for "Bucephalus")
- For list questions: fewer items than the minimum required

PERSONAL QUESTIONS:
- If answer_type is "personal", the canonical answer is the creator's intended answer. Apply normal leniency.

CONSOLATION RULES (for wrong answers only):
- If the submitted answer is in the right domain, theme, or era but factually off, write a short, warm, slightly snarky consolation (1 sentence, max 12 words).
  Examples: "Close! Right ocean, wrong monster." / "Same composer, wrong piece." / "Right era, wrong side of the Atlantic."
- The consolation should feel like a witty friend, not a teacher.
- If the answer is completely off-base, unrelated, or a wild guess, set consolation to null.
- Never write a consolation for correct answers (set consolation to null).

Return only valid JSON with keys: result, confidence, reason, consolation. No explanation outside the JSON object.`;

  try {
    const client = getAnthropicClient();
    if (!client) {
      return fallbackGrading();
    }

    const response = await client.messages.create({
      model: GRADING_MODEL,
      max_tokens: 300,
      temperature: 0,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = extractTextContent(response.content);
    const parsed = parseJsonObject(text);
    if (!parsed) {
      logFallback('gradeAnswerWithLLM', 'invalid_json', { responseLength: text.length });
      return fallbackGrading();
    }

    const result = parsed.result === 'correct' || parsed.result === 'wrong' ? parsed.result : null;
    if (!result) {
      logFallback('gradeAnswerWithLLM', 'invalid_result_field');
      return fallbackGrading();
    }

    const confidence = clampConfidence(parsed.confidence, 0);
    const reason = asTrimmedString(parsed.reason) ?? 'llm_invalid_response';
    const consolation = result === 'wrong' ? asNullableString(parsed.consolation) : null;

    return { result, confidence, reason, consolation };
  } catch (error) {
    logFallback('gradeAnswerWithLLM', 'request_failed', summarizeError(error));
    return fallbackGrading();
  }
}

// ─── Prompt 2: Question Categorization ────────────────────────────────────────

export async function categorizeQuestion(
  questionText: string,
  answerText: string
): Promise<CategoryResult> {
  const systemPrompt = `You are a hyper-specific categorizer for a personal trivia game.
Return exactly this JSON shape:
{
  "subcategory": "<hyper-specific label>",
  "broad_category": "<broad domain label>",
  "confidence": <0 to 1 number>
}

Rules:
- The subcategory must be as specific as the question demands.
- Never normalize upward to a broad field if a narrower label is justified.
- Use title case for both labels.
- broad_category must be a stable top-level bucket, not an author/work/movement-specific territory (e.g., use "Literature" for James Joyce, Irish Modernism, novels, poetry, or fiction; use "Music", "History", "Film & Television", "Science", "Philosophy", "Language", "Sports", "Pop Culture", or "General Knowledge").
- Never return "Other" as a broad_category or subcategory. Use "General Knowledge" as the broad_category only when no more precise top-level bucket applies.
- subcategory should be narrow and portrait-friendly.
- The subcategory must always be narrower than the broad_category. Never return the broad_category value itself as the subcategory (e.g. if broad_category is "Pop Culture", the subcategory must be something more specific than "Pop Culture"; if broad_category is "Music", the subcategory must be more specific than "Music").
- For music, film, TV, or pop culture questions: name the specific artist, franchise, era, or cultural moment — not the genre or medium (e.g. "Late-Career David Bowie", "MCU Phase 3", "Drag Race Seasons 1–5", "Early 2010s Internet Memes", "Survivor Original Era").
- Include temporal or stylistic specificity whenever it meaningfully narrows the territory (e.g. "Golden Age Hip-Hop" not "Hip-Hop", "New Hollywood Cinema" not "Film").

STRICT PROHIBITION — never use these as subcategory values (they are too generic):
"Pop Culture", "Music", "Literature", "History", "World History", "Film", "Television",
"Film and Television", "Film TV", "Sports", "Sport", "Science", "Philosophy", "Language",
"Other", "General Knowledge", "Trivia"
If you find yourself about to use one of these, go one level deeper: add an era, an artist name, a movement, a subfield, or a franchise.

Examples:
Good subcategories: "Late Tchaikovsky", "Bowie-era Glam Rock", "Sondheim Musicals",
                    "Weimar Modernism", "MCU Phase 3", "Taylor Swift Eras Tour Era",
                    "Early Reality TV (Survivor/Big Brother)", "Golden Age Hip-Hop",
                    "NFL Quarterback Records", "CRISPR Gene Editing",
                    "Late-Career David Bowie", "Pre-Code Hollywood"
Bad subcategories: "Classical Music", "Rock Music", "Musical Theatre", "Literature",
                   "Pop Culture", "Music", "Sports", "Film", "Science", "History"

Return JSON only.`;

  const userMessage = `Question: ${questionText}
Answer: ${answerText}
Categorize this question. Return JSON only.`;

  try {
    const client = getAnthropicClient();
    if (!client) {
      return fallbackCategorization();
    }

    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 300,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = extractTextContent(response.content);
    const parsed = parseJsonObject(text);
    if (!parsed) {
      logFallback('categorizeQuestion', 'invalid_json', { responseLength: text.length });
      return fallbackCategorization();
    }

    let subcategory = asTrimmedString(parsed.subcategory);
    const broadCategory = asTrimmedString(parsed.broad_category);
    if (!subcategory || !broadCategory) {
      logFallback('categorizeQuestion', 'missing_required_fields');
      return fallbackCategorization();
    }

    if (isTooGenericSubcategory(subcategory, broadCategory)) {
      const refinementPrompt = `You refine trivia subcategories into hyper-specific labels.
Return valid JSON only:
{ "subcategory": "<label>" }

Rules:
- Never return generic labels like "Pop Culture", "Music", "History", "Science", or "General Knowledge".
- Use a narrow territory label that feels like a person's real knowledge niche.
- Prefer era/person/movement/topic combinations when possible.
- Keep title case.

Examples:
- "Late-era David Bowie"
- "Cold War Space Race Diplomacy"
- "1980s Hong Kong Action Cinema"
- "Constitutional Compromises Of 1787"`;
      const refinementMessage = `Question: ${questionText}
Answer: ${answerText}
Broad category: ${broadCategory}
Current subcategory (too broad): ${subcategory}
Return JSON only.`;

      const refinementResponse = await client.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: 120,
        temperature: 0,
        system: refinementPrompt,
        messages: [{ role: 'user', content: refinementMessage }],
      });

      const refinementText = extractTextContent(refinementResponse.content);
      const refinementParsed = parseJsonObject(refinementText);
      const refined = asTrimmedString(refinementParsed?.subcategory);
      if (refined && !isTooGenericSubcategory(refined, broadCategory)) {
        subcategory = refined;
      }
    }

    const confidence = clampConfidence(parsed.confidence, 0.8);
    return { subcategory, broad_category: broadCategory, confidence };
  } catch (error) {
    logFallback('categorizeQuestion', 'request_failed', summarizeError(error));
    return fallbackCategorization();
  }
}

// ─── Prompt 3: Educational Explainer ──────────────────────────────────────────

export async function generateExplainer(
  questionText: string,
  canonicalAnswer: string,
  result: 'correct' | 'wrong' | 'expired',
  submittedAnswer: string | null
): Promise<ExplainerResult> {
  const systemPrompt = `You are writing educational explainers for a personal trivia game.
Your voice is warm, curious, and knowledgeable — like a friend who genuinely loves this topic and wants to share it, not a textbook.

Write two versions:

BRIEF (2-4 sentences, ~80-120 words):
- NEVER just repeat the answer. Always provide meaningful context.
- For a correct answer: share something genuinely interesting the player likely didn't know — the backstory, the "why", the surprising detail that makes the answer memorable.
- For a wrong or expired answer: briefly explain what the correct answer is and what makes it the right one — a key fact, historical moment, or defining characteristic.
- End with the most interesting or surprising detail you know about the topic.

FULL (2-3 paragraphs, ~180-250 words):
- Richer treatment: history, significance, broader context
- Include why the subject matters in its field
- Include a detail that is genuinely surprising or counterintuitive
- Make connections to related topics where natural
- Must read like a knowledgeable friend, never like Wikipedia
- Never use the phrase "In conclusion" or "In summary"

Return only valid JSON with "brief" and "full" keys.
No markdown. No explanation outside the JSON object.`;

  const submittedLine = submittedAnswer ? `\nPlayer answered: ${submittedAnswer}` : '';
  const userMessage = `Question: ${questionText}
Correct answer: ${canonicalAnswer}
Player result: ${result}${submittedLine}
Write brief and full explainers. Return JSON only.`;

  try {
    const client = getAnthropicClient();
    if (!client) {
      return fallbackExplainer(canonicalAnswer);
    }

    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 800,
      temperature: 0.7,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = extractTextContent(response.content);
    const parsed = parseJsonObject(text);
    if (!parsed) {
      logFallback('generateExplainer', 'invalid_json', { responseLength: text.length });
      return fallbackExplainer(canonicalAnswer);
    }

    const brief = asTrimmedString(parsed.brief);
    const full = asTrimmedString(parsed.full);
    if (!brief || !full) {
      logFallback('generateExplainer', 'missing_required_fields');
      return fallbackExplainer(canonicalAnswer);
    }

    return { brief, full };
  } catch (error) {
    logFallback('generateExplainer', 'request_failed', summarizeError(error));
    return fallbackExplainer(canonicalAnswer);
  }
}

/**
 * Cached end-of-session reflection copy: 2–3 factual sentences only.
 * No personalization, no players, no relationship assumptions.
 */
export async function generateFactualReflectionExplanation(
  questionText: string,
  canonicalAnswer: string
): Promise<string> {
  const systemPrompt = `You write short factual background for a trivia reflection screen.
Rules:
- Output exactly 2 or 3 complete sentences.
- Informational tone only: explain the fact, its context, or why it matters in the world.
- Do not address the reader. Do not mention players, friends, groups, or relationships.
- Do not assume anyone's personal connection to the topic.
- No markdown. Plain text only.`;

  const userMessage = `Question: ${questionText}
Correct answer: ${canonicalAnswer}
Write 2–3 sentences of factual explanation.`;

  try {
    const client = getAnthropicClient();
    if (!client) {
      return fallbackFactualReflectionExplanation(canonicalAnswer);
    }

    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 400,
      temperature: 0.45,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = extractTextContent(response.content).replace(/\s+/g, ' ').trim();
    if (text.length < 20) {
      logFallback('generateFactualReflectionExplanation', 'too_short', { responseLength: text.length });
      return fallbackFactualReflectionExplanation(canonicalAnswer);
    }
    return text;
  } catch (error) {
    logFallback('generateFactualReflectionExplanation', 'request_failed', summarizeError(error));
    return fallbackFactualReflectionExplanation(canonicalAnswer);
  }
}

function fallbackFactualReflectionExplanation(canonicalAnswer: string): string {
  return `This item’s accepted answer is “${canonicalAnswer}.” It reflects a specific fact often recorded in standard references. A quick search on the topic will surface additional context if you want to go deeper.`;
}

// ─── Prompt 4: Answer Suggestion (Question Creation) ──────────────────────────

export async function suggestAnswer(questionText: string): Promise<AnswerSuggestionResult> {
  const systemPrompt = `You are helping someone write trivia questions for a personal game played with their friends. When they type a question, suggest the canonical correct answer, classify the question type, and estimate difficulty.

Joshing questions are factual — they have objectively correct answers that do not depend on knowing the question writer personally. Questions drawn from shared cultural, intellectual, or historical territory are ideal. Questions that can only be answered with private biographical knowledge about the writer are the wrong kind of question for this game.

Classification rules:
"factual": Clear, verifiable answer exists. Provide it.
"personal": The answer depends on private biographical knowledge of the creator (e.g. "What was the name of my first dog?" or "What is my favourite film?"). These cannot be fairly graded. Return null for suggested_answer and redirect the writer toward factual territory.
"ambiguous": The question is unclear or subjective enough that grading would be difficult. Return null and a helpful note.
"factual_uncertain": You believe there is a correct answer but are not confident. Provide your best guess with a caveat note, AND provide 2–3 alternative phrasings in suggested_phrasings that would be more specific or verifiable — e.g. narrowing scope, citing a source, or removing ambiguity.

Canonical answer format: Keep suggested_answer short — the essential key fact or phrase, ≤ 15 words. Do not include explanatory context, mechanisms, or background in suggested_answer. If you want to include supporting detail, put it in the note field.
Examples:
  ✓  "A recursive holodeck simulation stored on a memory module"
  ✗  "Picard places Moriarty inside a recursive holodeck program running within the holodeck — a simulation within a simulation — stored on a memory module, giving them the subjective experience of freedom"

List detection: If the question asks for multiple items, set is_list to true and suggest min_list_items.

Difficulty estimate rules (for factual questions only; return null for personal/ambiguous):
"accessible": Most educated adults would know this — common knowledge, cultural touchstone, or widely-known fact.
"moderate": Requires some specific interest or knowledge in the topic area.
"specialist": Only enthusiasts or experts in a particular field would know this.

Notes by type:
- personal: "This question may depend on private knowledge of you specifically, which makes it hard to grade fairly. Joshing questions work best when drawn from shared cultural territory. Consider reframing — for example, instead of 'What is my favourite opera?' try 'What opera features the famous Drinking Song?'"
- ambiguous: "This might be hard to grade objectively. Is there a specific answer in mind? If not, consider reframing toward something with a clearer correct answer."
- factual_uncertain: "I'm not entirely sure — you may want to double-check this one."

Return only valid JSON with keys: type, suggested_answer, note, is_list, min_list_items, difficulty_estimate, suggested_phrasings.
suggested_phrasings is a JSON array of strings (2–3 items) for factual_uncertain questions; omit or set to [] for all other types.
No explanation outside the JSON object.`;

  const userMessage = `Question: ${questionText}
Suggest a canonical answer and classify the question type. Return JSON only.`;

  try {
    const client = getAnthropicClient();
    if (!client) {
      return fallbackSuggestion();
    }

    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 600,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = extractTextContent(response.content);
    const parsed = parseJsonObject(text);
    if (!parsed) {
      logFallback('suggestAnswer', 'invalid_json', { responseLength: text.length });
      return fallbackSuggestion();
    }

    const type = asTrimmedString(parsed.type);
    if (!type || !VALID_SUGGESTION_TYPES.includes(type as typeof VALID_SUGGESTION_TYPES[number])) {
      logFallback('suggestAnswer', 'invalid_type_field');
      return fallbackSuggestion();
    }

    const isList = typeof parsed.is_list === 'boolean' ? parsed.is_list : false;
    const minListItems = isList ? asIntegerOrNull(parsed.min_list_items) : null;

    const difficultyRaw = asTrimmedString(parsed.difficulty_estimate);
    const difficulty: AnswerSuggestionResult['difficulty_estimate'] = difficultyRaw && VALID_DIFFICULTY_ESTIMATES.includes(
      difficultyRaw as typeof VALID_DIFFICULTY_ESTIMATES[number]
    )
      ? difficultyRaw as AnswerSuggestionResult['difficulty_estimate']
      : null;

    const normalizedType = type as AnswerSuggestionResult['type'];

    const rawPhrasings = parsed.suggested_phrasings;
    const suggestedPhrasings: string[] = normalizedType === 'factual_uncertain' && Array.isArray(rawPhrasings)
      ? rawPhrasings.flatMap((p) => { const s = asTrimmedString(p); return s ? [s] : []; }).slice(0, 3)
      : [];

    return {
      type: normalizedType,
      suggested_answer: asNullableString(parsed.suggested_answer),
      note: asNullableString(parsed.note),
      is_list: isList,
      min_list_items: minListItems,
      difficulty_estimate: normalizedType === 'personal' || normalizedType === 'ambiguous'
        ? null
        : difficulty,
      ...(suggestedPhrasings.length > 0 && { suggested_phrasings: suggestedPhrasings }),
    };
  } catch (error) {
    logFallback('suggestAnswer', 'request_failed', summarizeError(error));
    return fallbackSuggestion();
  }
}

// ─── Prompt 5: Topic Tag Suggestion ───────────────────────────────────────────

export type TagSuggestionResult = {
  tags: string[];
};

export async function suggestTags(
  questionText: string,
  answerText: string,
  broadCategory: string
): Promise<TagSuggestionResult> {
  const systemPrompt = `You are a topic tagger for a personal trivia game.
Given a question, its answer, and its broad category, suggest 1–3 specific topic tags.

Rules:
- Tags must be specific (e.g. "pokemon", "world-war-ii", "the-beatles") — never just repeat the broad category
- Lowercase, using hyphens for multi-word tags (e.g. "star-wars", "ancient-rome")
- 1 tag minimum, 3 tags maximum
- Only tag what's clearly present — don't over-tag
- Personal questions about the question creator should get a "personal" tag

Return only valid JSON: { "tags": ["tag1", "tag2"] }`;

  const userMessage = `Question: ${questionText}
Answer: ${answerText}
Broad category: ${broadCategory}
Suggest specific topic tags. Return JSON only.`;

  try {
    const client = getAnthropicClient();
    if (!client) return { tags: [] };

    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 150,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = extractTextContent(response.content);
    const parsed = parseJsonObject(text);
    if (!parsed || !Array.isArray(parsed.tags)) return { tags: [] };

    const tags = parsed.tags
      .filter((t): t is string => typeof t === 'string')
      .map((t) => t.toLowerCase().trim().replace(/\s+/g, '-'))
      .filter((t) => t.length > 0 && t.length <= 50)
      .slice(0, 3);

    return { tags };
  } catch (error) {
    logFallback('suggestTags', 'request_failed', summarizeError(error));
    return { tags: [] };
  }
}

export async function resolveCanonicalSubcategoryWithLLM(
  incomingLabel: string,
  broadCategory: string,
  candidates: string[]
): Promise<string | null> {
  if (candidates.length === 0) return null;

  const systemPrompt = `You resolve near-synonym topic labels into one canonical subcategory.
Return only JSON:
{ "canonical_subcategory": "<value>" }

Rules:
- Choose an existing candidate if it is clearly the same concept.
- Prefer the most descriptive concise label.
- If none match, return the incoming label unchanged.
- Keep title case.`;

  const userMessage = `Broad category: ${broadCategory}
Incoming subcategory: ${incomingLabel}
Existing canonical candidates:
${candidates.map((c) => `- ${c}`).join('\n')}

Return JSON only.`;

  try {
    const client = getAnthropicClient();
    if (!client) return null;

    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 120,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = extractTextContent(response.content);
    const parsed = parseJsonObject(text);
    if (!parsed) return null;

    const canonical = asTrimmedString(parsed.canonical_subcategory);
    return canonical ?? null;
  } catch (error) {
    logFallback('resolveCanonicalSubcategoryWithLLM', 'request_failed', summarizeError(error));
    return null;
  }
}

// ─── Prompt 6: Question Cleaning (Grammar Fix + Confidence) ───────────────────

export type CleanQuestionResult = {
  cleaned_text: string;
  confidence: 'high' | 'medium' | 'low';
};

export async function cleanQuestion(questionText: string): Promise<CleanQuestionResult> {
  const systemPrompt = `You clean trivia question text and assess its quality. Given a question:
1. Fix grammar, spelling, capitalisation, and phrasing while preserving the original meaning exactly. Do not change what is being asked.
2. Rate your confidence that the question is clear, well-formed, and gradeable.

Confidence rules:
"high": Question is clear, has an obvious correct answer, and is unambiguous.
"medium": Question is mostly clear but could be interpreted in more than one way.
"low": Question is vague, ambiguous, subjective, or cannot be objectively graded.

Return only valid JSON with keys: cleaned_text, confidence.
No explanation outside the JSON.`;

  const userMessage = `Question: ${questionText}`;

  try {
    const client = getAnthropicClient();
    if (!client) {
      return { cleaned_text: questionText, confidence: 'high' };
    }

    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 200,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = extractTextContent(response.content);
    const parsed = parseJsonObject(text);
    if (!parsed) {
      return { cleaned_text: questionText, confidence: 'high' };
    }

    const cleaned_text = typeof parsed.cleaned_text === 'string' && parsed.cleaned_text.trim()
      ? parsed.cleaned_text.trim()
      : questionText;
    const confidenceRaw = typeof parsed.confidence === 'string' ? parsed.confidence.trim() : '';
    const confidence: CleanQuestionResult['confidence'] =
      confidenceRaw === 'high' || confidenceRaw === 'medium' || confidenceRaw === 'low'
        ? confidenceRaw
        : 'high';

    return { cleaned_text, confidence };
  } catch (error) {
    logFallback('cleanQuestion', 'request_failed', summarizeError(error));
    return { cleaned_text: questionText, confidence: 'high' };
  }
}
