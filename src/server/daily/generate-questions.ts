import {
  ANTHROPIC_MODEL,
  GENERATION_TIMEOUT_MS,
  HAIKU_GATE_TIMEOUT_MS,
  HAIKU_MODEL,
  INSTRUCTION_USER_INPUT_GUIDANCE,
  INSTRUCTION_SCOPING_QUALIFIER,
  type LlmProvider,
  extractTextContent,
  generateInsideJoke,
  getAnthropicClient,
  loggedMessagesCreate,
  parseJsonObject,
  wrapUserInput,
} from '@/lib/llm';
import { OPENAI_FLAGSHIP_MODEL, openaiCompleteJsonText } from '@/server/llm/provider';
import { getProviderSettings } from '@/server/llm/settings';
import { getNextDailyResetBoundary } from '@/lib/games/timezone';
import { db, generatedQuestions } from '@/server/db';
import { embedAndResolveDuplicatesBatch } from '@/server/pool/dedup';
import {
  focusDomainMinDifficulty,
  getDomainDifficultyOverrides,
  mapAdaptiveLevelToDifficultyHint,
  updateAdaptiveLevel,
} from '@/server/adaptive-difficulty';
import {
  getAuthoredExamplesForDomains,
  getAuthoredQuestionTexts,
  getKnowledgeBase,
  getRecentAnsweredAnswerKeys,
  getRecentAnsweredEntities,
  getRecentAnsweredCanonicalTexts,
  getRecentDailyQuestionTexts,
  getNearestAnsweredQuestionDistance,
  getRecentDomainCounts,
  getRecentFactKeys,
  getRecentSkipCountsByDomain,
  getRecentSubAnglesByDomain,
  normalizeQuestionText,
  pickBankSource,
  type AnsweredCanonicalTextEntry,
  type BankDifficulty,
  type BankSource,
  type RecentDailyQuestionEntry,
  type RecentFactKeyEntry,
} from '@/server/db/queries/daily';
import { getDailyPreferences } from '@/server/db/queries/daily-preferences';
import { getCulturalAnchor, type CulturalAnchor } from '@/server/db/queries/account';
import { getActiveDeclaredInterests } from '@/server/db/queries/declared-interests';
import { adminUserIds } from '@/server/auth/admin';
import { planFirstRunDomains } from '@/server/daily/first-run-seeding';
import {
  isAreaExpansionParentOverflowEnabled,
  isNarrowKbGuardEnabled,
  isNearnessTreeEnabled,
  narrowKbThinnessThreshold,
  selectOverflowParents,
  selectUngroundedExcludedDomains,
} from '@/server/daily/kb-exhaustion';
import {
  getReferencePassagesForDomains,
  isGenerationWikiAnchorEnabled,
  questionLeaksPassageText,
  type DomainReferences,
} from '@/server/daily/domain-reference';
import { getExpansionParents } from '@/server/knowledge/open-domain';
import { getOrBuildDomainRungs } from '@/server/knowledge/nearness-tree';
import { getHeldDomainKeys } from '@/server/db/queries/nearness-overlay';
import { getDurablePoolDepthForDomains } from '@/server/db/queries/retrieval-demand';
import { getBankLabelIndex, reconcileBankDomain } from '@/server/questions/reconcile-bank-domain';
import { resolveFinestNode } from '@/server/knowledge/graph';
import { domainKey } from '@/lib/knowledge/domain-key';
import { normalizeBroadCategory } from '@/server/questions/broad-category';
import {
  domainWeeklyCap,
  isCustomDomainWeightingEnabled,
  selectCustomDomainsForRound,
} from '@/server/daily/domain-selection';
import { isGenericCanonicalAnswer, normalizeCanonicalAnswerLabel } from '@/server/answers/canonical-answer';
import { ANSWER_COOLDOWN_DAYS, answerCooldownKey } from '@/server/daily/answer-cooldown';
import { SUBJECT_COOLDOWN_DAYS, entityKey } from '@/server/daily/subject-cooldown';
import { isGenericSubcategory } from '@/server/questions/canonical-subcategory';
import { normalizeFactKey } from '@/server/questions/fact-key';
import { textContainsAnswer } from '@/server/questions/self-answering';
import { embedTexts, isEmbeddingEnabled } from '@/server/llm/embeddings';
import { resolveDailyBasePoints } from './types';
import { STYLE_EXEMPLAR_BLOCK } from './exemplars';
import { askToAnswerBatch, resolveMachineTrustTier } from './ask-to-answer';
import { enrichAcceptableVariants, mergeVariants } from './enrich-variants';

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
// How many recently-answered CANONICAL question texts (feed sends, milestone
// click-throughs, house questions — rows with no fact_key, invisible to the
// fact-key avoid set; BP-6 / audit Q8) to seed into the Sonnet avoid list.
// Domain-scoped by the caller and bounded for the same flush reason as above —
// AND kept well under RECENT_HISTORY_GATE_LIMIT (30): these entries are
// prepended, so they occupy the front of the semantic history gate's window,
// and a larger cap could displace the generated history the gate exists to
// enforce against (re-audit 2026-06-10, finding F2). 12 leaves ≥18 window
// slots for history in the worst case on the core path.
const ANSWERED_CANONICAL_AVOID_TEXT_LIMIT = 12;

// Domain-scope an answered-canonical read to the round's domains (domainKey
// fold, so spelling variants match) and cap it. Advisory only — the entries
// join the same avoid list the prompt block and Haiku history gate already
// consume; no enforcement gate changes.
function scopeAnsweredCanonicalTexts(
  entries: AnsweredCanonicalTextEntry[],
  domains: string[],
): AvoidQuestionEntry[] {
  const roundKeys = new Set(domains.map((domain) => domainKey(domain)));
  return entries
    .filter((entry) => roundKeys.has(domainKey(entry.domain)))
    .slice(0, ANSWERED_CANONICAL_AVOID_TEXT_LIMIT);
}

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

NO GRATUITOUS SIDE-FACTS IN THE SETUP (false-premise floor — ALL tiers):
The single largest source of broken questions is a FALSE CLAIM smuggled into the setup as decorative scaffolding — a claim the player never has to use, that exists only to sound authoritative. These are dangerous precisely because they are confident and unnecessary: every one is an independently-checkable fact that can be wrong while your asked answer is still right. They come in two forms, BOTH banned unless load-bearing AND certain:
- QUANTITATIVE — a count, date, year, ordinal, or superlative/exclusivity claim ("fifty points", "the largest", "the first", "the only", "exactly three", "founded", "premiered in 1888").
- QUALITATIVE / RELATIONAL — a characterization or causal/derivational link asserted as fact ("its unusual four-movement structure", "a rule that bars volleying before the ball crosses the net", "a transformation that draws on the ancient dragon").
RULE: assert in the setup ONLY what the question actually needs the player to lean on, and only what you are certain is true. If a fact is not essential to the ask, CUT it. When you must include framing, prefer evocative, atmospheric description (which carries no factual claim) over a pile of stated counts, superlatives, and attributions. Setup length is not the problem — asserted side-facts are; a long atmospheric question is safe, a short one with a wrong number is not.
- BAD (false, unnecessary superlative): "Dumbledore makes last-minute point awards that overturn Slytherin's lead. Which student receives fifty points — the largest single award in that sequence — for standing up to his friends?" → the "fifty points / largest single award" claim is both decorative and false (it was ten points, and the largest award went to someone else); the question works without it.
- GOOD (same answer, no asserted side-fact): "At the end-of-year feast in Harry's first year, which student does Dumbledore award points to 'for standing up to his friends'?" → "Neville Longbottom"

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

SINGLE ASK (Rule 3b — ALL tiers):
Ask for exactly ONE thing. A question poses ONE question with ONE answer. NEVER bundle two distinct asks into a single question — no "what is X — and what is Y?", no "who did A, and where did it happen?", no compound joined by "and". If a setup tempts you to ask two things, keep the single better one and cut the other. This is the most common way a question goes wrong: it reads as one sentence but secretly demands two separate facts, so it has no clean single answer.
- This is NOT the name_multiple shape. name_multiple makes ONE ask for several items of the SAME kind ("name the three Norns") — that is allowed. The ban is on asking for two DIFFERENT facts.
- BAD (two asks): "In 'Götterdämmerung,' what vulnerability lets Hagen kill Siegfried with a single thrust — and what is the precise location of that vulnerability on his body?"
- GOOD (one ask): "In 'Götterdämmerung,' Siegfried's bath in the dragon's blood left one spot unprotected. Where on his body is it?"

NAMED-AUTHORITY RULE (Rule 4 — scoping qualifiers, ALL tiers):
When you pin a question to a specific jurisdiction, ruleset, edition, organization, version, region, or year ("In Michigan…", "under FIDE rules…", "in the 1st edition…"), the answer you emit MUST be the one correct UNDER THAT named authority — not the more common or default answer. Named specifics frequently override the default on purpose: e.g. Michigan's Rules of Evidence permit wide-open cross-examination, so "beyond the scope of direct" is NOT a valid objection there, though it is under the Federal Rules. If you are not certain how the named authority departs from the default, pick a different angle rather than risk an answer keyed to the generic default.

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

For each question, also emit subject_entity: the single primary subject the question is ABOUT — the person, work, character, place, or thing at its center (e.g. "Peter Pettigrew", "Guys and Dolls", "the Krebs cycle"). Name the most specific recurring entity a fan would point to, not the broad domain. This is COARSER than fact_key: many different facts about Peter Pettigrew all share subject_entity "Peter Pettigrew". Keep it under 60 characters and omit a leading article.

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
      "subject_entity": "string, the single primary subject the question is about (see above) — coarser than fact_key",
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
  subject_entity: string | null;
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

// Per-domain mastery strength threaded into the prompt as SALIENCE context
// (BP-5 / audit Q3c). Shape matches the fields getKnowledgeBase already
// returns — no extra query is needed to populate it.
export type DomainStrength = {
  tier: 'establishing' | 'familiar' | 'solid' | 'mastery';
  totalPoints: number;
  correctAnswerCount: number;
};

// How many admin-authored example questions to feed the prompt per domain. Kept to
// a small HANDFUL on purpose: a few examples anchor the model's facts and register;
// more just crowds the prompt with diminishing returns (and, across a multi-domain
// round, adds up). Few-shot grounding wants variety, not volume.
const DOMAIN_EXAMPLE_LIMIT = 3;

// Per-domain human-authored (question, answer) examples used as generation anchors.
export type DomainExamples = ReadonlyMap<string, ReadonlyArray<{ questionText: string; answerText: string }>>;

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
  domainStrengths?: ReadonlyMap<string, DomainStrength>,
  culturalAnchor?: CulturalAnchor | null,
  // Per-domain human-authored example questions (question + answer), used as
  // GROUND-TRUTH anchors so the model writes new questions grounded in real canon
  // instead of inventing facts for domains it doesn't truly know. See
  // getAuthoredExamplesForDomains / DOMAIN_EXAMPLE_LIMIT.
  domainExamples?: ReadonlyMap<string, ReadonlyArray<{ questionText: string; answerText: string }>>,
  // D-FANDOM-GROUNDING-01 Consumer A: per-domain wiki reference passages — a
  // provenance-labeled block DISTINCT from the authored examples (decision B2:
  // authored = trusted human canon; reference = unvetted retrieved source), with
  // a soft "prefer facts in the passage" instruction (decision A2, not a hard
  // extractive constraint). Absent unless GENERATION_WIKI_ANCHOR_ENABLED.
  domainReferences?: DomainReferences,
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

  // Player strength per domain (BP-5 / Q3c) — salience context, NOT difficulty.
  // The fan-salience rule asks for "the thing a devoted fan would be delighted
  // to be recognized for knowing"; knowing how deep THIS player actually is in
  // the domain lets the model pitch that recognition honestly. The difficulty
  // instruction above stays authoritative — this block must never move it.
  let strengthHint = '';
  if (domainStrengths && domainStrengths.size > 0) {
    const lines: string[] = [];
    for (const domain of domains) {
      const strength = domainStrengths.get(domain);
      if (!strength) continue;
      lines.push(
        `- ${domain}: ${strength.tier} tier, ${strength.totalPoints} pts, ${strength.correctAnswerCount} correct so far`,
      );
    }
    if (lines.length > 0) {
      strengthHint = `\n\nPlayer strength in this round's domains. Use it to pitch FAN-SALIENCE — choose the angle a player at that depth would be delighted to be asked. Do NOT use it to change difficulty; the difficulty instruction above is authoritative:\n${lines.join('\n')}`;
    }
  }

  // Cultural anchor (BP-5 / Q3d) — era/regional salience only. Captured at
  // onboarding for interest proposal; reused here for the same purpose class
  // (shaping content for this player). Hard rule in the prose: never assume
  // knowledge from it and never let it move difficulty.
  let anchorHint = '';
  if (
    culturalAnchor &&
    (culturalAnchor.birthYear !== null || culturalAnchor.grewUpCountry || culturalAnchor.grewUpRegion)
  ) {
    const parts: string[] = [];
    if (culturalAnchor.birthYear !== null) parts.push(`born ${culturalAnchor.birthYear}`);
    const place = [culturalAnchor.grewUpRegion, culturalAnchor.grewUpCountry]
      .filter((value): value is string => Boolean(value))
      .join(', ');
    if (place) parts.push(`grew up in ${place}`);
    anchorHint = `\n\nPlayer background (salience only — NEVER difficulty): ${parts.join('; ')}. When two candidate facts are otherwise equally good, prefer the angle this era or regional background makes resonant. Do not assume knowledge from it, do not steer away from the domain to localize, and never make a question easier or harder because of it.`;
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

  let examplesHint = '';
  if (domainExamples && domainExamples.size > 0) {
    const perDomain: string[] = [];
    for (const domain of domains) {
      const examples = domainExamples.get(domain);
      if (examples && examples.length > 0) {
        const lines = examples
          .slice(0, DOMAIN_EXAMPLE_LIMIT)
          .map((ex) => `  Q: ${ex.questionText}\n     A: ${ex.answerText}`)
          .join('\n');
        perDomain.push(`[${domain}]\n${lines}`);
      }
    }
    if (perDomain.length > 0) {
      examplesHint = `\n\nHUMAN-AUTHORED EXAMPLES — ground truth for these domains. A person who knows the material wrote these, so treat their facts as CANON. Write NEW questions about DIFFERENT facts in the same spirit, specificity, and register. Anchor every claim to the actual work as these examples reflect it — do NOT invent names, places, or events a real fan could not confirm. (Do not reuse these exact facts; they are in the avoid list.)
${wrapUserInput('domain_examples', perDomain.join('\n\n'))}`;
    }
  }

  // Reference anchor (D-FANDOM-GROUNDING-01, A2+B2): retrieved wiki passages for
  // this round's domains. Deliberately a SEPARATE block from the human-authored
  // examples — those are trusted canon, this is unvetted retrieved reference, and
  // the prompt says so. The instruction is A2's soft preference, not a span
  // constraint: the model still writes freely; the demote-only batch verifier
  // stays the enforcement boundary.
  let referenceHint = '';
  if (domainReferences && domainReferences.size > 0) {
    const perDomain: string[] = [];
    for (const domain of domains) {
      const ref = domainReferences.get(domain);
      if (ref) perDomain.push(`[${domain}] (source: ${ref.source})\n${ref.passage}`);
    }
    if (perDomain.length > 0) {
      referenceHint = `\n\nREFERENCE PASSAGES — retrieved wiki extracts for some of this round's domains. Unlike the human-authored examples above, these are UNVETTED reference material, not canon a person wrote. For a domain with a passage: prefer facts present in the passage; if a fact is not in the passage and you are not certain of it from the actual work, do not assert it. Never copy a passage sentence into a question verbatim — write your own question text.
${wrapUserInput('reference_passages', perDomain.join('\n\n'))}`;
    }
  }

  return `${domainSection}${calibration}${difficultyHint}${territoryHint}${strengthHint}${anchorHint}${subAnglesHint}${examplesHint}${referenceHint}

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
  // Fold drifting LLM broad-category synonyms to one canonical bucket (Change 3)
  // at the single point all generated rows enter the system, so every downstream
  // write (generated row, canonical Question, analytics) sees the stable label.
  const broad = normalizeBroadCategory(asString(rec.broad_category));
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
    subject_entity: normalizeSubjectEntity(rec.subject_entity),
    sub_angles: normalizeSubAngles(rec.sub_angles),
    question_shape: asQuestionShape(rec.question_shape),
  };
}

// Store the model's subject label lightly normalized (trimmed, leading article
// dropped, length-capped) but otherwise as written — the readable form lives on
// the row; the Tier 2 gate folds it to a match key at compare time. Null when
// the model omitted it or returned a non-string.
function normalizeSubjectEntity(value: unknown): string | null {
  const str = asString(value)?.trim();
  if (!str) return null;
  return str.replace(/^(the|a|an)\s+/i, '').slice(0, 80).trim() || null;
}

// Exported for the crafter draft path (B-CRAFTER-LIFECYCLE-01 Phase 2), which
// mirrors callLlmOnce without the persist/gate machinery — same parse contract.
export function parseQuestions(raw: string): LlmQuestion[] {
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

const QUALITY_GATE_SYSTEM_PROMPT = `You are reviewing a small batch of just-generated trivia questions for quality before they are served to a player. Each item carries its difficulty tier (tier=accessible | moderate | specialist). For each question, decide whether it has any of these defects:

1. ANSWER_LEAKED — the question setup contains the answer, near-paraphrase, or a tell that gives the answer away. E.g. "Mrs. Lovett bakes meat pies using a secret ingredient from Sweeney's victims. What does she put in the pies?" — the setup tells you it's the victims.
2. OPINION_OR_VAGUE — asks for a preference, value judgment, or has no single clear answer.
3. FALSE_PREMISE — the setup contains a factual error or assumes something incorrect. Verify embedded factual claims, not just the overall framing: counts ("six works"), dates, attributions/authorship, and "N of which M" / "X of Y" relationships must hold up. A false claim of this kind is a defect however fluently it is phrased — it is NOT one of the "subtle wordsmithing" concerns excluded below. E.g. "Bach composed six works for unaccompanied strings — three for solo violin and three for solo cello" is FALSE_PREMISE (he wrote six of each, not three), even though the question reads cleanly and its answer is correct.
4. SELF_ANSWERING — the question names the answer in its own text ("Who wrote the 1922 poem 'The Waste Land' by T. S. Eliot?").
5. GENERIC_AT_TIER — tier-gated: judge this defect ONLY for items whose tier is moderate or specialist. NEVER flag an accessible-tier item with this defect, and never flag any item merely for resembling a simply-phrased question. At moderate/specialist, a question is defective when it is generic trivia: mentally remove the work/domain title from the question — if what remains could appear in any generic trivia app (name-the-character/title/location roster questions, what-year/what-number lookups with no significance to a fan), it does not clear the tier's bar. E.g. "In Gilmore Girls, what is the name of Rory's first boyfriend?" at specialist is GENERIC_AT_TIER. A question probing a specific scene, running joke, exact wording, object, technique, or second-order fact is NOT generic, however plainly it is phrased — "In American Psycho, what color is Paul Allen's business card?" passes. Flag ONLY clear-cut cases; when uncertain, do not flag — at these tiers a missed generic question is cheaper than suppressing a good one.
6. MULTI_PART — the question bundles two DISTINCT asks into one, so it has no single clean answer. Tells: an "— and what…/who…/where…?" tail, or any setup that demands two separate facts (a thing AND its location, a name AND a date). E.g. "What vulnerability lets Hagen kill Siegfried — and what is the precise location of it on his body?" is MULTI_PART. This is NOT the name_multiple style (ONE ask for several items of the SAME kind, e.g. "name the three Norns"), which is fine — flag only a question asking for two DIFFERENT facts.

A high bar applies — flag a question only when one of these defects is clearly present. Subtle wordsmithing concerns are NOT defects.

The following styles are explicitly ACCEPTABLE and must NOT be flagged on style grounds alone — fill-in-the-blank, complete-the-quote, name-multiple, and concise idiomatic questions all belong in Joshing. Reference exemplars:

${STYLE_EXEMPLAR_BLOCK}

Only flag a question matching one of those styles if it independently exhibits ANSWER_LEAKED, OPINION_OR_VAGUE, FALSE_PREMISE, SELF_ANSWERING, MULTI_PART, or — at moderate/specialist tier only — GENERIC_AT_TIER. Style never exempts a question from the tier bar: a concise identification-style question at moderate/specialist must still clear strip-the-domain.

Return JSON only:
{ "drop_indices": [list of zero-based indices to drop], "reasons": { "<index>": "<short reason>" } }

If no questions are defective, return { "drop_indices": [], "reasons": {} }.${INSTRUCTION_USER_INPUT_GUIDANCE}`;

// Exported for the opt-in live evals (quality-gate.eval.test.ts), mirroring the
// parseFactualGateResponse / findAnswerLeaks precedent. Production callers are
// generateDailyQuestions and screenGroundedBatch in this module.
export async function findQualityFailures(generated: LlmQuestion[]): Promise<{
  toDrop: Set<number>;
  reasons: Record<number, string>;
}> {
  if (generated.length === 0) return { toDrop: new Set(), reasons: {} };
  const client = getAnthropicClient();
  if (!client) return { toDrop: new Set(), reasons: {} };

  // tier= feeds the GENERIC_AT_TIER defect (judged only at moderate/specialist).
  // difficulty_estimate is the same field serving and scoring treat as the
  // question's tier (resolveDailyBasePoints, bank matching), so the gate and the
  // serving path agree on what tier a question is.
  const body = generated
    .map(
      (q, i) =>
        `[${i}] domain=${q.canonical_subcategory} tier=${q.difficulty_estimate}\n    q=${q.question_text}\n    a=${q.answer}`,
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

// Factual-correctness gate. The dedup and quality gates above never reliably
// check whether the *stated answer is actually correct for the question*, nor
// whether the question's *setup is factually true* — they catch repeats, leaks,
// and vagueness, and the quality gate's FALSE_PREMISE check is tuned to a "high
// bar / not subtle" posture that misses buried errors. Two hallucinations sail
// through without this gate: (1) a good question paired with the wrong answer
// (e.g. asking who wrote "Rubyfruit Jungle" but answering with a politician),
// and (2) a correct answer paired with a FALSE PREMISE in the setup (e.g.
// "Bach wrote six works for solo strings — three for violin and three for
// cello" — he wrote six of each; the keyed answer is right but the count is a
// lie). This gate checks BOTH the answer and the premise. User-authored
// questions get the equivalent via vetQuestion() on the /api/questions path;
// bot-generated daily questions had no equivalent until this gate. Like the
// others it is batch-based, runs in parallel, and fails open.
const FACTUAL_GATE_SYSTEM_PROMPT = `You are fact-checking a small batch of just-generated trivia questions before they are served to a player. Each item has a question and the stated answer the game will mark as correct. Your job is to catch questions whose stated answer is WRONG, OR whose question setup states something factually false.

For each question decide:
- WRONG — any of:
  - the stated answer is factually incorrect for the question, OR
  - the question's clearly-correct answer is a different thing/person than the stated answer, OR
  - the question and answer come from mismatched subjects (e.g. a literature question answered with an unrelated political figure), OR
  - the question's SETUP asserts a false fact — a wrong count, date, attribution, authorship, or relationship — EVEN WHEN the stated answer is correct. E.g. "Bach composed six works for unaccompanied strings — three for solo violin and three for solo cello — what collective title is given to the cello set?" answered "Cello Suites": the answer is correct, but the premise is false (Bach wrote six of each, not three), so this is WRONG.
- OK — the stated answer is correct (or a reasonable equivalent/alternate form) AND the setup contains no false factual claim.
- UNVERIFIABLE — you genuinely cannot verify the fact (extremely niche, recent, or personal). Treat these as OK; do NOT flag them.

Flag (drop) ONLY questions you judge WRONG with high confidence. A high bar applies — when in doubt, leave it. Do not flag for style, difficulty, phrasing, or ambiguity; only for a factually incorrect stated answer or a factually false premise.

Return JSON only:
{ "drop_indices": [list of zero-based indices that are WRONG], "reasons": { "<index>": "<short reason naming the correct answer or correcting the false premise>" } }

If nothing is wrong, return { "drop_indices": [], "reasons": {} }.${INSTRUCTION_USER_INPUT_GUIDANCE}${INSTRUCTION_SCOPING_QUALIFIER}`;

// Model for the factual gate. Measured 2026-06 (scripts/audit-gate-compare):
// Haiku-tier misses subtle false-premise questions that Sonnet catches — the
// "answer is right but the setup embeds a false claim" class (e.g. a TotK
// question asserting Ganondorf's dragon form draws on Zelda's). Sharpening the
// gate PROMPT at Haiku tier didn't help (+0/+1); it's a model-tier effect, and
// Sonnet recovered essentially the full major-defect lift that Opus did. So the
// gate now defaults to Sonnet. The gate runs once per generation BATCH (not per
// question), so a stronger model here is a small cost on the highest-leverage
// check. Override with FACTUAL_GATE_MODEL (e.g. claude-haiku-4-5-20251001 to
// revert, or an Opus id for max recall) without a deploy.
const FACTUAL_GATE_MODEL = process.env.FACTUAL_GATE_MODEL?.trim() || ANTHROPIC_MODEL;
// Opus 4.7/4.8 and Fable removed sampling params — sending `temperature` 400s on
// them. Haiku 4.5 and Sonnet 4.6 still accept it. Guard so an Opus override of
// the gate model doesn't break the call.
function gateModelRejectsTemperature(model: string): boolean {
  return model.includes('opus-4-7') || model.includes('opus-4-8') || model.includes('fable');
}
// Haiku gate timeout is tuned for Haiku's speed; a heavier gate model needs more
// headroom or it times out and fails open (silently disabling the gate).
const FACTUAL_GATE_TIMEOUT_MS = FACTUAL_GATE_MODEL === HAIKU_MODEL ? HAIKU_GATE_TIMEOUT_MS : 20_000;
// Output budget for the gate's JSON verdict. The whole over-provisioned batch is
// gated in ONE call, and the response lists every dropped index + a one-line
// reason. A single verbose drop already runs ~270 output tokens, so the old
// 500-token cap truncated as soon as a batch flagged 2+ questions: the JSON cut
// off mid-structure, parseFactualGateResponse failed to parse it, and the gate
// SILENTLY returned an empty drop set — shipping the entire un-vetted batch
// (this is how the "fifty points" Harry Potter false-premise question reached
// production despite the gate running on Sonnet, which flags it deterministically).
// Output is billed per token actually emitted, so this headroom is free unless a
// response genuinely needs it; the truncation guard below catches any remaining
// overflow loudly instead of silently.
const FACTUAL_GATE_MAX_TOKENS = 2000;

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

// Exported for the opt-in live evals (factual-gate.test.ts), mirroring the
// findQualityFailures precedent. Production callers are generateDailyQuestions
// and screenGroundedBatch in this module.
export async function findFactualFailures(generated: LlmQuestion[]): Promise<{
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
      model: FACTUAL_GATE_MODEL,
      max_tokens: FACTUAL_GATE_MAX_TOKENS,
      // Omit temperature on models that reject sampling params (Opus 4.7/4.8/Fable).
      ...(gateModelRejectsTemperature(FACTUAL_GATE_MODEL) ? {} : { temperature: 0 }),
      system: FACTUAL_GATE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }, { timeoutMs: FACTUAL_GATE_TIMEOUT_MS });
    // A max_tokens stop means the JSON verdict was cut off: the parse below will
    // fail and return an empty set, so the whole batch passes UNGATED. That used
    // to be invisible. Surface it loudly so the cap can be raised before it
    // silently disables the gate again.
    if (response.stop_reason === 'max_tokens') {
      console.warn(
        '[daily/generate-questions] factual gate response truncated at max_tokens — batch passed UNGATED',
        { batchSize: generated.length, maxTokens: FACTUAL_GATE_MAX_TOKENS },
      );
    }
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

// Tier ladder shared by the difficulty-floor gate. Index = how hard, ascending.
const DIFFICULTY_TIER_LADDER: LlmQuestion['difficulty_estimate'][] = [
  'accessible',
  'moderate',
  'specialist',
];

// One rung of slack: the adaptive target is a soft aim and the tiers overlap, so
// a single-rung miss (e.g. specialist requested, moderate returned) is tolerated.
// A two-rung miss is not — it's a question that doesn't belong in the slot. Env
// knob (default 1, unchanged) is a transition escape hatch: bump to 2 if a domain
// whose stored tier hasn't recalibrated down yet still buries good accessible
// content. Pairs with the FOCUS_DOMAIN_MIN_DIFFICULTY recalibration.
function maxTierShortfall(): number {
  const parsed = Number(process.env.MAX_TIER_SHORTFALL);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 1;
}

// Map a requested difficulty preference — either a per-domain adaptive override
// or the player's fixed global preference — to a ladder index. Keys with no
// enforceable floor ('adaptive' sentinel left unresolved, or anything
// unexpected) return null so the gate skips them rather than guessing.
function requestedDifficultyTierIndex(preference: string | undefined): number | null {
  switch (preference) {
    case 'normal':
      return 0; // accessible
    case 'moderate':
      return 1; // moderate
    case 'challenging':
    case 'ridiculous':
      return 2; // specialist
    default:
      return null;
  }
}

/**
 * Difficulty-floor gate. The per-domain difficulty target (adaptive mode) and
 * the player's fixed difficulty preference are only ever PROMPT HINTS: the model
 * self-reports `difficulty_estimate` on whatever question it actually wrote, and
 * until this gate nothing re-checked that self-report against what was asked
 * for. So a "specialist" Sesame Street request could come back as a tourist-
 * level "what color is Elmo?" self-labeled 'accessible', and every other gate
 * (quality, factual, dedup, answer-leak) waved it through because it is well-
 * formed and factually correct.
 *
 * This deterministic gate closes that gap: drop any question whose self-reported
 * tier lands MORE THAN ONE rung below the requested tier for its domain. The
 * requested tier is the per-domain override when present (adaptive mode), else
 * the global fixed preference. When neither resolves to a concrete floor (e.g.
 * an unresolved 'adaptive' with no override for that domain) the question is
 * left alone — we can't enforce a floor we don't know. Dropping is safe: the
 * orchestrator over-provisions and tops up, so this just forces a regen the same
 * way the dedup/quality gates do.
 */
export function findUnderDifficultyQuestions(
  generated: LlmQuestion[],
  domainDifficultyOverrides: ReadonlyMap<string, string> | undefined,
  difficultyPreference: string | undefined,
): { toDrop: Set<number>; reasons: Record<number, string> } {
  const toDrop = new Set<number>();
  const reasons: Record<number, string> = {};
  const maxShortfall = maxTierShortfall();

  // Normalize override keys so a returned canonical_subcategory differing only by
  // case/whitespace from the requested domain still resolves its override.
  const normalize = (value: string) => value.trim().toLowerCase();
  const normalizedOverrides = new Map<string, string>();
  if (domainDifficultyOverrides) {
    for (const [domain, preference] of domainDifficultyOverrides) {
      normalizedOverrides.set(normalize(domain), preference);
    }
  }

  for (let i = 0; i < generated.length; i += 1) {
    const q = generated[i];
    const requestedPreference =
      normalizedOverrides.get(normalize(q.canonical_subcategory)) ?? difficultyPreference;
    const requestedIdx = requestedDifficultyTierIndex(requestedPreference);
    if (requestedIdx === null) continue;

    const estimateIdx = DIFFICULTY_TIER_LADDER.indexOf(q.difficulty_estimate);
    if (estimateIdx < 0) continue; // unrecognized estimate — not ours to judge.

    const shortfall = requestedIdx - estimateIdx;
    if (shortfall > maxShortfall) {
      toDrop.add(i);
      reasons[i] =
        `difficulty "${q.difficulty_estimate}" is ${shortfall} tiers below requested "${DIFFICULTY_TIER_LADDER[requestedIdx]}" for ${q.canonical_subcategory}`.slice(
          0,
          200,
        );
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

// Semantic dedup via Voyage embeddings (B-DEDUP-SEMANTIC-01), reusing the same
// embeddings the pool dedup stores. Two complementary gates run off ONE embedding
// pass over the freshly-generated batch (embedGeneratedBatch below):
//
//  1. INTRA-BATCH (findIntraBatchEmbeddingDuplicates) — a deterministic,
//     fail-CLOSED backstop to the Haiku findBatchDuplicates gate (which fails
//     OPEN on a timeout/outage). The generator sometimes emits the same fact
//     reworded several times in one build — observed 2026-06-21: a new user's
//     Daily Five had THREE "name Henry VIII's Act of Supremacy" paraphrases
//     (pairwise cosine 0.96–0.99) that the Haiku gate let through. Greedy
//     keep-first: drop any candidate too similar to one already kept this batch.
//
//  2. ACROSS-HISTORY (findAnsweredHistoryDuplicates) — drops candidates too
//     similar to a question the user already answered correctly within
//     DAILY_HISTORY_DEDUP_WINDOW_DAYS. exact-question_id "already seen" filtering
//     misses these because a regenerated paraphrase gets a new id (observed: a
//     "1911 Triangle Shirtwaist factory" question re-served 16 days after the
//     user answered it; cosine 0.89). Does nothing for brand-new users (no
//     history) — which is exactly why the intra-batch gate is needed too.
//
// One cosine threshold serves both: the real cases cluster cleanly — true
// duplicates score 0.89–0.99, genuinely-different same-topic questions ≤ 0.84,
// cross-topic ~0.55 — so 0.88 catches repeats without dropping distinct
// questions. Both gates are best-effort: embeddings disabled or any error drops
// nothing, so the build is never blocked on them. Knobs are env-overridable.
const DAILY_DEDUP_COSINE_THRESHOLD = Number(
  process.env.DAILY_DEDUP_COSINE_THRESHOLD ??
    process.env.DAILY_HISTORY_DEDUP_COSINE_THRESHOLD ??
    0.88,
);
const DAILY_HISTORY_DEDUP_WINDOW_DAYS = Number(
  process.env.DAILY_HISTORY_DEDUP_WINDOW_DAYS ?? 180,
);

// Cosine similarity of two equal-length vectors. Voyage embeddings come back
// normalized, but the full form is computed so it's correct regardless.
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Embed a freshly-generated batch once, shared by both embedding gates below.
// Returns null when embeddings are disabled or the API call fails — both gates
// then no-op (best-effort, never blocks the build).
async function embedGeneratedBatch(
  generated: LlmQuestion[],
): Promise<Array<number[] | null> | null> {
  if (generated.length === 0 || !isEmbeddingEnabled()) return null;
  try {
    return await embedTexts(generated.map((q) => q.question_text), 'document');
  } catch (error) {
    console.warn('[daily/generate-questions] batch embedding failed; semantic dedup skipped', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// Deterministic intra-batch dedup (gate 1 above). Greedy: walk the batch in
// order, keep the first of any near-identical cluster, drop the rest.
function findIntraBatchEmbeddingDuplicates(
  embeddings: Array<number[] | null> | null,
): Set<number> {
  const drop = new Set<number>();
  if (!embeddings) return drop;
  const kept: number[] = [];
  for (let i = 0; i < embeddings.length; i++) {
    const emb = embeddings[i];
    if (!emb) continue;
    const isDup = kept.some((j) => {
      const other = embeddings[j];
      return other != null && cosineSimilarity(emb, other) >= DAILY_DEDUP_COSINE_THRESHOLD;
    });
    if (isDup) drop.add(i);
    else kept.push(i);
  }
  return drop;
}

// Answer-cooldown pre-filter (B-DEDUP-ANSWER-COOLDOWN, Tier 1). The deterministic
// generation-time companion to the serve-time answer-cooldown gate: drop a fresh
// question whose answer the player already gave within the window (recentKeys),
// or that repeats another answer earlier in THIS batch, BEFORE it is persisted —
// so an exact-answer repeat never enters the shared pool in the first place
// (token-cheap: one string key per row, no LLM). The 0.88 embedding gate misses
// these because a same-answer/different-angle pair scores below threshold.
function findAnswerCooldownDuplicates(
  generated: LlmQuestion[],
  recentKeys: ReadonlySet<string>,
): Set<number> {
  const drop = new Set<number>();
  const seenThisBatch = new Set<string>();
  for (let i = 0; i < generated.length; i += 1) {
    const key = answerCooldownKey(generated[i].answer);
    if (!key) continue;
    if (recentKeys.has(key) || seenThisBatch.has(key)) {
      drop.add(i);
      continue;
    }
    seenThisBatch.add(key);
  }
  return drop;
}

// Subject-cooldown pre-filter (B-DEDUP-SUBJECT-COOLDOWN, Tier 2). Generation-time
// companion to the serve-time subject gate: drop a fresh question whose subject
// OR answer names an entity the player recently touched (recentEntities = recent
// subjects ∪ answers), or that repeats an entity earlier in THIS batch. Catches
// same-subject saturation the answer/embedding gates miss (the Peter Pettigrew
// case, where the entity is an answer in one question and a subject in another).
function findSubjectCooldownDuplicates(
  generated: LlmQuestion[],
  recentEntities: ReadonlySet<string>,
): Set<number> {
  const drop = new Set<number>();
  const seenThisBatch = new Set<string>();
  const hit = (key: string) => key !== '' && (recentEntities.has(key) || seenThisBatch.has(key));
  for (let i = 0; i < generated.length; i += 1) {
    const subjectK = entityKey(generated[i].subject_entity);
    const answerK = entityKey(generated[i].answer);
    if (hit(subjectK) || hit(answerK)) {
      drop.add(i);
      continue;
    }
    if (subjectK) seenThisBatch.add(subjectK);
    if (answerK) seenThisBatch.add(answerK);
  }
  return drop;
}

// Across-history dedup (gate 2 above). Takes the shared batch embeddings.
async function findAnsweredHistoryDuplicates(
  userId: string,
  embeddings: Array<number[] | null> | null,
): Promise<Set<number>> {
  const drop = new Set<number>();
  if (!embeddings) return drop;
  try {
    await Promise.all(
      embeddings.map(async (embedding, i) => {
        if (!embedding) return;
        const distance = await getNearestAnsweredQuestionDistance(
          userId,
          embedding,
          DAILY_HISTORY_DEDUP_WINDOW_DAYS,
        );
        if (distance === null) return;
        if (1 - distance >= DAILY_DEDUP_COSINE_THRESHOLD) {
          drop.add(i);
        }
      }),
    );
  } catch (error) {
    // Best-effort: never block the daily build on the semantic history gate.
    console.warn('[daily/generate-questions] answered-history embedding gate failed; skipping', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return drop;
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
  domainStrengths?: ReadonlyMap<string, DomainStrength>,
  culturalAnchor?: CulturalAnchor | null,
  provider: LlmProvider = 'anthropic',
  domainExamples?: DomainExamples,
  domainReferences?: DomainReferences,
): Promise<LlmQuestion[]> {
  const userPrompt = buildUserPrompt(
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
    domainStrengths,
    culturalAnchor,
    domainExamples,
    domainReferences,
  );

  // OpenAI branch (B-LLM-PROVIDER-AB-SWITCH B1): same prompt text, only the
  // request envelope changes. Returns the same text the Anthropic branch does,
  // so the parseQuestions validator below is shared, unchanged. The Haiku gates
  // (dedupe / quality / factual) stay on Anthropic on purpose — this provider
  // toggle routes the question-generation call only.
  if (provider === 'openai') {
    const text = await openaiCompleteJsonText({
      scope: 'generate-questions',
      systemText: SYSTEM_PROMPT,
      userText: userPrompt,
      model: OPENAI_FLAGSHIP_MODEL,
      maxTokens: 2000,
      temperature: 0.8,
      timeoutMs: GENERATION_TIMEOUT_MS,
    });
    if (text === null) return [];
    return parseQuestions(text);
  }

  // Anthropic branch — the existing code path, unchanged.
  const client = getAnthropicClient();
  if (!client) return [];

  // SYSTEM_PROMPT is ~3-4k tokens (rules + 44 exemplars + schema) — above the
  // 2048-token minimum cacheable prefix on claude-sonnet-4-6. The cron fans
  // out with USER_CONCURRENCY=4, so concurrent batches hit the cache. The
  // 5-min TTL means later sequential batches miss, but the concurrent slice
  // is worth the surcharge. NOTE: the Haiku gates below carry NO cache_control
  // on purpose — claude-haiku-4-5's minimum cacheable prefix is 4096 tokens
  // and every gate system prompt (even the exemplar-bearing quality gate at
  // ~2k) is under it, so a marker would be a silent no-op.
  const response = await loggedMessagesCreate(client, 'generate-questions', {
    model: ANTHROPIC_MODEL,
    max_tokens: 2000,
    temperature: 0.8,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userPrompt }],
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
  domainStrengths?: ReadonlyMap<string, DomainStrength>,
  culturalAnchor?: CulturalAnchor | null,
  // Soft difficulty-floor fallback. When provided, questions that come back more
  // than one tier below the requested difficulty are NOT dropped — they are
  // persisted and pushed here (instead of into the returned in-tier array) so the
  // orchestrator can draw on them as a last resort rather than serving a short
  // queue (see the under-difficulty handling below and queue-orchestrator's
  // backfill chain).
  options: {
    underDifficultyReserve?: GeneratedQuestionRow[];
    provider?: LlmProvider;
    domainExamples?: DomainExamples;
    domainReferences?: DomainReferences;
  } = {},
): Promise<GeneratedQuestionRow[]> {
  if (count <= 0 || domains.length === 0) return [];

  // Provider for the generation call. Read once per run and threaded through
  // every chunk — never re-resolved per question. Defaults to Anthropic; B2
  // makes the caller pass the global setting instead of the literal below.
  const provider: LlmProvider = options.provider ?? 'anthropic';
  const domainExamples = options.domainExamples;
  const domainReferences = options.domainReferences;

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
        domainStrengths,
        culturalAnchor,
        provider,
        domainExamples,
        domainReferences,
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
        domainStrengths,
        culturalAnchor,
        provider,
        domainExamples,
        domainReferences,
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

  // Decision C guard (D-FANDOM-GROUNDING-01): reference passages are
  // grounding-only — a question whose text is a verbatim lift from its domain's
  // source passage is dropped before any gate sees it (CC-BY-SA prose must never
  // be persisted into a served question). Expected to fire ~never; the prompt
  // already forbids copying.
  if (domainReferences && domainReferences.size > 0) {
    generated = generated.filter((q) => {
      const ref = domainReferences.get(q.canonical_subcategory);
      if (ref && questionLeaksPassageText(q.question_text, ref.passage)) {
        console.warn('[daily/generate-questions] dropped verbatim passage lift', {
          domain: q.canonical_subcategory,
        });
        return false;
      }
      return true;
    });
  }

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
  // - findFactualFailures: verifies both that the stated answer is correct for
  //   the question AND that the question's setup contains no false premise — the
  //   defect classes the other gates never reliably inspect.
  // - findAnswerLeaks (below, synchronous): deterministic fail-closed backstop
  //   for answer leakage when the Haiku quality gate misses or fails open.
  const recentForGate = avoidList.slice(0, RECENT_HISTORY_GATE_LIMIT);
  // One embedding pass over the batch feeds both semantic gates (intra-batch +
  // across-history). null when embeddings are disabled/failed → both no-op.
  // Answer-cooldown keys fetched alongside (deterministic, resilient on failure).
  const [batchEmbeddings, recentAnswerKeys, recentEntities] = await Promise.all([
    embedGeneratedBatch(generated),
    ANSWER_COOLDOWN_DAYS > 0
      ? getRecentAnsweredAnswerKeys(userId, ANSWER_COOLDOWN_DAYS).catch(() => new Set<string>())
      : Promise.resolve(new Set<string>()),
    SUBJECT_COOLDOWN_DAYS > 0
      ? getRecentAnsweredEntities(userId, SUBJECT_COOLDOWN_DAYS).catch(() => new Set<string>())
      : Promise.resolve(new Set<string>()),
  ]);
  const answerCooldownDuplicates = findAnswerCooldownDuplicates(generated, recentAnswerKeys);
  if (answerCooldownDuplicates.size > 0) {
    console.warn('[daily/generate-questions] dropping answer-cooldown repeats', {
      droppedCount: answerCooldownDuplicates.size,
      droppedIndices: [...answerCooldownDuplicates].sort((a, b) => a - b),
      originalCount: generated.length,
    });
  }
  const subjectCooldownDuplicates = findSubjectCooldownDuplicates(generated, recentEntities);
  if (subjectCooldownDuplicates.size > 0) {
    console.warn('[daily/generate-questions] dropping subject-cooldown repeats', {
      droppedCount: subjectCooldownDuplicates.size,
      droppedIndices: [...subjectCooldownDuplicates].sort((a, b) => a - b),
      originalCount: generated.length,
    });
  }
  const [batchDuplicates, recentDuplicates, qualityResult, factualResult, answeredHistoryDuplicates] =
    await Promise.all([
      findBatchDuplicates(generated),
      findRecentHistoryDuplicates(generated, recentForGate),
      findQualityFailures(generated),
      findFactualFailures(generated),
      findAnsweredHistoryDuplicates(userId, batchEmbeddings),
    ]);
  // Deterministic, fail-closed backstop to the Haiku findBatchDuplicates gate —
  // synchronous over the same embeddings, so it runs after the Promise.all.
  const intraBatchDuplicates = findIntraBatchEmbeddingDuplicates(batchEmbeddings);

  if (batchDuplicates.size > 0) {
    console.warn('[daily/generate-questions] dropping intra-batch duplicates', {
      droppedCount: batchDuplicates.size,
      droppedIndices: [...batchDuplicates].sort((a, b) => a - b),
      originalCount: generated.length,
    });
  }
  if (intraBatchDuplicates.size > 0) {
    console.warn('[daily/generate-questions] dropping intra-batch duplicates (semantic backstop)', {
      droppedCount: intraBatchDuplicates.size,
      droppedIndices: [...intraBatchDuplicates].sort((a, b) => a - b),
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
  if (answeredHistoryDuplicates.size > 0) {
    console.warn('[daily/generate-questions] dropping answered-history duplicates (semantic)', {
      droppedCount: answeredHistoryDuplicates.size,
      droppedIndices: [...answeredHistoryDuplicates].sort((a, b) => a - b),
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

  // Difficulty-floor backstop: the per-domain target / fixed preference is only a
  // prompt hint, and difficulty_estimate is the model's own label of what it
  // wrote. Drop questions that came back more than one tier below what was asked
  // for (the "specialist Sesame Street → accessible 'what color is Elmo'" case).
  const underDifficulty = findUnderDifficultyQuestions(
    generated,
    domainDifficultyOverrides,
    difficultyPreference,
  );
  // Under-difficulty is a SOFT gate, unlike every hard drop above: these are
  // good, factually-correct, novel questions — only easier than the requested
  // tier. Rather than discard them, mark them by object identity so they survive
  // the hard-drop filter and get persisted, then route their rows to the
  // caller-supplied reserve. The orchestrator taps that reserve only when the
  // queue would otherwise fall below DAILY_QUEUE_SIZE, so difficulty integrity is
  // preserved until the sole alternative is a short Daily Five (the Butkicker
  // case: a tapped-out narrow KB whose only fresh questions read as too easy).
  // With no reserve supplied (e.g. the +2 bonus path) this degrades to the old
  // behaviour — the deflected questions are simply trimmed past `count` below.
  const underDifficultyQuestions = new Set<LlmQuestion>();
  if (underDifficulty.toDrop.size > 0) {
    for (const i of underDifficulty.toDrop) underDifficultyQuestions.add(generated[i]);
    console.warn('[daily/generate-questions] deflecting under-difficulty questions to reserve', {
      deflectedCount: underDifficulty.toDrop.size,
      deflectedIndices: [...underDifficulty.toDrop].sort((a, b) => a - b),
      reasons: underDifficulty.reasons,
      originalCount: generated.length,
    });
  }

  const allDrops = new Set<number>([
    ...batchDuplicates,
    ...intraBatchDuplicates,
    ...recentDuplicates,
    ...answeredHistoryDuplicates,
    ...answerCooldownDuplicates,
    ...subjectCooldownDuplicates,
    ...qualityResult.toDrop,
    ...factualResult.toDrop,
    ...answerLeaks.toDrop,
  ]);
  if (allDrops.size > 0) {
    generated = generated.filter((_, i) => !allDrops.has(i));
    if (generated.length === 0) return [];
  }

  // Order in-tier questions first so they claim the `count` budget; under-
  // difficulty survivors fall to the back and are only persisted (into the
  // reserve) if budget remains after the in-tier ones.
  if (underDifficultyQuestions.size > 0) {
    generated = [
      ...generated.filter((q) => !underDifficultyQuestions.has(q)),
      ...generated.filter((q) => underDifficultyQuestions.has(q)),
    ];
  }

  // Surface question-shape distribution issues so we can see whether the
  // shape-variety prompt instruction is being honored. Not enforced —
  // there's no good fallback if the LLM disregards the shape rule, and
  // dropping questions on shape alone would erode the batch unnecessarily.
  reportShapeDistribution(generated);

  const expiresAt = getNextDailyResetBoundary();
  const persisted: GeneratedQuestionRow[] = [];
  // Persisted rows for questions deflected by the soft under-difficulty gate —
  // returned via options.underDifficultyReserve, never in the main array.
  const underDifficultyPersisted: GeneratedQuestionRow[] = [];
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
  // Answer-key enrichment (Fix 3): enumerate OTHER genuinely-correct answers for
  // multi-answer questions and merge them into acceptable_variants at persist.
  // Distinct from ask-to-answer (which captures the same answer rephrased);
  // additive, batched, and fail-open. Runs in the same parallel wave.
  const [, askResult, enrichByIndex] = await Promise.all([
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
    enrichAcceptableVariants(
      toPersist.map((q) => ({ questionText: q.question_text, answer: q.answer, explainer: q.explainer })),
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

  // Memoize domain reconciliation within the batch: reconcileBankDomain is
  // an LLM-backed lookup, and a pool-mode batch often emits several questions
  // under the same proposed domain. One call per distinct string saves the
  // duplicate Haiku calls AND guarantees identical proposals can't reconcile
  // to different canonical domains within one batch. The corpus label index
  // (B-CATEGORY-BANK-RECONCILE-01) is likewise fetched once for the batch.
  const reconciledByProposed = new Map<string, string>();
  const bankLabelIndex = await getBankLabelIndex();

  for (let persistIndex = 0; persistIndex < toPersist.length; persistIndex += 1) {
    const question = toPersist[persistIndex];
    // Drop ask-to-answer failures: the cold solver contradicted the stored answer.
    if (askResult.toDrop.has(persistIndex)) continue;

    const proposed = question.canonical_subcategory;
    let canonicalDomain = reconciledByProposed.get(proposed);
    if (canonicalDomain === undefined) {
      ({ canonicalDomain } = await reconcileBankDomain(proposed, userId, {
        labelIndex: bankLabelIndex,
      }).catch(() => ({ canonicalDomain: proposed, reconciled: false })));
      reconciledByProposed.set(proposed, canonicalDomain);
    }

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
    // B-KNOWLEDGE-TAXONOMY-01 P3: normalize to the finest existing
    // KnowledgeNode's label (flag-off pass-through — byte-identical to today).
    const taggedDomain = await resolveFinestNode(canonicalDomain);
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
        canonicalSubcategory: taggedDomain,
        // Folded lookup key (BP-7 / C5) — all pool write paths set this.
        domainKey: domainKey(taggedDomain),
        broadCategory: question.broad_category,
        questionText: question.question_text,
        answer: question.answer,
        explainer: question.explainer,
        difficultyEstimate: question.difficulty_estimate,
        basePoints,
        factKey,
        subjectEntity: question.subject_entity,
        subAngles: question.sub_angles,
        insideJoke: insideJokeByQuestion.get(question) ?? null,
        // B-LLM-PROVIDER-AB-SWITCH B3: stamp the provider that generated this row.
        generatedByProvider: provider,
        trustTier,
        askToAnswerVerified,
        // Union the ask-to-answer rephrasings (judge-verified equivalent) with the
        // enrichment gate's additional distinct-but-correct answers (Fix 3).
        acceptableVariants: mergeVariants(
          askResult.variantsByIndex.get(persistIndex),
          enrichByIndex.get(persistIndex),
        ),
        expiresAt,
        usedInQueue: false,
      })
      .returning();
    if (underDifficultyQuestions.has(question)) {
      underDifficultyPersisted.push(row);
    } else {
      persisted.push(row);
    }
  }

  // Semantic-dedup backstop (B1 pool substrate). Best-effort and no-op without
  // VOYAGE_API_KEY, so it never blocks generation; the fact_key/Haiku/text
  // guards above remain the cheap first pass. A new machine row that collides
  // with an existing pool question is flagged is_duplicate (never deleted), so
  // pickBankSource stops serving it. Embedded as ONE batch (not one Voyage call
  // per row) so the concurrent generation cron stops bursting single-item
  // requests into Voyage rate limits and dropping ~1/3 of rows' embeddings
  // (B-DEDUP-EMBED-RELIABILITY) — which had been blinding the answered-history
  // gate to those rows.
  await embedAndResolveDuplicatesBatch(
    [...persisted, ...underDifficultyPersisted].map((row) => ({
      id: row.id,
      origin: 'machine' as const,
      questionText: row.questionText,
      // fact_key lets the dedup keep DISTINCT facts about the same work instead of
      // collapsing them on shared vocabulary (the false-suppression bug).
      factKey: row.factKey ?? null,
    })),
  );

  if (options.underDifficultyReserve && underDifficultyPersisted.length > 0) {
    options.underDifficultyReserve.push(...underDifficultyPersisted);
  }

  return persisted;
}

const DECLARED_DOMAIN_WEIGHT = 0.5;

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
  // recentDomainCounts is keyed by domainKey() (see getRecentDomainCounts), so
  // fold each domain to the same canonical key before looking up its count —
  // otherwise spelling variants miss the bucket and read as fresh (count 0).
  return [...domains].sort(
    (a, b) =>
      (recentDomainCounts.get(domainKey(a)) ?? 0) -
      (recentDomainCounts.get(domainKey(b)) ?? 0),
  );
}

function selectDiverseDomains(
  knowledgeBase: Awaited<ReturnType<typeof getKnowledgeBase>>,
  count: number,
  recentCounts: ReadonlyMap<string, number> = new Map(),
  frequencyByDomain: Record<string, string> = {},
): string[] {
  // Apply the soft cap: drop any domain that has already produced its
  // frequency-scaled weekly quota of questions in the last 7 days (Change 2).
  // Untagged domains keep the historic flat DOMAIN_PER_WEEK_CAP. If every domain
  // is over cap, fall back to the full set rather than starve the queue.
  // recentCounts is keyed by domainKey() (see getRecentDomainCounts); fold the
  // KB domain to the same key so spelling variants share one weekly tally.
  const overCap = (d: { domain: string }): boolean =>
    (recentCounts.get(domainKey(d.domain)) ?? 0) >= domainWeeklyCap(frequencyByDomain[d.domain]);
  const eligibleKb = knowledgeBase.some((d) => !overCap(d))
    ? knowledgeBase.filter((d) => !overCap(d))
    : knowledgeBase;

  // Group by broad category so we can pick one domain per category
  const byCategory = new Map<string, (typeof eligibleKb)[number][]>();
  for (const d of eligibleKb) {
    const cat = normalizeBroadCategory(d.broadCategory) ?? 'General Knowledge';
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
  // underDifficultyReserve: forwarded to generateDailyQuestions so the orchestrator
  // can collect soft difficulty-floor deflections for last-resort backfill.
  // excludeDomains: domains to keep OUT of this round's palette. The orchestrator's
  // top-up loop passes the domains already filling the queue so a short-queue
  // re-generation reaches the user's OTHER selected domains instead of re-sampling
  // the same exhausted few (the "13 interests but a 4-question queue" case). Always
  // falls back to the full palette if exclusion would empty it.
  options: {
    firstRun?: boolean;
    underDifficultyReserve?: GeneratedQuestionRow[];
    excludeDomains?: ReadonlySet<string>;
  } = {},
): Promise<GeneratedQuestionRow[]> {
  const [
    knowledgeBase,
    preferences,
    previousQuestionTexts,
    previousFactKeys,
    recentDomainCounts,
    recentSkipCounts,
    culturalAnchor,
    answeredCanonicalTexts,
  ] = await Promise.all([
    getKnowledgeBase(userId),
    getDailyPreferences(userId),
    getRecentDailyQuestionTexts(userId),
    getRecentFactKeys(userId),
    getRecentDomainCounts(userId).catch(() => new Map<string, number>()),
    getRecentSkipCountsByDomain(userId).catch(() => new Map<string, number>()),
    // Era/regional salience hint (BP-5 / Q3d); resilient — a miss just means
    // the prompt carries no background block.
    getCulturalAnchor(userId).catch(() => null),
    // Cross-table repetition guard (BP-6 / Q8); resilient — a miss just means
    // the avoid list carries no answered-canonical entries this round.
    getRecentAnsweredCanonicalTexts(userId).catch(() => [] as AnsweredCanonicalTextEntry[]),
  ]);
  const adaptiveLevel = preferences.difficulty === 'adaptive'
    ? await updateAdaptiveLevel(userId)
    : FIXED_DIFFICULTY_LEVELS[preferences.difficulty] ?? null;

  const allDomains = knowledgeBase.map((domain) => domain.domain);

  // Lowercased exclusion set (top-up broadening). Applied to the candidate pool
  // BEFORE selection so a re-generation draws from fresh domains; a pure-string
  // filter helper keeps the full palette when exclusion would empty it.
  const excludeLower = new Set(
    [...(options.excludeDomains ?? [])].map((domain) => domain.toLowerCase()),
  );
  const dropExcluded = <T,>(items: readonly T[], key: (item: T) => string): T[] => {
    if (excludeLower.size === 0) return [...items];
    const kept = items.filter((item) => !excludeLower.has(key(item).toLowerCase()));
    return kept.length > 0 ? kept : [...items];
  };

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
    const selectable = dropExcluded(
      preferences.selectedDomains.filter((domain) => allDomains.includes(domain)),
      (domain) => domain,
    );
    const frequencyByDomain = preferences.domainPreferenceFrequency ?? {};
    if (isCustomDomainWeightingEnabled()) {
      // Change 1+2: deterministic, frequency-weighted, recency-aware sample of
      // just the day's domains. Handing generation a SHORT palette (≈ count) is
      // what stops the model gravitating to the fact-rich few and finally makes
      // the 'often'/'sometimes'/'blue_moon' tags proportionally honored across
      // days. Falls back to the full set inside the helper if the weekly cap
      // would otherwise empty the palette.
      const sampled = selectCustomDomainsForRound(
        selectable,
        frequencyByDomain,
        recentDomainCounts,
        count,
      );
      domainsForRound = sampled.length > 0 ? sampled : (selectable.length > 0 ? selectable : allDomains);
    } else {
      // Legacy path (CUSTOM_DOMAIN_WEIGHTING=0): order the WHOLE list least-recent
      // first, then by frequency rank, and hand it all to generation. Kept as an
      // instant, no-redeploy rollback for the weighted pick above.
      const ordered = orderCustomDomainsByLeastRecent(selectable, recentDomainCounts);
      const frequencyRank = (domain: string) => {
        const frequency = frequencyByDomain[domain];
        if (frequency === 'often') return 0;
        if (frequency === 'blue_moon') return 2;
        return 1;
      };
      const weightedOrder = [...ordered].sort((a, b) => frequencyRank(a) - frequencyRank(b));
      domainsForRound = weightedOrder.length > 0 ? weightedOrder : allDomains;
    }
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
    const eligible = dropExcluded(
      knowledgeBase.filter((domain) => !resting.has(domain.domain.toLowerCase())),
      (domain) => domain.domain,
    );
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
      : selectDiverseDomains(eligibleKb, count, recentDomainCounts, frequencyByDomain);
  }

  const domainDifficultyOverrides = preferences.difficulty === 'adaptive'
    ? await getDomainDifficultyOverrides(userId, domainsForRound).catch(() => undefined)
    : undefined;

  // territoryType (declared | demonstrated) per selected domain — threaded into
  // the generation prompt so its register matches the difficulty floor (PRD-D-5
  // §5.2): declared domains read for an enthusiast, demonstrated for a newcomer.
  // strengthByDomain rides the same knowledgeBase read (BP-5 / Q3c): mastery
  // tier/points/correct-count as fan-salience context — never difficulty.
  const territoryByDomain = new Map<string, TerritoryType>();
  const strengthByDomain = new Map<string, DomainStrength>();
  for (const entry of knowledgeBase) {
    territoryByDomain.set(entry.domain, entry.territoryType);
    strengthByDomain.set(entry.domain, {
      tier: entry.tier,
      totalPoints: entry.totalPoints,
      correctAnswerCount: entry.correctAnswerCount,
    });
  }

  const subAnglesByDomain = await getRecentSubAnglesByDomain(userId, domainsForRound).catch(() => undefined);

  // Admin-authored example questions per domain — ground-truth anchors fed into
  // the generation prompt so the model writes from real canon instead of inventing
  // facts for domains it doesn't truly know (the niche-domain hallucination fix,
  // e.g. "Spy School"). Scoped to ADMIN_USER_IDS: a seed is treated as canon, so
  // only a trusted author may anchor a domain. Resilient: a miss (or no admins /
  // no examples) just means no examples block this round.
  const domainExamples = await getAuthoredExamplesForDomains(
    domainsForRound,
    DOMAIN_EXAMPLE_LIMIT,
    adminUserIds(),
  ).catch(() => new Map<string, Array<{ questionText: string; answerText: string }>>());

  // Fold recently-answered canonical texts (domain-scoped, capped) into the
  // avoid list ahead of the generated history, so a fact the player answered
  // yesterday on a friend's / house / forwarded question isn't re-created as a
  // fresh generated question today (BP-6 / Q8). Canonical rows have no
  // fact_key, so this text signal is their only route into avoidance.
  previousQuestionTexts.unshift(
    ...scopeAnsweredCanonicalTexts(answeredCanonicalTexts, domainsForRound),
  );

  // Skip ("pass") calibration — buildUserPrompt's domainSkips block tells the
  // model which of this round's domains the player has recently passed on, so
  // it reaches for a different sub-angle / kind of fact instead of more of the
  // same. recentSkipCounts is keyed by domainKey() (spelling-variant fold);
  // translate to this round's exact domain strings, which is what the prompt
  // builder looks up by. Only >0 entries are kept so the block stays absent
  // for players who never skip.
  const domainSkips = new Map<string, number>();
  for (const domain of domainsForRound) {
    const skipCount = recentSkipCounts.get(domainKey(domain)) ?? 0;
    if (skipCount > 0) domainSkips.set(domain, skipCount);
  }

  // Try to fill slots from the cross-user bank (previously-generated questions
  // for the same domain AND difficulty tier) before burning fresh Sonnet calls.
  // The bank only ever returns rows the viewer hasn't seen — an empty bank for
  // a domain falls through to LLM generation, which incidentally adds new rows
  // back into the pool. Spans accessible/moderate/specialist so harder slots
  // are reused too, not just warm-ups.
  // Tier-adjacent fallback floors (BP-7 / C5): how far DOWN the bank may reach when
  // the requested tier is scarce. Tied to focusDomainMinDifficulty() so the bank's
  // fallback floor tracks the (recalibrated, env-tunable) focus floor — declared
  // domains now fall back to 'accessible' by default instead of stopping at
  // 'moderate', so a tapped-out easy domain reuses its easy bank stock instead of
  // burning a fresh generation. Demonstrated domains already floor at 'accessible'.
  const declaredBankFloor = focusDomainMinDifficulty() as BankDifficulty;
  const bankFallbackFloors = new Map<string, BankDifficulty>();
  for (const entry of knowledgeBase) {
    bankFallbackFloors.set(entry.domain, entry.territoryType === 'declared' ? declaredBankFloor : 'accessible');
  }

  const bankPicks = await pickBankPicksForDomains(
    userId,
    domainsForRound,
    preferences.difficulty,
    domainDifficultyOverrides,
    adaptiveLevel,
    previousFactKeys,
    new Set(),
    bankFallbackFloors,
  );

  const bankFilledDomains = new Set(bankPicks.map((row) => row.canonicalSubcategory));
  let domainsForLlm = domainsForRound.filter((d) => !bankFilledDomains.has(d));
  const remainingCount = count - bankPicks.length;

  // Narrow-KB exhaustion guard (flag-gated, fail-open). Suppress FRESH UNGROUNDED
  // generation for declared-interest domains whose durable pool is still thin —
  // the niche-fiction fabrication case (a 6-book series mined past its real
  // facts). Bank picks above already served any grounded/authored/pooled rows
  // for these domains; the freed slot backfills from the user's other (non-thin)
  // domains via the orchestrator's top-up. Once retrieval-grounded refill deepens
  // a domain's pool past the shared thinness threshold it rejoins generation.
  // See src/server/daily/kb-exhaustion.ts. Default OFF — a no-op until enabled
  // alongside the grounding flip.
  if (isNarrowKbGuardEnabled() && domainsForLlm.length > 0) {
    try {
      const declaredDomains = new Set(
        knowledgeBase.filter((entry) => entry.territoryType === 'declared').map((entry) => entry.domain),
      );
      const poolDepths = await getDurablePoolDepthForDomains(domainsForLlm);
      const excluded = selectUngroundedExcludedDomains(
        domainsForLlm.map((domain) => ({
          domain,
          isDeclaredInterest: declaredDomains.has(domain),
          poolDepth: poolDepths.get(domain) ?? 0,
        })),
        narrowKbThinnessThreshold(),
      );
      if (excluded.size > 0) {
        console.info('[daily/kb-exhaustion] suppressing ungrounded generation for thin declared domains', {
          userId,
          excluded: [...excluded],
          threshold: narrowKbThinnessThreshold(),
        });
        domainsForLlm = domainsForLlm.filter((domain) => !excluded.has(domain));

        // Parent overflow (B-AREA-EXPANSION-01, Phase 5 / R4): hand a thin child's
        // freed slot UP to its recorded expansion parent (broader, deeper pool)
        // instead of letting the orchestrator backfill it from unrelated domains.
        // Only parents the user actually holds as a territory are eligible, so
        // territory/strength prompt context is always present. Gated independently.
        if (isAreaExpansionParentOverflowEnabled()) {
          const parents = await getExpansionParents(userId, [...excluded]);
          const routed = selectOverflowParents(
            parents.values(),
            (domain) => territoryByDomain.has(domain),
            (domain) => bankFilledDomains.has(domain) || domainsForLlm.includes(domain),
          );
          if (routed.length > 0) {
            domainsForLlm.push(...routed);
            console.info('[daily/kb-exhaustion] routed thin domains to expansion parents', {
              userId,
              parents: routed,
            });
          }
        }

        // Near-ness ladder routing (D-NEARNESS-LADDER-HYBRID-01, D2). Route each
        // thin domain's freed slot to a NEAR domain the player already HOLDS
        // (sibling/cousin/parent/grandparent from the cached tree, filtered by the
        // C2 overlay: territory ∪ answer-history ∪ declared). Unheld near rungs are
        // NOT borrowed here — they surface as game-end expansion offers instead. The
        // lazy tree build fires here, on the thin-crossing (decision E1). Gated
        // independently; already inside the guard's fail-open try/catch.
        if (isNearnessTreeEnabled()) {
          const heldKeys = await getHeldDomainKeys(userId);
          const isHeld = (domain: string) =>
            heldKeys.has(domainKey(domain)) || territoryByDomain.has(domain);
          const nearRouted: string[] = [];
          for (const thin of excluded) {
            const rungs = await getOrBuildDomainRungs(thin);
            const routed = selectOverflowParents(
              rungs.map((r) => r.domain),
              isHeld,
              (domain) =>
                bankFilledDomains.has(domain)
                || domainsForLlm.includes(domain)
                || nearRouted.includes(domain),
            );
            nearRouted.push(...routed);
          }
          if (nearRouted.length > 0) {
            domainsForLlm.push(...nearRouted);
            console.info('[daily/nearness] routed thin domains to held near rungs', {
              userId,
              near: nearRouted,
            });
          }
        }
      }
    } catch (error) {
      // Fail open: the guard must never block a build. Proceed ungated.
      console.warn('[daily/kb-exhaustion] guard failed; proceeding ungated', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let llmGenerated: GeneratedQuestionRow[] = [];
  if (remainingCount > 0 && domainsForLlm.length > 0) {
    // B-LLM-PROVIDER-AB-SWITCH B2: resolve the generation provider once per run
    // (cached read; falls back to 'anthropic' on failure) and thread it through.
    const genProvider = (await getProviderSettings()).gen;

    // D-FANDOM-GROUNDING-01 Consumer A (flag-off by default): cached wiki
    // reference passages for exactly the domains going to FRESH generation —
    // fetched here, after bank fill and the exhaustion-guard routing, so
    // bank-served domains never pay a retrieval. Cache-first (one retrieval per
    // domain per day org-wide) and fail-open: a miss just means no reference
    // block this round, same contract as the authored-examples anchor above.
    let domainReferences: DomainReferences | undefined;
    if (isGenerationWikiAnchorEnabled()) {
      domainReferences = await getReferencePassagesForDomains(domainsForLlm).catch((error) => {
        console.warn('[daily/generate-questions] reference retrieval failed; proceeding unanchored', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
        return undefined;
      });
    }

    llmGenerated = await generateDailyQuestions(
      domainsForLlm,
      remainingCount,
      userId,
      previousQuestionTexts,
      [],
      domainSkips.size > 0 ? domainSkips : undefined,
      preferences.difficulty,
      domainDifficultyOverrides,
      adaptiveLevel,
      previousFactKeys,
      subAnglesByDomain,
      territoryByDomain,
      strengthByDomain,
      culturalAnchor,
      {
        underDifficultyReserve: options.underDifficultyReserve,
        provider: genProvider,
        domainExamples,
        domainReferences,
      },
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

  const [previousQuestionTexts, previousFactKeys, authoredTexts, answeredCanonicalTexts] = await Promise.all([
    getRecentDailyQuestionTexts(userId),
    getRecentFactKeys(userId),
    getAuthoredQuestionTexts(userId),
    // Cross-table repetition guard (BP-6 / Q8): a +2 domain is often exactly
    // the domain a milestone click-through just played in, so the bonus is the
    // likeliest surface to re-create a just-answered canonical fact. Advisory
    // fold below, mirroring the authored-texts fold; resilient on failure.
    getRecentAnsweredCanonicalTexts(userId).catch(() => [] as AnsweredCanonicalTextEntry[]),
  ]);

  // A +2 bonus must never hand the viewer a question they themselves authored.
  // Authored questions live in the canonical table, not the generated bank, so
  // the standard avoid lists miss them (D-4 §B invariant: "never a friend's
  // literal answered question"). Fold them into BOTH paths: the Sonnet avoid
  // list (the semantic Haiku dedupe gate then also catches re-wordings) and a
  // normalized-text guard the bank pick honors verbatim.
  const avoidAuthoredTexts = new Set(authoredTexts.map((entry) => normalizeQuestionText(entry.text)));
  previousQuestionTexts.unshift(...authoredTexts.slice(0, AUTHORED_AVOID_TEXT_LIMIT));
  previousQuestionTexts.unshift(...scopeAnsweredCanonicalTexts(answeredCanonicalTexts, domains));

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

// Tier-adjacent fallback order for a bank lookup (BP-7 / C5, approved rule):
// exact tier first, then one step UP (floor-safe by construction — the floor
// means "never condescend", and a one-step stretch cannot condescend), then one
// step DOWN only when it stays at or above the domain's floor. ±1 step only.
// The +2 never gets a ladder (D-4 §B: accessibility is a hard target there —
// a non-accessible pick shrinks the slot), so callers opt in by passing floors.
const BANK_TIER_ORDER: readonly BankDifficulty[] = ['accessible', 'moderate', 'specialist'];

export function bankTierLadder(target: BankDifficulty, floor: BankDifficulty): BankDifficulty[] {
  const t = BANK_TIER_ORDER.indexOf(target);
  const f = BANK_TIER_ORDER.indexOf(floor);
  const ladder: BankDifficulty[] = [target];
  if (t + 1 < BANK_TIER_ORDER.length) ladder.push(BANK_TIER_ORDER[t + 1]);
  if (t - 1 >= 0 && t - 1 >= f) ladder.push(BANK_TIER_ORDER[t - 1]);
  return ladder;
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
  // Per-domain difficulty floors enabling tier-adjacent fallback (BP-7 / C5).
  // Declared territory floors at 'moderate' (the D2/D3 erosion floor),
  // demonstrated at 'accessible'. Absent (the +2 path) → exact-tier only.
  tierFallbackFloors?: ReadonlyMap<string, BankDifficulty>,
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
    const floor = tierFallbackFloors?.get(domain);
    const ladder = floor ? bankTierLadder(difficulty, floor) : [difficulty];

    let source: BankSource | null = null;
    let servedTier: BankDifficulty = difficulty;
    for (const tier of ladder) {
      source = await pickBankSource(userId, domain, tier, avoidFactKeys, avoidQuestionTexts).catch(() => null);
      if (source) {
        servedTier = tier;
        break;
      }
    }
    // BP-7 Phase-3 telemetry: per-domain hit / fall-through, so bank hit rate
    // and the value of flipping retrieval refill on are measurable from logs.
    console.info('[daily/bank-telemetry]', {
      domain,
      outcome: source ? 'hit' : 'fall_through',
      tierRequested: difficulty,
      tierServed: source ? servedTier : null,
      fallbackUsed: Boolean(source) && servedTier !== difficulty,
    });
    if (!source) continue;
    if (isGenericSubcategory(source.canonicalSubcategory)) continue;

    try {
      const [row] = await db
        .insert(generatedQuestions)
        .values({
          userId,
          canonicalSubcategory: source.canonicalSubcategory,
          // Folded lookup key (BP-7 / C5) — all pool write paths set this.
          domainKey: domainKey(source.canonicalSubcategory),
          broadCategory: source.broadCategory,
          questionText: source.questionText,
          answer: source.answer,
          explainer: source.explainer,
          difficultyEstimate: source.difficultyEstimate,
          basePoints: source.basePoints,
          factKey: source.factKey,
          subAngles: source.subAngles,
          // Carry the source row's earned quality/verification fields onto the
          // serving copy (verify-once-reuse-many, PRD-D-5 §3). Without these
          // the copy regressed to defaults: aside lost, acceptable_variants
          // lost (a right-but-rephrased answer graded wrong again on reuse —
          // the exact betrayal B4 fixed), trust tier reset to unverified,
          // provenance dropped (audit 2026-06-10, finding Q4). Play stats
          // (n_answered / empirical_correct_rate) are deliberately NOT copied
          // — they accrue per row.
          insideJoke: source.insideJoke,
          trustTier: source.trustTier,
          askToAnswerVerified: source.askToAnswerVerified,
          acceptableVariants: source.acceptableVariants,
          sourceRefs: source.sourceRefs,
          perishable: source.perishable,
          // B-LLM-PROVIDER-AB-SWITCH B3: carry generation provenance onto the
          // serving copy (this is a duplicate of an already-generated bank row,
          // not a fresh generation) so the copy isn't a provenance black hole.
          generatedByProvider: source.generatedByProvider,
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
