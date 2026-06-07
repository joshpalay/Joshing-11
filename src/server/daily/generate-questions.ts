import {
  ANTHROPIC_MODEL,
  GENERATION_TIMEOUT_MS,
  HAIKU_GATE_TIMEOUT_MS,
  HAIKU_MODEL,
  INSTRUCTION_USER_INPUT_GUIDANCE,
  extractTextContent,
  generateInsideJoke,
  getAnthropicClient,
  loggedMessagesCreate,
  parseJsonObject,
  wrapUserInput,
} from '@/lib/llm';
import { getNextDailyResetBoundary } from '@/lib/games/timezone';
import { db, generatedQuestions } from '@/server/db';
import { embedAndResolveDuplicate } from '@/server/pool/dedup';
import {
  getDomainDifficultyOverrides,
  mapAdaptiveLevelToDifficultyHint,
  updateAdaptiveLevel,
} from '@/server/adaptive-difficulty';
import {
  getAuthoredQuestionTexts,
  getKnowledgeBase,
  getRecentDailyQuestionTexts,
  getRecentDomainCounts,
  getRecentFactKeys,
  getRecentSubAnglesByDomain,
  normalizeQuestionText,
  pickBankSource,
  type BankDifficulty,
  type RecentDailyQuestionEntry,
  type RecentFactKeyEntry,
} from '@/server/db/queries/daily';
import { getDailyPreferences } from '@/server/db/queries/daily-preferences';
import { getActiveDeclaredInterests } from '@/server/db/queries/declared-interests';
import { planFirstRunDomains } from '@/server/daily/first-run-seeding';
import { reconcileProposedDomain } from '@/lib/questions/categorization';
import { isGenericCanonicalAnswer, normalizeCanonicalAnswerLabel } from '@/server/answers/canonical-answer';
import { isGenericSubcategory } from '@/server/questions/canonical-subcategory';
import { normalizeFactKey } from '@/server/questions/fact-key';
import { textContainsAnswer } from '@/server/questions/self-answering';
import { resolveDailyBasePoints } from './types';
import { STYLE_EXEMPLAR_BLOCK } from './exemplars';
import { askToAnswerBatch, resolveMachineTrustTier } from './ask-to-answer';

// Cap the recent question-text block at this many entries inside the prompt.
// The full recent history (up to 200) is still used to derive the fact-key
// avoid set; only this slice is shown verbatim to stay within a reasonable
// token budget.
const RECENT_QUESTION_TEXT_LIMIT = 80;
// Cap the recent fact-key block at this many entries inside the prompt.
const RECENT_FACT_KEY_LIMIT = 200;
// How many of the viewer's most-recent AUTHORED questions to seed into the +2
// bonus Sonnet avoid list. Bounded so a prolific author doesn't flush the
// recent-GENERATED dedup signal out of the RECENT_QUESTION_TEXT_LIMIT /
// history-gate windows. The bank pick guards against the FULL authored set
// separately (avoidAuthoredTexts), so the literal-reuse path stays fully covered.
const AUTHORED_AVOID_TEXT_LIMIT = 40;

export type GeneratedQuestionRow = typeof generatedQuestions.$inferSelect;

export const SYSTEM_PROMPT = `You are generating trivia questions for Joshing, a social trivia game played among friends.
Questions must be:
- Factual with a single objectively correct answer, or — for the "name_multiple" shape only — a small fixed set of correct answers (typically 2–4)
- Drawn from the intellectual and cultural world of the domain, not biographical trivia
- Calibrated to the difficulty instruction below: at easier tiers, lean on well-known, recognizable facts that anyone interested in the domain would have encountered; save specific, surprising deep cuts for higher difficulty tiers
- Recall questions, not selection questions: the player must produce the answer from memory

NEVER generate multiple-choice questions. Do not list candidate answers inside the question_text, and do not use phrasings like "Which of the following…", "is it X, Y, or Z?", or "— A, B, or C?". The question must stand alone as an open-ended prompt; the player writes a free-text answer.

NEVER name the answer in the question_text. The answer (or a near-paraphrase of it) must not appear anywhere in the setup — if the very term you are asking the player to produce shows up in your own phrasing, the question gives itself away. Rephrase so it doesn't. E.g. do NOT ask "what term describes the mental model a user forms…" when the answer is "mental model".

BAD (multiple-choice phrasing — never produce these):
- "Which of the following best describes Sally — a romantic rival, a radical free spirit, or a steadying maternal figure?"
- "Was the symphony premiered in 1888, 1893, or 1901?"

GOOD (open recall):
- "What does Sally Seton represent to the young Clarissa in Mrs. Dalloway?"
- "What does the madeleine awaken in the narrator of In Search of Lost Time?"

TRIVIA-OF-TRIVIA RULE:
Prefer questions of substance — "what is X", "what does X mean", "why does X matter", "who did X" — over questions of mere recall — "what year", "what number", "what label". A date, a count, or a name is worth asking only when that specific fact is itself meaningful; a question that lands on substance is almost always the better question. Lead with the idea, not the index card.

FAN-SALIENCE RULE (Rule 1 — tier-dependent):
Do NOT default to the most nameable entity in a work — the character roster, the title, the principal location. Those are wiki-salient (easy to look up, dull to be asked). Chase fan-salient facts instead: the thing a devoted fan of THIS specific work would be delighted to be recognized for knowing — the rewatch-catch, the running joke, the exact wording of a famous line, the specific beat or object fans hold onto. Apply by difficulty tier:
- specialist and moderate: the question MUST clear fan-salience. A generic "name the entity" question is a FAILURE at these tiers, even if factually correct.
- accessible: fan-salience is PREFERRED but NOT required. Easy facts are allowed to stay simple — forcing delight onto a trivially easy fact produces strained, contorted questions. An accessible question need only clear Rule 2 below. Do not make accessible questions harder to satisfy this rule.

STRIP-THE-DOMAIN TEST (Rule 2 — hard floor, ALL tiers including accessible):
Before emitting, mentally remove the work's title from the question. If what remains could appear in any generic trivia app, the question is too generic — revise it. The angle, not just the subject, must be specific to the work.
- PASSES: "In American Psycho, what color is Paul Allen's business card?" — strip the title and the angle is still specific to the work.
- FAILS: "In Gilmore Girls, what is the name of Rory's first boyfriend?" — strip the title and it is generic teen-romance trivia.

ONE CLEAN ANSWER (Rule 3 — ALL tiers):
The answer must be a single short, checkable response — a name, a title, a word, a short phrase. NEVER a sentence or paragraph that explains the answer. If the natural answer is explanatory (e.g. "he understands the language of birds"), re-aim the question so the answer is crisp (e.g. ask what specific ability the potion grants → "birdsong"). Paragraph-length answers grade unpredictably and must not be produced. (This sharpens, but does not relax, the single-answer factual-recall and no-answer-leak rules above — a cleverer setup still must not name its own answer.)

CALIBRATION PAIRS (generic → fan-salient; study these — concrete pairs calibrate harder than abstract principles):
- BAD (generic, roster): "In Gilmore Girls, what is the name of Lorelai's dog?" → GOOD (fan-salient, same answer): "Lorelai names her dog after a Canadian crooner — a running gag, since the real musician also haunts her dreams. What's the dog called?" → "Paul Anka"
- BAD (generic location): "In what city is the Dragonfly Inn located?" → GOOD (accessible, clears strip-the-domain): "Lorelai and Sookie's inn shares the town's quirk of naming businesses after insects. What's it called?" → "the Dragonfly Inn"
- BAD (generic, title): "In American Psycho, what is the protagonist's name?" → GOOD (specialist, fan-salient): "In American Psycho, what color is Paul Allen's business card?" → "bone"
- BAD (paragraph answer): "What does Siegfried gain after tasting the dragon's blood?" → "He suddenly understands the language of the birds." → GOOD (one clean answer): "After tasting Fafner's blood, Siegfried can suddenly understand the song of which creatures?" → "birds"
- GOOD reference (already on-target, specialist): the unproduced Dungeons & Dragons animated finale that fans still trade the script of → "Requiem"

STYLE EXEMPLARS (match this register, specificity, and concision):
These are gold-standard Joshing questions. Mimic their tone — literate, confident, and specific. Pull from comparable depth (named characters, named works, technical terms, specific years, named figures) rather than vague appreciation or "explain why" questions. Notice how they assume a cultured audience without condescension.

${STYLE_EXEMPLAR_BLOCK}

Do NOT copy these questions or their underlying facts. Use them only as a model for how a Joshing question should feel.

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
- "year_or_date": asks for a year, date, or temporal ordering. Use ONLY when the date itself is meaningful — a turning point, an anniversary, a deliberate juxtaposition — never as a default or filler in place of a substance question (e.g. "In what year did the Berlin Wall fall?")
- "in_which_work": asks which work, scene, chapter, movement, or section something appears in
- "who_did_what": asks which character/person performs a specific act (e.g. "Who kills Polonius?")
- "sequence_or_order": asks for ordering of events, items, or steps
- "technique_or_term": asks for the technical term for a described concept (e.g. "What is it called when Venice floods?")
- "what_happens_next": asks what immediately follows a described scene/event
- "fill_in_blank": gives a short line with one word elided and asks the player to supply it (e.g. "Fill in the blank in this line from Don Giovanni: Don Giovanni a …… teco")
- "complete_the_quote": gives the opening of a well-known quote and asks for the remainder (e.g. "Complete the Shakespeare quote: 'A horse, a horse, ……'")
- "name_multiple": asks for a small fixed set of items — only use when the canonical answer is a closed enumeration of 2–4 items (e.g. "Name the four operas that make up Wagner's Ring Cycle."). For this shape, emit the canonical answers in the "answer" field as a semicolon-delimited list (e.g. "Das Rheingold; Die Walküre; Siegfried; Götterdämmerung"). NOTE: do not emit "name_multiple" until further notice — the grading path does not yet handle multi-answer questions. Choose another shape instead.

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
      "question_shape": "one of: identification | year_or_date | in_which_work | who_did_what | sequence_or_order | technique_or_term | what_happens_next | fill_in_blank | complete_the_quote | name_multiple (held back — do not emit)"
    }
  ]
}${INSTRUCTION_USER_INPUT_GUIDANCE}`;

const QUESTION_SHAPES = [
  'identification',
  'year_or_date',
  'in_which_work',
  'who_did_what',
  'sequence_or_order',
  'technique_or_term',
  'what_happens_next',
  'fill_in_blank',
  'complete_the_quote',
  'name_multiple',
] as const;
type QuestionShape = (typeof QUESTION_SHAPES)[number];

function asQuestionShape(value: unknown): QuestionShape | null {
  return typeof value === 'string' && (QUESTION_SHAPES as readonly string[]).includes(value)
    ? (value as QuestionShape)
    : null;
}

export type LlmQuestion = {
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

type TerritoryType = 'declared' | 'demonstrated';

export function buildUserPrompt(
  domains: string[],
  count: number,
  prev: AvoidQuestionEntry[],
  prevFactKeys: AvoidFactKeyEntry[],
  domainSkips: ReadonlyMap<string, number> | undefined,
  difficultyPreference?: string,
  domainDifficultyOverrides?: ReadonlyMap<string, string>,
  adaptiveLevel?: number | null,
  subAnglesByDomain?: ReadonlyMap<string, string[]>,
  domainTerritoryTypes?: ReadonlyMap<string, TerritoryType>,
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

  // Territory register (PRD-D-5 §5.2). A DECLARED domain is one the player chose
  // — they hold a floor at the engaged-fan rung, so questions must read for
  // someone who actively follows it, never tourist-level recognition trivia. A
  // DEMONSTRATED domain surfaced from play; meet a newcomer at an accessible
  // register and let depth climb. This mirrors the floor the difficulty mapper
  // already applies, so the prose register and the target rate stay aligned.
  let territoryHint = '';
  if (domainTerritoryTypes && domainTerritoryTypes.size > 0) {
    const declaredDomains = domains.filter((d) => domainTerritoryTypes.get(d) === 'declared');
    const introducedDomains = domains.filter((d) => domainTerritoryTypes.get(d) === 'demonstrated');
    const lines: string[] = [];
    if (declaredDomains.length > 0) {
      lines.push(`- DECLARED (the player chose to learn these — write for an engaged enthusiast who actively follows the domain; assume real familiarity and never ask tourist-level "who composed it" recognition trivia): ${declaredDomains.join(', ')}`);
    }
    if (introducedDomains.length > 0) {
      lines.push(`- INTRODUCED (surfaced from the player's activity — meet a curious newcomer at an accessible register and let difficulty climb with play): ${introducedDomains.join(', ')}`);
    }
    if (lines.length > 0) {
      territoryHint = `\n\nDomain familiarity:\n${lines.join('\n')}`;
    }
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

  return `${domainSection}${calibration}${difficultyHint}${territoryHint}${subAnglesHint}

Previously generated questions to avoid repeating (do not re-ask any of these facts, even rephrased). Each entry is prefixed with [<source domain>]. The user's domains may overlap in subject matter — for example, a fact about Mrs. Dalloway already asked under "Virginia Woolf's Novels and Essays" is still off limits when generating for "Mrs. Dalloway", and vice versa. A fact already covered under ANY of the user's domains must not be re-asked under ANY domain:
${wrapUserInput('recent_questions', prevBlock)}

Fact keys already covered for this user (do not produce any question whose fact_key matches one of these). Each entry is prefixed with [<source domain>] for the same cross-domain reason:
${wrapUserInput('recent_fact_keys', factKeyBlock)}`;
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

// Parse a single question object from the model's JSON array into the validated
// LlmQuestion shape, or null if it fails the structural / generic-label guards.
// Shared by parseQuestions (per-user path) and parseGroundedQuestions (the B3
// retrieval batch path) so both honour exactly the same field contract.
function parseBaseQuestion(item: unknown): LlmQuestion | null {
  if (!item || typeof item !== 'object') return null;
  const rec = item as Record<string, unknown>;
  const canonical = asString(rec.canonical_subcategory);
  const broad = asString(rec.broad_category);
  const questionText = asString(rec.question_text);
  const answer = asString(rec.answer);
  const explainer = asString(rec.explainer);
  const difficulty = asDifficulty(rec.difficulty_estimate);
  if (!canonical || !broad || !questionText || !answer || !explainer || !difficulty) {
    return null;
  }
  if (isGenericCanonicalAnswer(answer)) {
    return null;
  }
  // Reject LLM responses that pick a bucket-level subcategory ("general",
  // "general knowledge", "trivia", etc.) — those questions are not tied
  // to any of the user's declared/demonstrated domains and must not be
  // served. This is the upstream guard on the generated_questions write
  // boundary; the LLM is told to use the exact domain it was given, so
  // anything generic here is a prompt violation we discard.
  if (isGenericSubcategory(canonical)) {
    return null;
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
  return {
    canonical_subcategory: canonical,
    broad_category: broad,
    question_text: questionText,
    answer: normalizeCanonicalAnswerLabel(answer),
    explainer,
    difficulty_estimate: difficulty,
    fact_key: factKey,
    sub_angles: normalizeSubAngles(rec.sub_angles),
    question_shape: asQuestionShape(rec.question_shape),
  };
}

function parseQuestions(raw: string): LlmQuestion[] {
  const parsed = parseJsonObject(raw);
  if (!parsed) return [];
  const rawList = parsed.questions;
  if (!Array.isArray(rawList)) return [];

  const result: LlmQuestion[] = [];
  for (const item of rawList) {
    const question = parseBaseQuestion(item);
    if (question) result.push(question);
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

If there are no duplicates, return { "duplicate_indices": [] }.${INSTRUCTION_USER_INPUT_GUIDANCE}`;

async function findBatchDuplicates(questions: LlmQuestion[]): Promise<Set<number>> {
  if (questions.length < 2) return new Set();
  const client = getAnthropicClient();
  if (!client) return new Set();

  const body = questions
    .map(
      (q, i) =>
        `[${i}] domain=${q.canonical_subcategory}\n    q=${q.question_text}\n    a=${q.answer}`,
    )
    .join('\n\n');
  const userMessage = wrapUserInput('batch', body);

  try {
    const response = await loggedMessagesCreate(client, 'batch-dedupe', {
      model: HAIKU_MODEL,
      max_tokens: 200,
      temperature: 0,
      system: BATCH_DEDUPE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }, { timeoutMs: HAIKU_GATE_TIMEOUT_MS });
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

The following styles are explicitly ACCEPTABLE and must NOT be flagged on style grounds alone — fill-in-the-blank, complete-the-quote, name-multiple, and concise idiomatic questions all belong in Joshing. Reference exemplars:

${STYLE_EXEMPLAR_BLOCK}

Only flag a question matching one of those styles if it independently exhibits ANSWER_LEAKED, OPINION_OR_VAGUE, FALSE_PREMISE, or SELF_ANSWERING.

Return JSON only:
{ "drop_indices": [list of zero-based indices to drop], "reasons": { "<index>": "<short reason>" } }

If no questions are defective, return { "drop_indices": [], "reasons": {} }.${INSTRUCTION_USER_INPUT_GUIDANCE}`;

async function findQualityFailures(generated: LlmQuestion[]): Promise<{
  toDrop: Set<number>;
  reasons: Record<number, string>;
}> {
  if (generated.length === 0) return { toDrop: new Set(), reasons: {} };
  const client = getAnthropicClient();
  if (!client) return { toDrop: new Set(), reasons: {} };

  const body = generated
    .map(
      (q, i) =>
        `[${i}] domain=${q.canonical_subcategory}\n    q=${q.question_text}\n    a=${q.answer}`,
    )
    .join('\n\n');
  const userMessage = wrapUserInput('batch', body);

  try {
    const response = await loggedMessagesCreate(client, 'quality-gate', {
      model: HAIKU_MODEL,
      max_tokens: 500,
      temperature: 0,
      system: QUALITY_GATE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }, { timeoutMs: HAIKU_GATE_TIMEOUT_MS });
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

// Factual-correctness gate. The dedup and quality gates above never check
// whether the *stated answer is actually correct for the question* — they
// only catch repeats, leaks, vagueness, and false premises in the setup. A
// generator hallucination that pairs a good question with the wrong answer
// (e.g. asking who wrote "Rubyfruit Jungle" but answering with a politician)
// sails straight through. User-authored questions get this check via
// vetQuestion() on the /api/questions path; bot-generated daily questions
// had no equivalent until this gate. Like the others it is batch-based,
// runs in parallel, and fails open.
const FACTUAL_GATE_SYSTEM_PROMPT = `You are fact-checking a small batch of just-generated trivia questions before they are served to a player. Each item has a question and the stated answer the game will mark as correct. Your only job is to catch questions whose stated answer is WRONG.

For each question decide:
- WRONG — the stated answer is factually incorrect for the question, OR the question's clearly-correct answer is a different thing/person than the stated answer, OR the question and answer come from mismatched subjects (e.g. a literature question answered with an unrelated political figure).
- OK — the stated answer is correct, or a reasonable equivalent/alternate form of the correct answer.
- UNVERIFIABLE — you genuinely cannot verify the fact (extremely niche, recent, or personal). Treat these as OK; do NOT flag them.

Flag (drop) ONLY questions you judge WRONG with high confidence. A high bar applies — when in doubt, leave it. Do not flag for style, difficulty, phrasing, or ambiguity; only for a factually incorrect stated answer.

Return JSON only:
{ "drop_indices": [list of zero-based indices whose stated answer is wrong], "reasons": { "<index>": "<short reason naming the correct answer>" } }

If no answers are wrong, return { "drop_indices": [], "reasons": {} }.${INSTRUCTION_USER_INPUT_GUIDANCE}`;

export function parseFactualGateResponse(
  raw: string,
  batchSize: number,
): { toDrop: Set<number>; reasons: Record<number, string> } {
  const parsed = parseJsonObject(raw);
  const toDrop = new Set<number>();
  const reasons: Record<number, string> = {};
  if (!parsed) return { toDrop, reasons };

  const rawList = parsed.drop_indices;
  if (Array.isArray(rawList)) {
    for (const value of rawList) {
      if (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 0 &&
        value < batchSize
      ) {
        toDrop.add(value);
      }
    }
  }

  const rawReasons = parsed.reasons;
  if (rawReasons && typeof rawReasons === 'object' && !Array.isArray(rawReasons)) {
    for (const [key, value] of Object.entries(rawReasons as Record<string, unknown>)) {
      const idx = Number.parseInt(key, 10);
      if (Number.isInteger(idx) && toDrop.has(idx) && typeof value === 'string') {
        reasons[idx] = value.slice(0, 200);
      }
    }
  }

  return { toDrop, reasons };
}

async function findFactualFailures(generated: LlmQuestion[]): Promise<{
  toDrop: Set<number>;
  reasons: Record<number, string>;
}> {
  if (generated.length === 0) return { toDrop: new Set(), reasons: {} };
  const client = getAnthropicClient();
  if (!client) return { toDrop: new Set(), reasons: {} };

  const body = generated
    .map(
      (q, i) =>
        `[${i}] domain=${q.canonical_subcategory}\n    q=${q.question_text}\n    a=${q.answer}`,
    )
    .join('\n\n');
  const userMessage = wrapUserInput('batch', body);

  try {
    const response = await loggedMessagesCreate(client, 'factual-gate', {
      model: HAIKU_MODEL,
      max_tokens: 500,
      temperature: 0,
      system: FACTUAL_GATE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }, { timeoutMs: HAIKU_GATE_TIMEOUT_MS });
    return parseFactualGateResponse(extractTextContent(response.content), generated.length);
  } catch (err) {
    // Fail open: a Haiku outage should not block the daily queue. A wrong
    // answer slipping through is no worse than the pre-gate status quo.
    console.warn('[daily/generate-questions] factual gate failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { toDrop: new Set(), reasons: {} };
  }
}

// Deterministic answer-leak gate. The Haiku quality gate above lists
// ANSWER_LEAKED / SELF_ANSWERING among the defects it looks for, but it is an
// LLM check that fails open on a Haiku outage and misses subtle lexical leaks
// (e.g. "the mental model a user forms" with answer "Mental model"). User-
// authored questions already get a fail-closed string check via
// textContainsAnswer() at create time; this gives daily-generated questions the
// same fallback. It is pure (no LLM, no DB) so it cannot fail open. Only
// question_text is checked — the explainer is *supposed* to contain the answer.
export function findAnswerLeaks(generated: LlmQuestion[]): {
  toDrop: Set<number>;
  reasons: Record<number, string>;
} {
  const toDrop = new Set<number>();
  const reasons: Record<number, string> = {};
  for (let i = 0; i < generated.length; i += 1) {
    const q = generated[i];
    if (textContainsAnswer(q.question_text, q.answer)) {
      toDrop.add(i);
      reasons[i] = `answer "${q.answer}" appears in question text`.slice(0, 200);
    }
  }
  return { toDrop, reasons };
}

const RECENT_HISTORY_GATE_LIMIT = 30;

const RECENT_HISTORY_GATE_SYSTEM_PROMPT = `You are reviewing newly-generated trivia questions against a list of questions this same user has already been asked. For each NEW question, decide whether it probes the same underlying fact as ANY of the RECENT questions.

Two questions probe the same fact if they would test the same answer about the same subject under the same angle, regardless of wording. The user's domains may overlap (e.g. a fact about Mrs. Dalloway may appear under either "Mrs. Dalloway" or "Virginia Woolf's Novels and Essays") — overlap across domains still counts as a duplicate.

Return JSON only:
{ "duplicate_indices": [list of NEW indices that duplicate any RECENT entry] }

If no NEW question duplicates a RECENT one, return { "duplicate_indices": [] }.${INSTRUCTION_USER_INPUT_GUIDANCE}`;

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
${wrapUserInput('recent', recentBlock)}

NEW (just generated, indexed):
${wrapUserInput('new_batch', newBlock)}

Which NEW indices duplicate any RECENT entry?`;

  try {
    const response = await loggedMessagesCreate(client, 'history-dedupe', {
      model: HAIKU_MODEL,
      max_tokens: 200,
      temperature: 0,
      system: RECENT_HISTORY_GATE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }, { timeoutMs: HAIKU_GATE_TIMEOUT_MS });
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

// Max questions requested per Sonnet call. The generator caps each response at
// 2000 output tokens (~33s at Sonnet's output rate, sized to fit the 90s live
// route with a retry). A full question with explainer is ~300-400 tokens, so a
// single call for more than ~5 overflows the cap: the JSON truncates mid-array,
// parseQuestions returns [], and the queue fails (prod 2026-05-30 — an
// over-provisioned no-authored user requested 10 and hit generatedRaw:0). Three
// questions (~1100 tokens, ~18s) leave comfortable headroom under both limits;
// larger batches are split into parallel chunks so wall-clock stays at one chunk.
const GENERATION_CHUNK_SIZE = 3;

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
  domainTerritoryTypes?: ReadonlyMap<string, TerritoryType>,
): Promise<LlmQuestion[]> {
  const client = getAnthropicClient();
  if (!client) return [];

  // SYSTEM_PROMPT is ~1500 tokens — above the 1024-token Sonnet cache
  // threshold. The cron fans out with USER_CONCURRENCY=4, so concurrent
  // batches hit the cache. The 5-min TTL means later sequential batches
  // miss, but the concurrent slice is worth the surcharge.
  const response = await loggedMessagesCreate(client, 'generate-questions', {
    model: ANTHROPIC_MODEL,
    max_tokens: 2000,
    temperature: 0.8,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
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
          domainTerritoryTypes,
        ),
      },
    ],
  }, { timeoutMs: GENERATION_TIMEOUT_MS });

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
  domainTerritoryTypes?: ReadonlyMap<string, TerritoryType>,
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

  // One Sonnet call per chunk, run concurrently. callLlmOnce caps output at
  // 2000 tokens; keeping each request <= GENERATION_CHUNK_SIZE keeps the reply
  // well short of that cap (no truncation) and well under the 35s timeout, so
  // we can over-generate to absorb the gate drop rate without any single call
  // failing. Because the chunks run in parallel, total latency is one chunk,
  // not the sum — a batch of 9 is three ~18s calls finishing together, not 54s.
  const runChunk = async (chunkDomains: string[], chunkCount: number): Promise<LlmQuestion[]> => {
    try {
      const out = await callLlmOnce(
        chunkDomains,
        chunkCount,
        avoidList,
        previousFactKeys,
        domainSkips,
        difficultyPreference,
        domainDifficultyOverrides,
        adaptiveLevel,
        subAnglesByDomain,
        domainTerritoryTypes,
      );
      if (out.length > 0) return out;
      console.warn('[daily/generate-questions] chunk returned no usable questions, retrying', {
        chunkCount,
      });
      return await callLlmOnce(
        chunkDomains,
        chunkCount,
        avoidList,
        previousFactKeys,
        domainSkips,
        difficultyPreference,
        domainDifficultyOverrides,
        adaptiveLevel,
        subAnglesByDomain,
        domainTerritoryTypes,
      );
    } catch (err) {
      // A single chunk failing (timeout / aborted) must not sink the batch —
      // the other chunks still return usable questions, and the queue
      // orchestrator's top-up + graceful-degrade absorb the shortfall.
      console.warn('[daily/generate-questions] chunk failed, dropping it', {
        chunkCount,
        error: err instanceof Error ? err.message : 'unknown',
      });
      return [];
    }
  };

  // Partition the request into chunks while preserving buildUserPrompt's domain
  // contract. In 1:1 mode (domains.length === count, one question per listed
  // domain) the domain list is sliced so each chunk still has domains.length
  // === count and the per-domain prompt branch fires. In pool mode every chunk
  // gets the full domain list with a sub-count.
  const chunkSpecs: Array<{ domains: string[]; count: number }> = [];
  if (domains.length === count) {
    for (let i = 0; i < domains.length; i += GENERATION_CHUNK_SIZE) {
      const slice = domains.slice(i, i + GENERATION_CHUNK_SIZE);
      chunkSpecs.push({ domains: slice, count: slice.length });
    }
  } else {
    for (let remaining = count; remaining > 0; remaining -= GENERATION_CHUNK_SIZE) {
      chunkSpecs.push({ domains, count: Math.min(GENERATION_CHUNK_SIZE, remaining) });
    }
  }

  const chunkResults = await Promise.all(
    chunkSpecs.map((spec) => runChunk(spec.domains, spec.count)),
  );
  let generated: LlmQuestion[] = chunkResults.flat();

  if (generated.length === 0) return [];

  // Four LLM gates run against the same input batch, then the drop sets are
  // unioned (the deterministic findAnswerLeaks gate runs synchronously after).
  // Sequential awaits would multiply the gate-phase latency for no benefit —
  // none of the gates depend on each other's verdicts.
  //
  // - findBatchDuplicates: catches intra-batch dupes (e.g. two Proprietor
  //   questions in one call on 2026-05-20). Persist-time fact_key guard only
  //   catches these when both rows have non-null fact_keys, historically rare.
  // - findRecentHistoryDuplicates: enforces semantic dedup against the last
  //   RECENT_HISTORY_GATE_LIMIT questions. The prompt-level avoid list is
  //   advisory; this is the actual enforcement boundary. Older history is
  //   covered by fact_key dedup at persist time.
  // - findQualityFailures: LLM-generated counterpart to critiqueQuestion() —
  //   catches answer-leakage, opinion/vague, false-premise, self-answering.
  // - findFactualFailures: verifies the stated answer is actually correct for
  //   the question — the one defect class the other gates never inspect.
  // - findAnswerLeaks (below, synchronous): deterministic fail-closed backstop
  //   for answer leakage when the Haiku quality gate misses or fails open.
  const recentForGate = avoidList.slice(0, RECENT_HISTORY_GATE_LIMIT);
  const [batchDuplicates, recentDuplicates, qualityResult, factualResult] = await Promise.all([
    findBatchDuplicates(generated),
    findRecentHistoryDuplicates(generated, recentForGate),
    findQualityFailures(generated),
    findFactualFailures(generated),
  ]);

  if (batchDuplicates.size > 0) {
    console.warn('[daily/generate-questions] dropping intra-batch duplicates', {
      droppedCount: batchDuplicates.size,
      droppedIndices: [...batchDuplicates].sort((a, b) => a - b),
      originalCount: generated.length,
    });
  }
  if (recentDuplicates.size > 0) {
    console.warn('[daily/generate-questions] dropping recent-history duplicates', {
      droppedCount: recentDuplicates.size,
      droppedIndices: [...recentDuplicates].sort((a, b) => a - b),
      originalCount: generated.length,
    });
  }
  if (qualityResult.toDrop.size > 0) {
    console.warn('[daily/generate-questions] dropping low-quality questions', {
      droppedCount: qualityResult.toDrop.size,
      droppedIndices: [...qualityResult.toDrop].sort((a, b) => a - b),
      reasons: qualityResult.reasons,
      originalCount: generated.length,
    });
  }
  if (factualResult.toDrop.size > 0) {
    console.warn('[daily/generate-questions] dropping factually-wrong questions', {
      droppedCount: factualResult.toDrop.size,
      droppedIndices: [...factualResult.toDrop].sort((a, b) => a - b),
      reasons: factualResult.reasons,
      originalCount: generated.length,
    });
  }

  // Deterministic fallback for the answer-leak case the Haiku quality gate can
  // miss or fail open on. Synchronous, so it runs after the Promise.all rather
  // than inside it.
  const answerLeaks = findAnswerLeaks(generated);
  if (answerLeaks.toDrop.size > 0) {
    console.warn('[daily/generate-questions] dropping answer-leaking questions', {
      droppedCount: answerLeaks.toDrop.size,
      droppedIndices: [...answerLeaks.toDrop].sort((a, b) => a - b),
      reasons: answerLeaks.reasons,
      originalCount: generated.length,
    });
  }

  const allDrops = new Set<number>([
    ...batchDuplicates,
    ...recentDuplicates,
    ...qualityResult.toDrop,
    ...factualResult.toDrop,
    ...answerLeaks.toDrop,
  ]);
  if (allDrops.size > 0) {
    generated = generated.filter((_, i) => !allDrops.has(i));
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

  // Precompute the "between us" aside once per question, in parallel, before the
  // sequential persist loop. generateInsideJoke fails open (returns null), so a
  // slow/failed aside never blocks question generation — it just lands with no
  // aside. Mirrors the parallel/fail-open pattern of the LLM gates above.
  const toPersist = generated.slice(0, count);
  const insideJokeByQuestion = new Map<(typeof toPersist)[number], string | null>();
  // Ask-to-answer gate (B4 Phase 1): strip the answer and ask a separate cold
  // solver; a question whose cold answers contradict the stored answer is dropped,
  // one they corroborate earns machine_verified. Runs in parallel with the aside
  // precompute; fails open (drops/verifies nothing on an LLM outage). Scoped to
  // the rows we will actually persist rather than the full generated batch.
  const [, askResult] = await Promise.all([
    Promise.all(
      toPersist.map(async (question) => {
        const aside = await generateInsideJoke({
          questionText: question.question_text,
          correctAnswer: question.answer,
          broadCategory: question.broad_category,
          canonicalSubcategory: question.canonical_subcategory,
        }).catch(() => null);
        insideJokeByQuestion.set(question, aside);
      }),
    ),
    askToAnswerBatch(
      toPersist.map((q) => ({ questionText: q.question_text, answer: q.answer })),
    ),
  ]);
  if (askResult.toDrop.size > 0) {
    console.warn('[daily/generate-questions] dropping ask-to-answer failures', {
      droppedCount: askResult.toDrop.size,
      droppedIndices: [...askResult.toDrop].sort((a, b) => a - b),
      reasons: askResult.reasons,
      originalCount: toPersist.length,
    });
  }

  for (let persistIndex = 0; persistIndex < toPersist.length; persistIndex += 1) {
    const question = toPersist[persistIndex];
    // Drop ask-to-answer failures: the cold solver contradicted the stored answer.
    if (askResult.toDrop.has(persistIndex)) continue;

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
    // Trust tier (B4 Phase 1 / §6): ask-to-answer corroboration promotes to
    // machine_verified. This non-grounded path has no retrieval corroboration,
    // so the tier hinges on the ask-to-answer verdict; an unevaluated row (gate
    // disabled or failed open) stays unverified.
    const askToAnswerVerified = askResult.verified.has(persistIndex);
    const trustTier = resolveMachineTrustTier({ askToAnswerVerified, corroborated: false });
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
        insideJoke: insideJokeByQuestion.get(question) ?? null,
        trustTier,
        askToAnswerVerified,
        acceptableVariants: askResult.variantsByIndex.get(persistIndex) ?? [],
        expiresAt,
        usedInQueue: false,
      })
      .returning();
    persisted.push(row);

    // Semantic-dedup backstop (B1 pool substrate). Best-effort and no-op without
    // VOYAGE_API_KEY, so it never blocks generation; the fact_key/Haiku/text
    // guards above remain the cheap first pass. A new machine row that collides
    // with an existing pool question is flagged is_duplicate (never deleted), so
    // pickBankSource stops serving it.
    await embedAndResolveDuplicate({ id: row.id, origin: 'machine', questionText: row.questionText });
  }

  return persisted;
}

const DECLARED_DOMAIN_WEIGHT = 0.5;
const DOMAIN_PER_WEEK_CAP = 5;

/**
 * Order a custom-mode domain list least-recently-generated first.
 *
 * Custom mode never drops a hand-picked domain (no weekly cap), but a narrow
 * set often skews to a few deep domains the player loves (e.g. Shakespearean
 * Tragedy, Wagner's Ring Cycle). The pool-mode generation prompt lets the model
 * choose which listed domains to use, so it gravitates to those meaty domains
 * and ignores the thinner picks — whose facts then get exhausted by the
 * recent-history / fact-key dedup gates, landing the batch short while the fresh
 * picks (which would survive the gates) never get drawn. Leading with the
 * least-mined domains steers both generation and the in-order bank-pick pass
 * toward the picks that still have unseen facts.
 *
 * Stable for equal counts (Array.prototype.sort is stable), so ties preserve the
 * user's original selection order.
 */
export function orderCustomDomainsByLeastRecent(
  domains: string[],
  recentDomainCounts: ReadonlyMap<string, number>,
): string[] {
  return [...domains].sort(
    (a, b) => (recentDomainCounts.get(a) ?? 0) - (recentDomainCounts.get(b) ?? 0),
  );
}

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
  // firstRun: this is the user's very first Daily Five. In random mode we then
  // seed the domain palette from declared interests in SELECTION ORDER (strong-
  // vs light-signal weighting) so the first session reads as "drawn from the
  // areas you picked" rather than a random cross-section. See first-run-seeding.ts.
  options: { firstRun?: boolean } = {},
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
    // Custom mode: user explicitly selected domains. The per-domain weekly cap
    // is intentionally not enforced here — when a user hand-picks domains we
    // respect that choice and never drop one.
    //
    // BUT order them least-recently-generated first. A narrow custom set often
    // skews to a few deep domains the player loves (e.g. Shakespearean Tragedy,
    // Wagner's Ring Cycle), and the pool-mode generation prompt lets the model
    // choose which listed domains to use — so it gravitates to those meaty
    // domains and ignores the thinner picks. Their facts then get exhausted by
    // the recent-history / fact-key dedup gates, the batch lands short, and the
    // fresh selected domains (which would survive the gates) never get drawn.
    // Leading with the least-mined domains steers generation (and the bank-pick
    // pass, which walks this list in order) toward the picks that still have
    // unseen facts, keeping the queue full and the rotation honest.
    const ordered = orderCustomDomainsByLeastRecent(
      preferences.selectedDomains.filter((domain) => allDomains.includes(domain)),
      recentDomainCounts,
    );
    const frequencyByDomain = preferences.domainPreferenceFrequency ?? {};
    // Order most-wanted first so generation (which walks this list) favors them:
    // 'often' leads, 'sometimes' (and unset) in the middle, 'blue_moon' trails so
    // those domains are drawn least. 'resting' never reaches here — it's filtered
    // out of selectedDomains upstream.
    const frequencyRank = (domain: string) => {
      const frequency = frequencyByDomain[domain];
      if (frequency === 'often') return 0;
      if (frequency === 'blue_moon') return 2;
      return 1;
    };
    const weightedOrder = [...ordered].sort((a, b) => frequencyRank(a) - frequencyRank(b));
    domainsForRound = weightedOrder.length > 0 ? weightedOrder : allDomains;
  } else {
    // Random mode: pick one domain per category for cross-category variety,
    // with a soft per-domain frequency cap applied via recentDomainCounts.
    // 'resting' domains are honored here too (custom mode filters them out of
    // selectedDomains upstream) so "Resting" means "won't be asked" in both
    // modes; fall back to the full base if everything has been rested.
    const frequencyByDomain = preferences.domainPreferenceFrequency ?? {};
    const resting = new Set(
      Object.entries(frequencyByDomain)
        .filter(([, frequency]) => frequency === 'resting')
        .map(([domain]) => domain.toLowerCase()),
    );
    const eligible = knowledgeBase.filter((domain) => !resting.has(domain.domain.toLowerCase()));
    const eligibleKb = eligible.length > 0 ? eligible : knowledgeBase;

    // First Daily Five: seed the palette from declared interests in selection
    // order so the session is visibly drawn from the areas the user just picked,
    // weighted toward their first (strong-signal) picks. Falls back to normal
    // diverse selection when the plan is empty (sparse/excluded KB) so a thin
    // knowledge base never errors — graceful degradation, no exposed internals.
    let firstRunPlan: string[] = [];
    if (options.firstRun) {
      const orderedDeclared = await getActiveDeclaredInterests(userId)
        .then((rows) => rows.map((row) => row.domain))
        .catch(() => [] as string[]);
      const eligibleByKey = new Set(eligibleKb.map((d) => d.domain.toLowerCase()));
      const orderedEligible = orderedDeclared.filter((domain) =>
        eligibleByKey.has(domain.toLowerCase()),
      );
      firstRunPlan = planFirstRunDomains(orderedEligible, count);
    }

    domainsForRound = firstRunPlan.length > 0
      ? firstRunPlan
      : selectDiverseDomains(eligibleKb, count, recentDomainCounts);
  }

  const domainDifficultyOverrides = preferences.difficulty === 'adaptive'
    ? await getDomainDifficultyOverrides(userId, domainsForRound).catch(() => undefined)
    : undefined;

  // territoryType (declared | demonstrated) per selected domain — threaded into
  // the generation prompt so its register matches the difficulty floor (PRD-D-5
  // §5.2): declared domains read for an enthusiast, demonstrated for a newcomer.
  const territoryByDomain = new Map<string, TerritoryType>();
  for (const entry of knowledgeBase) {
    territoryByDomain.set(entry.domain, entry.territoryType);
  }

  const subAnglesByDomain = await getRecentSubAnglesByDomain(userId, domainsForRound).catch(() => undefined);

  // Try to fill slots from the cross-user bank (previously-generated questions
  // for the same domain AND difficulty tier) before burning fresh Sonnet calls.
  // The bank only ever returns rows the viewer hasn't seen — an empty bank for
  // a domain falls through to LLM generation, which incidentally adds new rows
  // back into the pool. Spans accessible/moderate/specialist so harder slots
  // are reused too, not just warm-ups.
  const bankPicks = await pickBankPicksForDomains(
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
      territoryByDomain,
    );
  }

  return [...bankPicks, ...llmGenerated];
}

/**
 * Daily Five +2 (D-4 §B): generate ONE freshly-generated accessible question per
 * requested domain, bank-first (pickBankPicksForDomains) then Sonnet
 * (generateDailyQuestions), targeting difficultyEstimate='accessible' via
 * difficultyPreference='normal'.
 *
 * Accessibility is a GENERATION TARGET, not a post-filter (the old calibrated/llm
 * accessibility filter on the literal +2 is retired). The one exception is a bank
 * pick: the bank is constrained to the accessible tier, so a bank pick that comes
 * back non-accessible is treated as not-qualifying and that slot SHRINKS rather
 * than downgrading to a harder question.
 *
 * Returns at most one entry per input domain, tagged with its domain so the
 * orchestrator can re-attach the presence attribution. A generation miss for a
 * domain simply yields fewer entries (graceful shrink) — domains are never
 * swapped and this never routes through the orchestrator's N<5 core backstop.
 */
export async function generateBonusQuestionsForDomains(
  userId: string,
  domains: string[],
): Promise<Array<{ domain: string; question: GeneratedQuestionRow }>> {
  const results: Array<{ domain: string; question: GeneratedQuestionRow }> = [];
  if (domains.length === 0) return results;

  const [previousQuestionTexts, previousFactKeys, authoredTexts] = await Promise.all([
    getRecentDailyQuestionTexts(userId),
    getRecentFactKeys(userId),
    getAuthoredQuestionTexts(userId),
  ]);

  // A +2 bonus must never hand the viewer a question they themselves authored.
  // Authored questions live in the canonical table, not the generated bank, so
  // the standard avoid lists miss them (D-4 §B invariant: "never a friend's
  // literal answered question"). Fold them into BOTH paths: the Sonnet avoid
  // list (the semantic Haiku dedupe gate then also catches re-wordings) and a
  // normalized-text guard the bank pick honors verbatim.
  const avoidAuthoredTexts = new Set(authoredTexts.map((entry) => normalizeQuestionText(entry.text)));
  previousQuestionTexts.unshift(...authoredTexts.slice(0, AUTHORED_AVOID_TEXT_LIMIT));

  for (const domain of domains) {
    // Bank-first. resolveDomainDifficulty maps 'normal' → accessible, so the
    // bank source is already accessible-constrained; the guard below is a
    // belt-and-braces "shrink, don't downgrade".
    const bankPicks = await pickBankPicksForDomains(
      userId,
      [domain],
      'normal',
      undefined,
      null,
      previousFactKeys,
      avoidAuthoredTexts,
    ).catch(() => [] as GeneratedQuestionRow[]);

    let row: GeneratedQuestionRow | null = bankPicks[0] ?? null;
    if (row && row.difficultyEstimate !== 'accessible') {
      // Non-accessible bank pick: not-qualifying. Shrink this slot rather than
      // downgrade — and do NOT fall through to Sonnet (the bank answered).
      row = null;
    } else if (!row) {
      // Bank miss → Sonnet, accessible target.
      const generated = await generateDailyQuestions(
        [domain],
        1,
        userId,
        previousQuestionTexts,
        [],
        undefined,
        'normal',
        undefined,
        null,
        previousFactKeys,
        undefined,
      ).catch(() => [] as GeneratedQuestionRow[]);
      row = generated[0] ?? null;
    }

    if (row) {
      results.push({ domain, question: row });
      // Feed the just-picked question back into the avoid lists so a second
      // bonus domain can't echo it.
      previousQuestionTexts.unshift({ domain: row.canonicalSubcategory, text: row.questionText });
      if (row.factKey) {
        previousFactKeys.unshift({ domain: row.canonicalSubcategory, factKey: row.factKey });
      }
    }
  }

  return results;
}

// Resolve the difficulty *tier* a freshly-generated question for this domain
// would land at, so a bank reuse matches the player's intended difficulty.
// Mirrors the generation prompt's own difficulty resolution: fixed preferences
// map through FIXED_DIFFICULTY_LEVELS, adaptive uses the per-domain override (if
// any) or the user's current adaptive level — and both run through the same
// mapAdaptiveLevelToDifficultyHint estimate the generator targets.
function resolveDomainDifficulty(
  domain: string,
  difficultyPreference: string | undefined,
  overrides: ReadonlyMap<string, string> | undefined,
  adaptiveLevel: number | null,
): BankDifficulty | null {
  if (!difficultyPreference) return null;

  if (difficultyPreference === 'adaptive') {
    const override = overrides?.get(domain);
    const overrideLevel = override ? FIXED_DIFFICULTY_LEVELS[override] : undefined;
    const level = overrideLevel ?? adaptiveLevel ?? 1;
    return mapAdaptiveLevelToDifficultyHint(level).estimate;
  }

  const fixedLevel = FIXED_DIFFICULTY_LEVELS[difficultyPreference];
  if (fixedLevel === undefined) return null;
  return mapAdaptiveLevelToDifficultyHint(fixedLevel).estimate;
}

async function pickBankPicksForDomains(
  userId: string,
  domains: string[],
  difficultyPreference: string | undefined,
  domainDifficultyOverrides: ReadonlyMap<string, string> | undefined,
  adaptiveLevel: number | null,
  previousFactKeys: AvoidFactKeyEntry[],
  // Bank rows whose (normalized) text matches one of these are skipped. The +2
  // bonus passes the viewer's authored question texts so the bank can't reuse a
  // fact the viewer themselves wrote (see generateBonusQuestionsForDomains).
  avoidQuestionTexts: ReadonlySet<string> = new Set(),
): Promise<GeneratedQuestionRow[]> {
  const avoidFactKeys = new Set(previousFactKeys.map((entry) => entry.factKey));
  const picks: GeneratedQuestionRow[] = [];
  const expiresAt = getNextDailyResetBoundary();

  for (const domain of domains) {
    const difficulty = resolveDomainDifficulty(
      domain,
      difficultyPreference,
      domainDifficultyOverrides,
      adaptiveLevel,
    );
    if (!difficulty) continue;
    const source = await pickBankSource(userId, domain, difficulty, avoidFactKeys, avoidQuestionTexts).catch(() => null);
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

// ─── B3: Retrieval-grounded generation (batch path) ─────────────────────────
//
// The pieces below are consumed by the pool-refill batch (src/server/daily/
// retrieval-grounded.ts + the /api/cron/pool-refill route). They layer ON TOP of
// the B2 SYSTEM_PROMPT / buildUserPrompt above — same exemplars, difficulty and
// register rules — and only ADD the requirement that every question be written
// FROM retrieved web sources, with the supporting URLs returned as provenance.
// Nothing here runs on the per-user critical path.

// Appended to SYSTEM_PROMPT for the retrieval-grounded call. Keeps the base
// prompt's return schema and adds the source_refs field + the retrieve-first
// contract (Drift Risk 1: never write from memory and search to justify).
export const GROUNDING_SYSTEM_ADDENDUM = `

RETRIEVAL-GROUNDED MODE (this call only):
You have a web_search tool. You MUST use it BEFORE writing each question. The question and its answer must be drawn FROM what you retrieve — never from memory. If you cannot find the answer in retrieved sources, do not invent the question; produce fewer questions instead.

- Search first, then write the question and answer out of the retrieved text.
- Anchor the answer to the sources, not to your prior knowledge. If retrieval contradicts what you "remember", trust the sources or drop the question.
- The explainer must be consistent with the retrieved sources and written IN YOUR OWN WORDS — paraphrase, never copy passages verbatim.
- Corroboration: only keep a question whose answer is supported by AT LEAST TWO independent, reputable sources on DIFFERENT domains (e.g. an encyclopedia plus a university or institutional page). Two pages that copy the same text are NOT independent.
- Prefer editorially-accountable sources: encyclopedias (Wikipedia with citations, Britannica), university/.edu and government/.gov/.mil pages, museums, primary institutional sources, and established reference works. AVOID forums, Q&A/homework sites, social media, wikis-of-fandom, content farms, and AI-generated content mills — these do not count as corroboration.

Add ONE extra field to each question object in the return JSON:
  "source_refs": ["https://full-url-of-supporting-source-1", "https://full-url-of-supporting-source-2", ...]
List the actual URLs you retrieved that support THIS question's answer — at least two, on distinct sites. Do not fabricate URLs; only list pages you actually retrieved.`;

export type SourceRef = string;

export type GroundedLlmQuestion = LlmQuestion & {
  // Provenance URLs (B1 source_refs is typed string[]). Persisted onto
  // generatedQuestions.sourceRefs. The supporting sources for THIS answer.
  source_refs: SourceRef[];
};

// Normalize a raw source_refs value into a deduped list of http(s) URL strings.
// Accepts either an array of URL strings or an array of { url, name } objects
// (the model occasionally emits the richer form even when asked for strings).
export function normalizeSourceRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    let url: string | null = null;
    if (typeof item === 'string') {
      url = item.trim();
    } else if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      url = asString(rec.url) ?? asString(rec.href) ?? asString(rec.link);
    }
    if (!url) continue;
    if (!/^https?:\/\//i.test(url)) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

// Registrable-ish host for a URL, lowercased, www stripped. Used to count
// DISTINCT source domains for the corroboration check. Phase 2 replaces this
// with the reputation allow/deny list + true mirror detection; for Phase 1 it
// is the minimal "≥2 independent sites" guard so we never persist an
// uncorroborated fresh question into the shared pool (Drift Risk 3).
export function sourceHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

export function distinctSourceHostCount(refs: readonly string[]): number {
  const hosts = new Set<string>();
  for (const ref of refs) {
    const host = sourceHost(ref);
    if (host) hosts.add(host);
  }
  return hosts.size;
}

// Parse a retrieval-grounded generation reply. Same base contract as
// parseQuestions, plus the source_refs provenance array.
export function parseGroundedQuestions(raw: string): GroundedLlmQuestion[] {
  const parsed = parseJsonObject(raw);
  if (!parsed) return [];
  const rawList = parsed.questions;
  if (!Array.isArray(rawList)) return [];

  const result: GroundedLlmQuestion[] = [];
  for (const item of rawList) {
    const base = parseBaseQuestion(item);
    if (!base) continue;
    const rec = item as Record<string, unknown>;
    result.push({ ...base, source_refs: normalizeSourceRefs(rec.source_refs) });
  }
  return result;
}

// Run the existing quality gates over a batch and return the union of indices to
// drop. Reuses the SAME gates the per-user path applies (intra-batch dupes,
// LLM quality, factual-correctness, deterministic answer-leak) so grounded
// questions are held to the same bar — without modifying the hot per-user path.
// Fails open per gate (each catch returns an empty set internally), matching the
// per-user behaviour.
export async function screenGroundedBatch(questions: LlmQuestion[]): Promise<Set<number>> {
  if (questions.length === 0) return new Set();
  const [batchDuplicates, qualityResult, factualResult] = await Promise.all([
    findBatchDuplicates(questions),
    findQualityFailures(questions),
    findFactualFailures(questions),
  ]);
  const answerLeaks = findAnswerLeaks(questions);
  return new Set<number>([
    ...batchDuplicates,
    ...qualityResult.toDrop,
    ...factualResult.toDrop,
    ...answerLeaks.toDrop,
  ]);
}
