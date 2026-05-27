import {
  ANTHROPIC_MODEL,
  HAIKU_MODEL,
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
import {
  getKnowledgeBase,
  getRecentDailyQuestionTexts,
  getRecentDomainCounts,
  getRecentFactKeys,
  getRecentSubAnglesByDomain,
  pickAccessibleBankSource,
  type RecentDailyQuestionEntry,
  type RecentFactKeyEntry,
} from '@/server/db/queries/daily';
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
- Recall questions, not selection questions: the player must produce the answer from memory

NEVER generate multiple-choice questions. Do not list candidate answers inside the question_text, and do not use phrasings like "Which of the following…", "is it X, Y, or Z?", or "— A, B, or C?". The question must stand alone as an open-ended prompt; the player writes a free-text answer.

BAD (multiple-choice phrasing — never produce these):
- "Which of the following best describes Sally — a romantic rival, a radical free spirit, or a steadying maternal figure?"
- "Was the symphony premiered in 1888, 1893, or 1901?"

GOOD (open recall):
- "What does Sally Seton represent to the young Clarissa in Mrs. Dalloway?"
- "In what year did Tchaikovsky premiere his Sixth Symphony?"

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

QUESTION SHAPE VARIETY:
Trivia gets monotonous when every question follows the same template ("What is the name of X?"). Vary the shape across the batch. Choose from this catalog and emit the chosen shape on each question via the question_shape field:

- "identification": asks for a name, term, title, or label (e.g. "What is the name of the dwarf who forges the ring?")
- "year_or_date": asks for a year, date, or temporal ordering (e.g. "In what year did the Berlin Wall fall?")
- "in_which_work": asks which work, scene, chapter, movement, or section something appears in
- "who_did_what": asks which character/person performs a specific act (e.g. "Who kills Polonius?")
- "sequence_or_order": asks for ordering of events, items, or steps
- "technique_or_term": asks for the technical term for a described concept
- "what_happens_next": asks what immediately follows a described scene/event

Rules:
- Within a single batch of questions, no two questions may share the same question_shape unless the batch has more questions than there are shapes in the catalog.
- "identification" is the most over-used shape — use it sparingly.
- Pick the shape that best fits the underlying fact.

Also emit sub_angles: a list of 1-3 short tags (each ≤ 40 chars) naming the facets of the domain this question covers. Tags should be specific enough that two questions on the same facet share a tag, but broad enough to reuse across questions. Examples:
- For "What instrument does Hagen play to summon the Gibichungs?": ["Hagen", "Götterdämmerung Act II", "summons vassals"]
- For "What does Clarissa hand Peter Walsh when he cries?": ["Peter Walsh visit", "Clarissa-Peter scene", "scissors motif"]
- For "What is the Latin term for a borrowed slow-moving melody in Renaissance polyphony?": ["cantus firmus", "Renaissance polyphony", "borrowed melody technique"]

Sub-angles are aggregated per domain and shown back to you on future generations as "already covered" — pick facets you have not yet explored.

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
      "fact_key": "string, short hyphenated lowercase identifier for the underlying fact (see REPETITION RULES)",
      "sub_angles": ["1-3 short tags identifying the facets of the domain covered (see above)"],
      "question_shape": "one of: identification | year_or_date | in_which_work | who_did_what | sequence_or_order | technique_or_term | what_happens_next"
    }
  ]
}`;

const QUESTION_SHAPES = [
  'identification',
  'year_or_date',
  'in_which_work',
  'who_did_what',
  'sequence_or_order',
  'technique_or_term',
  'what_happens_next',
] as const;
type QuestionShape = (typeof QUESTION_SHAPES)[number];

function asQuestionShape(value: unknown): QuestionShape | null {
  return typeof value === 'string' && (QUESTION_SHAPES as readonly string[]).includes(value)
    ? (value as QuestionShape)
    : null;
}

type LlmQuestion = {
  canonical_subcategory: string;
  broad_category: string;
  question_text: string;
  answer: string;
  explainer: string;
  difficulty_estimate: 'accessible' | 'moderate' | 'specialist';
  fact_key: string | null;
  sub_angles: string[];
  question_shape: QuestionShape | null;
};

const SUB_ANGLE_MAX_CHARS = 40;
const SUB_ANGLE_MAX_PER_QUESTION = 3;

function normalizeSubAngles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const truncated = trimmed.length > SUB_ANGLE_MAX_CHARS
      ? trimmed.slice(0, SUB_ANGLE_MAX_CHARS).trim()
      : trimmed;
    const key = truncated.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(truncated);
    if (out.length >= SUB_ANGLE_MAX_PER_QUESTION) break;
  }
  return out;
}

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

type AvoidQuestionEntry = RecentDailyQuestionEntry;
type AvoidFactKeyEntry = RecentFactKeyEntry;

function buildUserPrompt(
  domains: string[],
  count: number,
  prev: AvoidQuestionEntry[],
  prevFactKeys: AvoidFactKeyEntry[],
  domainSkips: ReadonlyMap<string, number> | undefined,
  difficultyPreference?: string,
  domainDifficultyOverrides?: ReadonlyMap<string, string>,
  adaptiveLevel?: number | null,
  subAnglesByDomain?: ReadonlyMap<string, string[]>,
): string {
  const prevBlock = prev.length > 0
    ? prev
        .slice(0, RECENT_QUESTION_TEXT_LIMIT)
        .map((entry) => `[${entry.domain}] ${entry.text}`)
        .join('\n')
    : '(none yet)';
  const factKeyBlock = prevFactKeys.length > 0
    ? prevFactKeys
        .slice(0, RECENT_FACT_KEY_LIMIT)
        .map((entry) => `[${entry.domain}] ${entry.factKey}`)
        .join('\n')
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

  let subAnglesHint = '';
  if (subAnglesByDomain && subAnglesByDomain.size > 0) {
    const perDomain: string[] = [];
    for (const domain of domains) {
      const angles = subAnglesByDomain.get(domain);
      if (angles && angles.length > 0) {
        perDomain.push(`- ${domain}: ${angles.join(' | ')}`);
      }
    }
    if (perDomain.length > 0) {
      subAnglesHint = `\n\nSub-angles already covered in recent questions for these domains. Pick a NEW facet that is not on this list — different character, scene, technique, work, period, or detail. Do not generate another question on any covered facet:
${perDomain.join('\n')}`;
    }
  }

  return `${domainSection}${calibration}${difficultyHint}${subAnglesHint}

Previously generated questions to avoid repeating (do not re-ask any of these facts, even rephrased). Each entry is prefixed with [<source domain>]. The user's domains may overlap in subject matter — for example, a fact about Mrs. Dalloway already asked under "Virginia Woolf's Novels and Essays" is still off limits when generating for "Mrs. Dalloway", and vice versa. A fact already covered under ANY of the user's domains must not be re-asked under ANY domain:
${prevBlock}

Fact keys already covered for this user (do not produce any question whose fact_key matches one of these). Each entry is prefixed with [<source domain>] for the same cross-domain reason:
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
    const factKeyRaw = rec.fact_key;
    const factKeyStr = asString(factKeyRaw);
    const factKey = normalizeFactKey(factKeyStr);
    if (!factKey) {
      // The fact-key dedup pipeline (avoid list + persist-time guard) is
      // load-bearing for question variety; a null fact_key silently disables
      // it for this row. Log enough detail to tell whether the LLM omitted
      // the field, returned a non-string, or emitted a string that
      // normalizeFactKey rejected.
      console.warn('[daily/generate-questions] fact_key missing or unnormalizable', {
        domain: canonical,
        rawType: factKeyRaw === undefined ? 'undefined' : factKeyRaw === null ? 'null' : typeof factKeyRaw,
        rawValue: typeof factKeyRaw === 'string' ? factKeyRaw.slice(0, 120) : null,
        questionPreview: questionText.slice(0, 80),
      });
    }
    result.push({
      canonical_subcategory: canonical,
      broad_category: broad,
      question_text: questionText,
      answer: normalizeCanonicalAnswerLabel(answer),
      explainer,
      difficulty_estimate: difficulty,
      fact_key: factKey,
      sub_angles: normalizeSubAngles(rec.sub_angles),
      question_shape: asQuestionShape(rec.question_shape),
    });
  }
  return result;
}

function reportShapeDistribution(generated: LlmQuestion[]): void {
  if (generated.length < 2) return;
  const counts = new Map<string, number>();
  let missing = 0;
  for (const q of generated) {
    if (!q.question_shape) {
      missing += 1;
      continue;
    }
    counts.set(q.question_shape, (counts.get(q.question_shape) ?? 0) + 1);
  }
  const duplicates = [...counts.entries()].filter(([, n]) => n > 1);
  if (duplicates.length === 0 && missing === 0) return;
  console.warn('[daily/generate-questions] question_shape variety check', {
    batchSize: generated.length,
    duplicatedShapes: duplicates.map(([shape, n]) => `${shape}×${n}`),
    missingShape: missing,
  });
}

const BATCH_DEDUPE_SYSTEM_PROMPT = `You are reviewing a small batch of trivia questions just generated for one user. Identify any pairs that probe the SAME underlying fact, even if phrased differently.

Two questions probe the same fact if they would test the same answer about the same subject under the same angle, regardless of wording. Different facts about the same character, work, or topic are NOT the same fact.

For each duplicate pair, mark exactly one index to drop (prefer dropping the more verbose or more answer-leaking phrasing). Do not mark both members of a pair.

Return JSON only:
{ "duplicate_indices": [list of zero-based indices to drop] }

If there are no duplicates, return { "duplicate_indices": [] }.`;

async function findBatchDuplicates(questions: LlmQuestion[]): Promise<Set<number>> {
  if (questions.length < 2) return new Set();
  const client = getAnthropicClient();
  if (!client) return new Set();

  const userMessage = questions
    .map(
      (q, i) =>
        `[${i}] domain=${q.canonical_subcategory}\n    q=${q.question_text}\n    a=${q.answer}`,
    )
    .join('\n\n');

  try {
    const response = await loggedMessagesCreate(client, 'batch-dedupe', {
      model: HAIKU_MODEL,
      max_tokens: 200,
      temperature: 0,
      system: BATCH_DEDUPE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });
    const parsed = parseJsonObject(extractTextContent(response.content));
    const rawList = parsed?.duplicate_indices;
    if (!Array.isArray(rawList)) return new Set();
    const valid = new Set<number>();
    for (const value of rawList) {
      if (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 0 &&
        value < questions.length
      ) {
        valid.add(value);
      }
    }
    return valid;
  } catch (err) {
    // Fail open: if the dedup check itself fails, we'd rather ship the batch
    // than block the user's daily queue on a Haiku outage.
    console.warn('[daily/generate-questions] batch dedupe failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return new Set();
  }
}

const QUALITY_GATE_SYSTEM_PROMPT = `You are reviewing a small batch of just-generated trivia questions for quality before they are served to a player. For each question, decide whether it has any of these defects:

1. ANSWER_LEAKED — the question setup contains the answer, near-paraphrase, or a tell that gives the answer away. E.g. "Mrs. Lovett bakes meat pies using a secret ingredient from Sweeney's victims. What does she put in the pies?" — the setup tells you it's the victims.
2. OPINION_OR_VAGUE — asks for a preference, value judgment, or has no single clear answer.
3. FALSE_PREMISE — the setup contains a factual error or assumes something incorrect.
4. SELF_ANSWERING — the question names the answer in its own text ("Who wrote the 1922 poem 'The Waste Land' by T. S. Eliot?").

A high bar applies — flag a question only when one of these defects is clearly present. Subtle wordsmithing concerns are NOT defects.

Return JSON only:
{ "drop_indices": [list of zero-based indices to drop], "reasons": { "<index>": "<short reason>" } }

If no questions are defective, return { "drop_indices": [], "reasons": {} }.`;

async function findQualityFailures(generated: LlmQuestion[]): Promise<{
  toDrop: Set<number>;
  reasons: Record<number, string>;
}> {
  if (generated.length === 0) return { toDrop: new Set(), reasons: {} };
  const client = getAnthropicClient();
  if (!client) return { toDrop: new Set(), reasons: {} };

  const userMessage = generated
    .map(
      (q, i) =>
        `[${i}] domain=${q.canonical_subcategory}\n    q=${q.question_text}\n    a=${q.answer}`,
    )
    .join('\n\n');

  try {
    const response = await loggedMessagesCreate(client, 'quality-gate', {
      model: HAIKU_MODEL,
      max_tokens: 500,
      temperature: 0,
      system: QUALITY_GATE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });
    const parsed = parseJsonObject(extractTextContent(response.content));
    const rawList = parsed?.drop_indices;
    const rawReasons = parsed?.reasons;
    const toDrop = new Set<number>();
    if (Array.isArray(rawList)) {
      for (const value of rawList) {
        if (
          typeof value === 'number' &&
          Number.isInteger(value) &&
          value >= 0 &&
          value < generated.length
        ) {
          toDrop.add(value);
        }
      }
    }
    const reasons: Record<number, string> = {};
    if (rawReasons && typeof rawReasons === 'object' && !Array.isArray(rawReasons)) {
      for (const [key, value] of Object.entries(rawReasons as Record<string, unknown>)) {
        const idx = Number.parseInt(key, 10);
        if (Number.isInteger(idx) && toDrop.has(idx) && typeof value === 'string') {
          reasons[idx] = value.slice(0, 200);
        }
      }
    }
    return { toDrop, reasons };
  } catch (err) {
    // Fail open: don't block the daily queue on a Haiku outage.
    console.warn('[daily/generate-questions] quality gate failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { toDrop: new Set(), reasons: {} };
  }
}

const RECENT_HISTORY_GATE_LIMIT = 30;

const RECENT_HISTORY_GATE_SYSTEM_PROMPT = `You are reviewing newly-generated trivia questions against a list of questions this same user has already been asked. For each NEW question, decide whether it probes the same underlying fact as ANY of the RECENT questions.

Two questions probe the same fact if they would test the same answer about the same subject under the same angle, regardless of wording. The user's domains may overlap (e.g. a fact about Mrs. Dalloway may appear under either "Mrs. Dalloway" or "Virginia Woolf's Novels and Essays") — overlap across domains still counts as a duplicate.

Return JSON only:
{ "duplicate_indices": [list of NEW indices that duplicate any RECENT entry] }

If no NEW question duplicates a RECENT one, return { "duplicate_indices": [] }.`;

async function findRecentHistoryDuplicates(
  generated: LlmQuestion[],
  recent: AvoidQuestionEntry[],
): Promise<Set<number>> {
  if (generated.length === 0 || recent.length === 0) return new Set();
  const client = getAnthropicClient();
  if (!client) return new Set();

  const recentSlice = recent.slice(0, RECENT_HISTORY_GATE_LIMIT);
  const recentBlock = recentSlice
    .map((entry) => `- [${entry.domain}] ${entry.text}`)
    .join('\n');
  const newBlock = generated
    .map((q, i) => `[${i}] [${q.canonical_subcategory}] ${q.question_text} (answer: ${q.answer})`)
    .join('\n');

  const userMessage = `RECENT (already asked):
${recentBlock}

NEW (just generated, indexed):
${newBlock}

Which NEW indices duplicate any RECENT entry?`;

  try {
    const response = await loggedMessagesCreate(client, 'history-dedupe', {
      model: HAIKU_MODEL,
      max_tokens: 200,
      temperature: 0,
      system: RECENT_HISTORY_GATE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });
    const parsed = parseJsonObject(extractTextContent(response.content));
    const rawList = parsed?.duplicate_indices;
    if (!Array.isArray(rawList)) return new Set();
    const valid = new Set<number>();
    for (const value of rawList) {
      if (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 0 &&
        value < generated.length
      ) {
        valid.add(value);
      }
    }
    return valid;
  } catch (err) {
    // Fail open: a Haiku outage should not block the daily queue.
    console.warn('[daily/generate-questions] history dedupe failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return new Set();
  }
}

async function callLlmOnce(
  domains: string[],
  count: number,
  previousQuestionTexts: AvoidQuestionEntry[],
  previousFactKeys: AvoidFactKeyEntry[],
  domainSkips: ReadonlyMap<string, number> | undefined,
  difficultyPreference?: string,
  domainDifficultyOverrides?: ReadonlyMap<string, string>,
  adaptiveLevel?: number | null,
  subAnglesByDomain?: ReadonlyMap<string, string[]>,
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
          subAnglesByDomain,
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
  previousQuestionTexts: AvoidQuestionEntry[],
  extraAvoidTexts: string[] = [],
  domainSkips: ReadonlyMap<string, number> | undefined = undefined,
  difficultyPreference?: string,
  domainDifficultyOverrides?: ReadonlyMap<string, string>,
  adaptiveLevel?: number | null,
  previousFactKeys: AvoidFactKeyEntry[] = [],
  subAnglesByDomain?: ReadonlyMap<string, string[]>,
): Promise<GeneratedQuestionRow[]> {
  if (count <= 0 || domains.length === 0) return [];

  // Avoid list ordering: newest first so the slice in buildUserPrompt keeps
  // recency. extraAvoidTexts (caller-supplied, e.g. same-batch peers) goes
  // first so it always reaches the prompt even if the recent history is long.
  // Caller-supplied entries get a synthetic "this batch" label since they
  // have no persisted source domain yet.
  const extraEntries: AvoidQuestionEntry[] = extraAvoidTexts.map((text) => ({
    domain: 'this batch',
    text,
  }));
  const avoidList: AvoidQuestionEntry[] = [...extraEntries, ...previousQuestionTexts];
  const factKeyAvoidSet = new Set(previousFactKeys.map((entry) => entry.factKey));

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
      subAnglesByDomain,
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
        subAnglesByDomain,
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
        subAnglesByDomain,
      );
    } catch (err2) {
      console.error('[daily/generate-questions] second attempt failed', {
        error: err2 instanceof Error ? err2.message : 'unknown',
      });
      return [];
    }
  }

  if (generated.length === 0) return [];

  // Drop near-duplicate questions inside this batch before we persist. The
  // LLM occasionally returns two questions that probe the same fact in a
  // single call (e.g. two Assassins/Proprietor questions on 2026-05-20), and
  // the fact_key-based persist guard only catches them when both rows have a
  // non-null fact_key — which has historically been rare.
  const duplicateIndices = await findBatchDuplicates(generated);
  if (duplicateIndices.size > 0) {
    console.warn('[daily/generate-questions] dropping intra-batch duplicates', {
      droppedCount: duplicateIndices.size,
      droppedIndices: [...duplicateIndices].sort((a, b) => a - b),
      originalCount: generated.length,
    });
    generated = generated.filter((_, i) => !duplicateIndices.has(i));
    if (generated.length === 0) return [];
  }

  // Enforced recent-history dedup. The avoid list in the prompt is advisory
  // and the model regularly slips past it; this Haiku gate is the actual
  // enforcement boundary. We check only the latest RECENT_HISTORY_GATE_LIMIT
  // entries since older history is already protected by fact_key dedup at
  // persist time.
  const recentForGate = avoidList.slice(0, RECENT_HISTORY_GATE_LIMIT);
  const recentDuplicates = await findRecentHistoryDuplicates(generated, recentForGate);
  if (recentDuplicates.size > 0) {
    console.warn('[daily/generate-questions] dropping recent-history duplicates', {
      droppedCount: recentDuplicates.size,
      droppedIndices: [...recentDuplicates].sort((a, b) => a - b),
      originalCount: generated.length,
    });
    generated = generated.filter((_, i) => !recentDuplicates.has(i));
    if (generated.length === 0) return [];
  }

  // Quality gate: drop questions with answer-leakage, opinion/vague targets,
  // false premises, or self-answering phrasing. This is the LLM-generated
  // counterpart to critiqueQuestion() which already runs on user-authored
  // submissions — gives us the same defect filter on bot output without
  // burning a per-question call (single Haiku per batch).
  const qualityResult = await findQualityFailures(generated);
  if (qualityResult.toDrop.size > 0) {
    console.warn('[daily/generate-questions] dropping low-quality questions', {
      droppedCount: qualityResult.toDrop.size,
      droppedIndices: [...qualityResult.toDrop].sort((a, b) => a - b),
      reasons: qualityResult.reasons,
      originalCount: generated.length,
    });
    generated = generated.filter((_, i) => !qualityResult.toDrop.has(i));
    if (generated.length === 0) return [];
  }

  // Surface question-shape distribution issues so we can see whether the
  // shape-variety prompt instruction is being honored. Not enforced —
  // there's no good fallback if the LLM disregards the shape rule, and
  // dropping questions on shape alone would erode the batch unnecessarily.
  reportShapeDistribution(generated);

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
        subAngles: question.sub_angles,
        expiresAt,
        usedInQueue: false,
      })
      .returning();
    persisted.push(row);
  }

  return persisted;
}

const DECLARED_DOMAIN_WEIGHT = 0.5;
const DOMAIN_PER_WEEK_CAP = 5;

function selectDiverseDomains(
  knowledgeBase: Awaited<ReturnType<typeof getKnowledgeBase>>,
  count: number,
  recentCounts: ReadonlyMap<string, number> = new Map(),
): string[] {
  // Apply the soft cap: drop any domain that has already produced
  // DOMAIN_PER_WEEK_CAP questions in the last 7 days. If every domain is
  // over cap, fall back to the full set rather than starve the queue.
  const overCap = (d: { domain: string }): boolean =>
    (recentCounts.get(d.domain) ?? 0) >= DOMAIN_PER_WEEK_CAP;
  const eligibleKb = knowledgeBase.some((d) => !overCap(d))
    ? knowledgeBase.filter((d) => !overCap(d))
    : knowledgeBase;

  // Group by broad category so we can pick one domain per category
  const byCategory = new Map<string, (typeof eligibleKb)[number][]>();
  for (const d of eligibleKb) {
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
    const remaining = eligibleKb
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
  const [
    knowledgeBase,
    preferences,
    previousQuestionTexts,
    previousFactKeys,
    recentDomainCounts,
  ] = await Promise.all([
    getKnowledgeBase(userId),
    getDailyPreferences(userId),
    getRecentDailyQuestionTexts(userId),
    getRecentFactKeys(userId),
    getRecentDomainCounts(userId).catch(() => new Map<string, number>()),
  ]);
  const adaptiveLevel = preferences.difficulty === 'adaptive'
    ? await updateAdaptiveLevel(userId)
    : FIXED_DIFFICULTY_LEVELS[preferences.difficulty] ?? null;

  const allDomains = knowledgeBase.map((domain) => domain.domain);

  let domainsForRound: string[];
  if (preferences.domainMode === 'custom' && preferences.selectedDomains.length > 0) {
    // Custom mode: user explicitly selected domains, use as-is. The
    // per-domain cap is intentionally not enforced here — when a user
    // explicitly hand-picks domains we respect that choice.
    const filtered = preferences.selectedDomains.filter((domain) => allDomains.includes(domain));
    domainsForRound = filtered.length > 0 ? filtered : allDomains;
  } else {
    // Random mode: pick one domain per category for cross-category variety,
    // with a soft per-domain frequency cap applied via recentDomainCounts.
    domainsForRound = selectDiverseDomains(knowledgeBase, count, recentDomainCounts);
  }

  const domainDifficultyOverrides = preferences.difficulty === 'adaptive'
    ? await getDomainDifficultyOverrides(userId, domainsForRound).catch(() => undefined)
    : undefined;

  const subAnglesByDomain = await getRecentSubAnglesByDomain(userId, domainsForRound).catch(() => undefined);

  // Try to fill any accessible-difficulty slots from the cross-user bank
  // (previously-generated questions for the same domain) before burning
  // fresh Sonnet calls. The bank only ever returns rows the viewer hasn't
  // seen — empty bank for a domain falls through to LLM generation, which
  // incidentally adds new accessible rows back into the pool.
  const bankPicks = await pickBankPicksForAccessibleDomains(
    userId,
    domainsForRound,
    preferences.difficulty,
    domainDifficultyOverrides,
    adaptiveLevel,
    previousFactKeys,
  );

  const bankFilledDomains = new Set(bankPicks.map((row) => row.canonicalSubcategory));
  const domainsForLlm = domainsForRound.filter((d) => !bankFilledDomains.has(d));
  const remainingCount = count - bankPicks.length;

  let llmGenerated: GeneratedQuestionRow[] = [];
  if (remainingCount > 0 && domainsForLlm.length > 0) {
    llmGenerated = await generateDailyQuestions(
      domainsForLlm,
      remainingCount,
      userId,
      previousQuestionTexts,
      [],
      undefined,
      preferences.difficulty,
      domainDifficultyOverrides,
      adaptiveLevel,
      previousFactKeys,
      subAnglesByDomain,
    );
  }

  return [...bankPicks, ...llmGenerated];
}

function resolvesToAccessible(
  domain: string,
  difficultyPreference: string | undefined,
  overrides: ReadonlyMap<string, string> | undefined,
  adaptiveLevel: number | null,
): boolean {
  if (!difficultyPreference) return false;
  if (difficultyPreference === 'normal') return true;
  if (difficultyPreference === 'adaptive') {
    const override = overrides?.get(domain);
    if (override === 'normal') return true;
    if (override === 'moderate' || override === 'challenging') return false;
    return (adaptiveLevel ?? 1) < 1.5;
  }
  return false;
}

async function pickBankPicksForAccessibleDomains(
  userId: string,
  domains: string[],
  difficultyPreference: string | undefined,
  domainDifficultyOverrides: ReadonlyMap<string, string> | undefined,
  adaptiveLevel: number | null,
  previousFactKeys: AvoidFactKeyEntry[],
): Promise<GeneratedQuestionRow[]> {
  const avoidFactKeys = new Set(previousFactKeys.map((entry) => entry.factKey));
  const picks: GeneratedQuestionRow[] = [];
  const expiresAt = getNextDailyResetBoundary();

  for (const domain of domains) {
    if (!resolvesToAccessible(domain, difficultyPreference, domainDifficultyOverrides, adaptiveLevel)) {
      continue;
    }
    const source = await pickAccessibleBankSource(userId, domain, avoidFactKeys).catch(() => null);
    if (!source) continue;
    if (isGenericSubcategory(source.canonicalSubcategory)) continue;

    try {
      const [row] = await db
        .insert(generatedQuestions)
        .values({
          userId,
          canonicalSubcategory: source.canonicalSubcategory,
          broadCategory: source.broadCategory,
          questionText: source.questionText,
          answer: source.answer,
          explainer: source.explainer,
          difficultyEstimate: source.difficultyEstimate,
          basePoints: source.basePoints,
          factKey: source.factKey,
          subAngles: source.subAngles,
          expiresAt,
          usedInQueue: false,
        })
        .returning();
      picks.push(row);
      avoidFactKeys.add(source.factKey);
      console.info('[daily/generate-questions] bank-pick used', {
        domain,
        factKey: source.factKey,
      });
    } catch (err) {
      console.warn('[daily/generate-questions] bank-pick insert failed; falling back to LLM', {
        domain,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return picks;
}
