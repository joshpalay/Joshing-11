import { extractTextContent, getAnthropicClient, loggedMessagesCreate, parseJsonObject } from '@/lib/llm';
import { getKnowledgeBase } from '@/server/db/queries/daily';
import { domainKey } from '@/lib/knowledge/domain-key';

const RECONCILE_MODEL = 'claude-haiku-4-5-20251001';
const RECONCILE_TIMEOUT_MS = 3000;

const RECONCILE_SYSTEM_PROMPT = `You are reconciling a proposed trivia domain label against a user's existing domain list.

Two labels refer to the SAME domain ONLY when they name the same SCOPE — the same work, artist, period, or discipline — differing only in wording, casing, or punctuation. A sub-angle of a single work (its characters, themes, a chapter) folds into that exact work.

CRITICAL — never fold across granularity. A specific work, title, character, or entity is NOT the same domain as a broader genre, period, author body, series, or category that merely CONTAINS it. When in doubt, return matchesExisting:false — keeping a narrow label separate is always safe; collapsing it into a broad one silently makes the broad domain serve only that narrow slice.

Examples of same-domain pairs (fold):
- "Mrs. Dalloway – Characters" and "Mrs. Dalloway" → same (sub-angle of the same work)
- "Late Tchaikovsky" and "Tchaikovsky's Late Period" → same (phrasing)
- "Joyce's Ulysses" and "James Joyce's Ulysses" → same (phrasing)

Examples of different-domain pairs (DO NOT fold):
- "Hamlet" and "Shakespearean Tragedy" → different (a specific play is not its genre)
- "Sweeney Todd" and "Stephen Sondheim Musicals" → different (one musical is not the whole catalog)
- "The Battle of Hastings" and "Medieval English History" → different (an event is not the period)
- "Tchaikovsky" and "Stravinsky" → different
- "Renaissance Painting" and "Baroque Painting" → different

Respond in JSON only: { "matchesExisting": true | false, "matchedDomain": "..." | null, "rationale": "brief explanation" }`;

export async function reconcileProposedDomain(
  proposedDomain: string,
  userId: string,
  options: { additionalDomains?: string[] } = {},
): Promise<{ canonicalDomain: string; reconciled: boolean }> {
  const fallback = { canonicalDomain: proposedDomain, reconciled: false };

  try {
    const knowledgeBase = await getKnowledgeBase(userId);
    const userDomains = knowledgeBase.map((d) => d.domain);

    // Tier-1: append well-established GLOBAL domains (deduped by domainKey, the
    // user's own spelling winning) so a label folds onto an existing domain even
    // when it lives on another account (e.g. the house Library), not just the
    // author's KB. The candidate cap keeps the Haiku prompt bounded.
    const seen = new Set(userDomains.map((d) => domainKey(d)));
    const extraDomains: string[] = [];
    for (const d of options.additionalDomains ?? []) {
      const k = domainKey(d);
      if (seen.has(k)) continue;
      seen.add(k);
      extraDomains.push(d);
    }
    const existingDomains = [...userDomains, ...extraDomains];
    if (existingDomains.length === 0) return fallback;

    // If the proposed domain folds to an existing one's domainKey (the same
    // typographic fold the territory layer groups by — apostrophes, connectors,
    // case), no LLM needed: adopt the existing spelling so the corpus converges
    // instead of minting "Star Trek – TNG" alongside "Star Trek: TNG". User-KB
    // labels precede additionalDomains in existingDomains, so the player's own
    // spelling wins a collision.
    const proposedKey = domainKey(proposedDomain);
    const exactMatch = existingDomains.find((d) => domainKey(d) === proposedKey);
    if (exactMatch) return { canonicalDomain: exactMatch, reconciled: false };

    const client = getAnthropicClient();
    if (!client) return fallback;

    const userMessage = `Proposed: "${proposedDomain}"
Existing domains:
${existingDomains.map((d) => `- ${d}`).join('\n')}`;

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('reconcile timeout')), RECONCILE_TIMEOUT_MS),
    );

    const responsePromise = loggedMessagesCreate(client, 'reconcile-subcategory', {
      model: RECONCILE_MODEL,
      max_tokens: 256,
      temperature: 0,
      system: RECONCILE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const response = await Promise.race([responsePromise, timeoutPromise]);
    const text = extractTextContent(response.content);
    const parsed = parseJsonObject(text);

    if (!parsed) return fallback;

    const matchesExisting = Boolean(parsed.matchesExisting);
    const matchedDomain =
      typeof parsed.matchedDomain === 'string' ? parsed.matchedDomain.trim() : null;
    const rationale =
      typeof parsed.rationale === 'string' ? parsed.rationale.trim() : '';

    if (matchesExisting && matchedDomain) {
      console.log(
        `[reconcile] proposed="${proposedDomain}" canonical="${matchedDomain}" reconciled=true rationale="${rationale}"`,
      );
      return { canonicalDomain: matchedDomain, reconciled: true };
    }

    console.log(
      `[reconcile] proposed="${proposedDomain}" canonical="${proposedDomain}" reconciled=false rationale="${rationale}"`,
    );
    return fallback;
  } catch (err) {
    console.warn('[reconcile] error, falling back to proposed domain', {
      proposedDomain,
      error: err instanceof Error ? err.message : 'unknown',
    });
    return fallback;
  }
}
