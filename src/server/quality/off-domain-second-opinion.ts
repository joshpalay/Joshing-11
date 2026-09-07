/**
 * Second, independently-worded opinion on an OFF_DOMAIN drift finding
 * (diagnosis/answer-leak-domain-drift-plan.md).
 *
 * The quality gate's own OFF_DOMAIN judgment has a measured false-positive
 * rate: hand-verifying 24 real hits found one that was genuinely correctly
 * filed (a Mozart row whose own gate-generated reason text admitted as much
 * and flagged it anyway) and one defensibly ambiguous case. That failure mode
 * is uniquely dangerous — a wrongly demoted, correctly-filed question is
 * invisible in production forever, with no counter that would ever surface it
 * as wrong.
 *
 * A first attempt at a cheap, deterministic "second opinion" (comparing the
 * row's fact_key vocabulary against its domain's name) was built and
 * REJECTED before shipping: it failed on a real, important case (Mrs.
 * Dalloway under Virginia Woolf) because a specific work's fact_key
 * naturally names the work, not the author — "does this share words with the
 * domain name" cannot encode "is this book by that author" any more than
 * spelling can encode knowledge. That is a genuine limitation of lexical
 * matching, not a tunable threshold, so it was not wired in. See the
 * 2026-09-08 entry in the diagnosis doc for the full story.
 *
 * This module is the corrected approach: a REAL second opinion — an
 * independently-worded LLM call asking the containment question fresh, from
 * the raw question/answer text (deliberately NOT the fact_key or the first
 * gate's own reasoning), with an explicit instruction to side with
 * "correctly filed" whenever uncertain. Only called for rows the primary
 * gate already flagged, so cost is proportional to how often that gate
 * fires, not to generation volume. A row is only safe to auto-drop when
 * BOTH opinions agree.
 */

import {
  HAIKU_MODEL,
  INSTRUCTION_SCOPING_QUALIFIER,
  INSTRUCTION_USER_INPUT_GUIDANCE,
  extractTextContent,
  getAnthropicClient,
  loggedMessagesCreate,
  parseJsonObject,
  wrapUserInput,
} from '@/lib/llm';

export type OffDomainCandidate = {
  canonicalSubcategory: string;
  questionText: string;
  answer: string;
};

const SECOND_OPINION_TIMEOUT_MS = 15_000;

const SYSTEM_PROMPT = `You are the SECOND, INDEPENDENT check on a claim that a trivia question was filed under the wrong category. A different automated check already suspects each item below is OFF_DOMAIN — filed under a label it doesn't actually belong to. Your job is to independently confirm or reject that suspicion. Do not assume the other check is right, and do not just agree with it by default.

For each item, first work out what the question is REALLY about — the specific work, person, or subject the fact concerns — using only the question text and its answer. Then ask: does that specific subject genuinely belong within the STATED domain's scope?

A subject BELONGS when it is the domain's own work, its own creator's other output, or a specific instance the domain's own category legitimately covers (a specific TV show under a TV-genre domain, a specific piece under a composer's-name domain, a specific character or chapter within a work-titled domain).

A subject does NOT belong when it is a different creator's work, a different specific franchise, or an adjacent-but-separate period or movement — even when it is a close contemporary or an easily-confused neighbor.

When you are not confident either way, answer FILED_CORRECTLY. This check exists specifically to catch the OTHER check's false alarms: letting a genuine drift case through costs nothing (it stays measured, not dropped), while wrongly confirming a correctly-filed question as drift costs a good question forever, silently, with nothing that would ever surface the mistake.

Examples:
- Domain "Virginia Woolf's Novels and Essays", question about Mrs. Dalloway's plot → FILED_CORRECTLY (Woolf's own novel).
- Domain "Virginia Woolf's Novels and Essays", question about James Joyce's Ulysses → OFF_DOMAIN (Joyce is a contemporary, not part of Woolf's body of work).
- Domain "Mozart", question about the basset clarinet written for Mozart's Clarinet Concerto → FILED_CORRECTLY (it's about a piece Mozart wrote, even though "basset clarinet" itself isn't Mozart's).
- Domain "Classic Children's Television", question about Sesame Street → FILED_CORRECTLY (a specific show the category covers).
- Domain "Stephen Sondheim Musicals", question about the musical "Rent" → OFF_DOMAIN (Rent is by Jonathan Larson, not Sondheim).

Return JSON only: { "verdicts": { "<index>": "FILED_CORRECTLY" | "OFF_DOMAIN" } } — one entry per item index, using the exact zero-based indices given.${INSTRUCTION_USER_INPUT_GUIDANCE}${INSTRUCTION_SCOPING_QUALIFIER}`;

function buildUserMessage(candidates: readonly OffDomainCandidate[]): string {
  const body = candidates
    .map(
      (c, i) =>
        `[${i}] domain=${c.canonicalSubcategory}\n    q=${c.questionText}\n    a=${c.answer}`,
    )
    .join('\n\n');
  return wrapUserInput('batch', body);
}

/**
 * Given rows the primary gate already flagged OFF_DOMAIN, returns the
 * indices (into `candidates`) this independent check ALSO confirms are
 * off-domain. Fails CLOSED toward safety in the direction that matters here:
 * on any error, parse failure, or missing verdict, that index is left OUT of
 * the confirmed set — an outage can only mean "hold back from auto-drop,"
 * never "silently confirm a drop."
 */
export async function confirmOffDomain(
  candidates: readonly OffDomainCandidate[],
): Promise<Set<number>> {
  if (candidates.length === 0) return new Set();
  const client = getAnthropicClient();
  if (!client) return new Set();

  try {
    const response = await loggedMessagesCreate(
      client,
      'off-domain-second-opinion',
      {
        model: HAIKU_MODEL,
        max_tokens: 500,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserMessage(candidates) }],
      },
      { timeoutMs: SECOND_OPINION_TIMEOUT_MS },
    );
    const parsed = parseJsonObject(extractTextContent(response.content));
    const verdicts = parsed?.verdicts;
    const confirmed = new Set<number>();
    if (verdicts && typeof verdicts === 'object' && !Array.isArray(verdicts)) {
      for (const [key, value] of Object.entries(verdicts as Record<string, unknown>)) {
        const idx = Number.parseInt(key, 10);
        if (
          Number.isInteger(idx) &&
          idx >= 0 &&
          idx < candidates.length &&
          value === 'OFF_DOMAIN'
        ) {
          confirmed.add(idx);
        }
      }
    }
    return confirmed;
  } catch (error) {
    console.warn('[confirmOffDomain] request_failed — holding back from auto-drop', {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Set();
  }
}
