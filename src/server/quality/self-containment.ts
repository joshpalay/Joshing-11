/**
 * Self-containment classifier (bank-healing follow-up to the generation-side
 * "NAME THE SOURCE" rule, PR #1500).
 *
 * A served card shows the player ONLY the question text and a BROAD category
 * label (e.g. "Film & Television") — never the canonical_subcategory. So a
 * question that leans on a specific work/franchise/character it never names is
 * unanswerable out of context ("At the start of most episodes, Candace notices
 * the boys' project — whom does she call to get them busted?" never says it is
 * Phineas and Ferb). Rule 2b stops NEW such questions; this classifier finds the
 * ones already in the bank.
 *
 * Why an LLM and not a lexical rule: a pure heuristic fired on ~44% of the live
 * bank because good questions name a CHILD work ("Revenge of the Sith") under a
 * PARENT subcategory ("Star Wars Universe"), so token-absence + a proper noun
 * co-occur constantly on fine questions. Distinguishing "names the work by title"
 * from "names only characters" is semantic. Haiku (grading tier) does it directly.
 *
 * DEMOTE-ONLY and BIASED TOWARD self-contained: this is a background quality net,
 * so the cost of a false demote (suppressing a good question) is worse than a
 * miss. The prompt is told to return self_contained=true whenever a reasonably
 * informed player could situate the question — the source need not be spelled out
 * if the content makes it unambiguous (a real-world subject, a famous event, a
 * universally known character). Returns null on any failure (no client, request
 * error, unparseable) so the caller leaves the row untouched (fail-open).
 */

import {
  HAIKU_MODEL,
  HAIKU_GATE_TIMEOUT_MS,
  INSTRUCTION_USER_INPUT_GUIDANCE,
  extractTextContent,
  getAnthropicClient,
  loggedMessagesCreate,
  parseJsonObject,
  wrapUserInput,
} from '@/lib/llm';

export type SelfContainmentInput = {
  questionText: string;
  answer: string;
  /** The domain the question belongs to — the PLAYER never sees this; it is the
   *  ground truth of what the question is supposed to be about. */
  canonicalSubcategory: string | null;
  /** The only category label the player DOES see on the card. */
  broadCategory: string | null;
};

export type SelfContainmentVerdict = {
  /** true = a player seeing only the question + broad category can tell what it
   *  is about; false = it silently assumes the hidden subject. */
  selfContained: boolean;
  reason: string;
};

const SYSTEM_PROMPT = `You are auditing ONE published trivia question for SELF-CONTAINMENT. You are NOT fact-checking it and you are NOT judging its difficulty.

Apply this test — and ONLY this test:

Does the question text itself contain an explicit NAME of what it is about — a work title, franchise, series, book, film, show, game, album, author, artist, composer, real place, real person, real event, field of study, or historical period?
- If YES → self_contained = TRUE. Stop. It does not matter whether the name is a parent or a child ("Tears of the Kingdom" names it even if the filed subject is "The Legend of Zelda"; "in Breaking Bad" names it; "David Foster Wallace" names the author). It does NOT matter whether an average player would RECOGNIZE or have heard of that name — an obscure-but-NAMED work is self-contained. Recognizing it is DIFFICULTY, which is not your concern.
- If NO explicit name appears → is the question nonetheless situated by universally-known real-world content (a famous event, a world-historical figure, a household-name character like Sherlock Holmes or Dracula)? If yes → TRUE.
- If NO explicit name appears → does the question pose a self-contained real-world SCENARIO answerable from general knowledge of its field (a described legal, scientific, mathematical, or procedural situation — "During a closing argument, the attorney misstates the evidence; what objection applies?")? If yes → TRUE. Such a question needs no proper name because it supplies its own context.
- Only if NONE of the above holds → self_contained = FALSE: the question leans entirely on characters, plot beats, quotes, or invented terms from a specific work it NEVER names, so a player cannot tell which work it is. Example: "At the start of most episodes, Candace notices the boys' project — whom does she call to get them busted?" — names only characters, never says Phineas and Ferb.

CRITICAL: before returning FALSE, re-scan the question text for ANY proper name of a work/author/place/person/event. If one is present anywhere in the text, you MUST return TRUE — even a subtitle alone ("In 'Deathly Hallows'…"), even a fictional-but-titled work ("Spy School Goes South"), even an author's name with no work. FALSE is ONLY for questions with NO such name at all.

BIAS HARD TOWARD self_contained. This flags questions for REMOVAL, so a wrong FALSE deletes a good question. When in any doubt, return TRUE.

Return ONLY valid JSON: { "self_contained": true | false, "reason": "<short, ≤ 140 chars: if false, state that NO work/subject name appears; if true, quote the name that appears>" }. No prose outside the object.${INSTRUCTION_USER_INPUT_GUIDANCE}`;

function buildUserMessage(input: SelfContainmentInput): string {
  const lines = [
    wrapUserInput('question', input.questionText),
    wrapUserInput('stated_answer', input.answer),
    wrapUserInput('broad_category_player_sees', input.broadCategory ?? '(none)'),
    wrapUserInput('subject_hidden_from_player', input.canonicalSubcategory ?? '(none)'),
    'Judge self-containment as the player sees it. Return JSON only.',
  ];
  return lines.join('\n');
}

// Stopwords dropped from a subcategory label before token-matching it against
// the question. Small and lowercase.
const SUBJECT_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'by', 'with', 'from',
  'series', 'books', 'book', 'show', 'tv', 'movie', 'film', 'novel', 'season', 'seasons',
]);

/**
 * Pure LAST-RESORT DEMOTE GUARD: true when the question text literally contains a
 * significant token of its own subcategory — i.e. the source IS named, whatever
 * the LLM said. Used to VETO a `not self-contained` verdict so a Haiku
 * hallucination ("'Breath of the Wild' is not mentioned" when it plainly is)
 * can never demote a question that names its source. It only ever PREVENTS a
 * demotion — it can never cause one — so it is strictly safe. Exported for tests.
 */
export function questionNamesSubject(
  questionText: string,
  canonicalSubcategory: string | null | undefined,
): boolean {
  if (!canonicalSubcategory) return false;
  const tokens = canonicalSubcategory
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !SUBJECT_STOPWORDS.has(t));
  if (tokens.length === 0) return false;
  const haystack = ` ${questionText.toLowerCase()} `;
  return tokens.some((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(haystack));
}

/** Pure: parse the classifier's JSON verdict. Exported for unit tests. */
export function parseSelfContainmentVerdict(raw: string): SelfContainmentVerdict | null {
  const parsed = parseJsonObject(raw);
  if (!parsed) return null;
  if (typeof parsed.self_contained !== 'boolean') return null;
  const reason = typeof parsed.reason === 'string' ? parsed.reason.trim().slice(0, 200) : '';
  return {
    selfContained: parsed.self_contained,
    reason: reason || (parsed.self_contained ? 'self-contained' : 'not self-contained'),
  };
}

/**
 * Classify one question. Returns null on ANY failure (no client, request error,
 * unparseable verdict) so the caller leaves the row untouched — fail-open,
 * matching the verification sweep's posture.
 */
export async function classifySelfContainment(
  input: SelfContainmentInput,
): Promise<SelfContainmentVerdict | null> {
  const client = getAnthropicClient();
  if (!client) return null;

  let response;
  try {
    response = await loggedMessagesCreate(
      client,
      'self-containment',
      {
        model: HAIKU_MODEL,
        max_tokens: 200,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserMessage(input) }],
      },
      { timeoutMs: HAIKU_GATE_TIMEOUT_MS },
    );
  } catch (error) {
    console.warn('[classifySelfContainment] request_failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const parsed = parseSelfContainmentVerdict(extractTextContent(response.content));
  if (!parsed) {
    console.warn('[classifySelfContainment] invalid_verdict_json');
    return null;
  }
  return parsed;
}
