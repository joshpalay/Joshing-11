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

export const MIN_MASTERY_THRESHOLD = 300;
export const MAX_MASTERY_THRESHOLD = 40_000;

/**
 * Mastery v2 (points-threshold model) — estimate how many POINTS of trivia play
 * demonstrate mastery of a topic, in the game's own scoring currency (a correct
 * answer earns ~10 easy / ~50 moderate / ~100 hard). This seeds
 * `KnowledgeNode.mastery_threshold` for every node — a leaf gets a modest number,
 * a parent (whole area) a large one. Returns null when unavailable.
 *
 * Haiku (categorization tier). FAILS OPEN: absent client / outage / malformed →
 * null, so the caller leaves the node unseeded (reader falls back to the default).
 */
export async function scoreMasteryThresholdPoints(label: string): Promise<number | null> {
  const clean = label.trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!clean) return null;

  const client = getAnthropicClient();
  if (!client) return null;

  const systemPrompt = `Estimate how many POINTS of trivia play demonstrate real MASTERY of a topic.
Scoring currency: a correct answer earns ~10 (easy), ~50 (moderate), ~100 (hard) — so mastery = correctly answering enough of the topic's questions.
Judge the topic's real-world SIZE, not its fame. Anchors:
- a single narrow work or event (one poem, one battle, one minor character): 300–800
- a focused subject (one novel, one album, a lesser figure): 800–2,000
- a major figure's body of work, a franchise, a decade of a genre: 2,000–6,000
- a large field (a national literature, a war, a scientific subfield): 6,000–15,000
- a vast domain (a whole art form, a science, a millennium of history): 15,000–40,000
Respond in JSON only: { "points": &lt;integer&gt; }`;

  try {
    const response = await loggedMessagesCreate(client, 'mastery-threshold-points', {
      model: HAIKU_MODEL,
      max_tokens: 40,
      temperature: 0.1,
      system: systemPrompt,
      messages: [{ role: 'user', content: wrapUserInput('topic', clean) }],
    });

    const parsed = parseJsonObject(extractTextContent(response.content));
    const raw = parsed?.points ?? parsed?.threshold;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n)) return null;
    // Round to the nearest 100 and clamp to a sane band.
    const rounded = Math.round(n / 100) * 100;
    return Math.max(MIN_MASTERY_THRESHOLD, Math.min(MAX_MASTERY_THRESHOLD, rounded));
  } catch {
    return null;
  }
}
