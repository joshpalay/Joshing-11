import {
  HAIKU_MODEL,
  extractTextContent,
  getAnthropicClient,
  loggedMessagesCreate,
  parseJsonObject,
  wrapUserInput,
} from '@/lib/llm';

/**
 * Mastery v2 (docs/thinking/MASTERY-MODEL-v2.md) depth-weight LLM FALLBACK.
 *
 * The node-weight seed prefers Wikidata child-count; this covers the topics
 * Wikidata can't resolve (hyper-specific Joshing territories — "Spy School Books
 * 1-6"). Returns a breadth/depth score on a 1–10 scale ("how much is there to
 * know about this topic?"), or null when unavailable.
 *
 * Haiku per the categorization/grading model split (CLAUDE.md). FAILS OPEN: an
 * absent client, an outage, or a malformed response returns null so the caller
 * simply leaves the node unseeded (readers fall back to the code default).
 */
export async function scoreDomainDepth(label: string): Promise<number | null> {
  const clean = label.trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!clean) return null;

  const client = getAnthropicClient();
  if (!client) return null;

  const systemPrompt = `Rate how much there is to know about a trivia topic — its breadth and depth — on an integer scale from 1 to 10.
This is a TOPIC-SIZE judgement, independent of how popular it is:
- 1-2: a single narrow thing — one short poem, one minor character, one small event.
- 3-4: a focused subject — one novel, one album, one battle, one lesser figure.
- 5-6: a substantial subject — a major author's body of work, a film franchise, a decade of a genre.
- 7-8: a large field — a national literature, a musical era, a war, a scientific discipline's subfield.
- 9-10: a vast domain — an entire art form, a whole science, a millennium of history.
Judge the topic's real-world size, not its fame (a huge fandom does not make a topic deep).
Respond in JSON only: { "depth": &lt;integer 1-10&gt; }`;

  try {
    // ~250 tokens — below Haiku's 2048 cache threshold; plain string system.
    const response = await loggedMessagesCreate(client, 'node-weight-depth', {
      model: HAIKU_MODEL,
      max_tokens: 40,
      temperature: 0.1,
      system: systemPrompt,
      messages: [{ role: 'user', content: wrapUserInput('topic', clean) }],
    });

    const parsed = parseJsonObject(extractTextContent(response.content));
    const raw = parsed?.depth ?? parsed?.score;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n)) return null;
    return Math.max(1, Math.min(10, Math.round(n)));
  } catch {
    return null;
  }
}
