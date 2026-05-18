import { extractTextContent, getAnthropicClient, loggedMessagesCreate, parseJsonObject } from '@/lib/llm';
import { getKnowledgeBase } from '@/server/db/queries/daily';

const RECONCILE_MODEL = 'claude-haiku-4-5';
const RECONCILE_TIMEOUT_MS = 3000;

const RECONCILE_SYSTEM_PROMPT = `You are reconciling a proposed trivia domain label against a user's existing domain list.

Does the proposed label refer to the same body of knowledge as any existing domain? Two labels refer to the same domain if they identify the same work, artist, period, or discipline — even if the wording differs.

Examples of same-domain pairs:
- "Mrs. Dalloway – Characters" and "Mrs. Dalloway" → same
- "Late Tchaikovsky" and "Tchaikovsky's Late Period" → same
- "Joyce's Ulysses" and "James Joyce's Ulysses" → same

Examples of different-domain pairs:
- "Tchaikovsky" and "Stravinsky" → different
- "Mrs. Dalloway" and "To the Lighthouse" → different
- "Renaissance Painting" and "Baroque Painting" → different

Respond in JSON only: { "matchesExisting": true | false, "matchedDomain": "..." | null, "rationale": "brief explanation" }`;

export async function reconcileProposedDomain(
  proposedDomain: string,
  userId: string,
): Promise<{ canonicalDomain: string; reconciled: boolean }> {
  const fallback = { canonicalDomain: proposedDomain, reconciled: false };

  try {
    const knowledgeBase = await getKnowledgeBase(userId);
    if (knowledgeBase.length === 0) return fallback;

    const existingDomains = knowledgeBase.map((d) => d.domain);

    // If the proposed domain exactly matches an existing one (case-insensitive), no LLM needed.
    const exactMatch = existingDomains.find(
      (d) => d.toLowerCase() === proposedDomain.toLowerCase(),
    );
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
