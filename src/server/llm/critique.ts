import {
  ANTHROPIC_MODEL,
  INSTRUCTION_USER_INPUT_GUIDANCE,
  extractTextContent,
  getAnthropicClient,
  loggedMessagesCreate,
  parseJsonObject,
  wrapUserInput,
} from '@/lib/llm';

export type CritiqueResult =
  | { ok: true }
  | { ok: false; issues: string[]; reformulations: string[] };

const CRITIQUE_TIMEOUT_MS = 8_000;

function cleanStringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);
}

function parseCritique(rawText: string): CritiqueResult {
  const parsed = parseJsonObject(rawText);
  if (!parsed || parsed.ok === true) return { ok: true };
  if (parsed.ok !== false) return { ok: true };

  const issues = cleanStringArray(parsed.issues, 3);
  const reformulations = cleanStringArray(parsed.reformulations, 4);
  if (issues.length === 0 || reformulations.length < 2) return { ok: true };
  return { ok: false, issues, reformulations };
}

export async function critiqueQuestion(params: { questionText: string }): Promise<CritiqueResult> {
  const questionText = params.questionText.trim();
  if (!questionText) return { ok: true };

  const client = getAnthropicClient();
  if (!client) return { ok: true };

  const prompt = `You are reviewing a trivia question for ambiguity, scope, and answerability. Your job is to flag questions that have problems — not to be a perfectionist about every minor phrasing issue.

A question is OK if:
- It has a single, clear, factual answer (or a small set of obviously equivalent answers)
- It is specific enough that a knowledgeable person would know what is being asked
- It is about facts, not opinions or preferences
- It is grammatically clear

A question is NOT OK if:
- It has multiple equally valid answers ("What's the best Beatles song?" — opinion; "What year was Casablanca made?" — single fact, OK)
- It is too vague to answer ("Tell me about Tchaikovsky" — too open)
- It asks for an opinion or preference
- It contains factual errors or false premises
- It is so broad that a correct answer could be any of dozens of things
- It contains or telegraphs its own answer ("What is the capital of France, which is Paris?" — self-answering; "Who wrote the 1922 poem 'The Waste Land' by T. S. Eliot?" — names the author it is asking for)

Question to review: ${wrapUserInput('question', questionText)}

Respond in JSON only.
If the question is OK: { "ok": true }
If the question has problems: { "ok": false, "issues": ["brief issue 1", "brief issue 2"], "reformulations": [ "alternative phrasing 1", "alternative phrasing 2", "alternative phrasing 3" ] }

Issue descriptions should be short (under 12 words each), specific, and helpful. Examples:
- "Multiple Tchaikovsky symphonies could be the answer."
- "Asks for opinion rather than fact."
- "Date range is too broad to have a single answer."
- "Question reveals its own answer."

Reformulations should preserve the author's apparent intent while fixing the issue. Provide 2-4 reformulations, ordered most to least faithful to the original.`;

  try {
    // loggedMessagesCreate enforces the timeout via AbortSignal — no more
    // Promise.race + setTimeout (which leaked a timer on the success path).
    const response = await loggedMessagesCreate(client, 'critique', {
      model: ANTHROPIC_MODEL,
      max_tokens: 700,
      temperature: 0.2,
      system: `Return only valid JSON. No markdown or prose outside JSON.${INSTRUCTION_USER_INPUT_GUIDANCE}`,
      messages: [{ role: 'user', content: prompt }],
    }, { timeoutMs: CRITIQUE_TIMEOUT_MS });
    const rawText = extractTextContent(response.content);
    const result = parseCritique(rawText);
    console.info('[llm/critique] completed', { input: questionText, output: result });
    return result;
  } catch (error) {
    console.warn('[llm/critique] fail_open', {
      input: questionText,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: true };
  }
}
