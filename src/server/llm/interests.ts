import {
  ANTHROPIC_MODEL,
  HAIKU_MODEL,
  extractTextContent,
  getAnthropicClient,
  loggedMessagesCreate,
  parseJsonObject,
} from '@/lib/llm';
import { normalizeBroadCategory } from '@/lib/knowledge/broad-category';

export type WarmupAnswers = {
  deepDive?: string;
  hourLongTopic?: string;
  anythingElse?: string;
};

export type CulturalAnchor = {
  birthYear: number;
  grewUpCountry: string;
  grewUpRegion?: string;
};

export type ProposedInterest = {
  domain: string;
  broadCategory: string;
  rationale: string;
};

export type CanonicalizedInterest = {
  suggested: string;
  broadCategory: string;
  explanation: string;
};

const CANONICALIZE_MODEL = HAIKU_MODEL;
const WARMUP_LABELS: Record<keyof WarmupAnswers, string> = {
  deepDive: 'book, composer, or filmmaker you have gone deep on',
  hourLongTopic: 'topic you could talk about for an hour without preparation',
  anythingElse: 'anything else — a period of history, a sport, a field you studied',
};
const FALLBACK_CATEGORIES = [
  'Literature',
  'Music',
  'Film & Television',
  'History',
  'Science',
  'Pop Culture',
];

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((word) => (word ? `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}` : ''))
    .join(' ')
    .trim();
}

function cleanWarmupAnswers(warmupAnswers: WarmupAnswers): Array<{ field: keyof WarmupAnswers; answer: string }> {
  return (Object.keys(WARMUP_LABELS) as Array<keyof WarmupAnswers>).flatMap((field) => {
    const answer = asTrimmedString(warmupAnswers[field]);
    return answer ? [{ field, answer: answer.slice(0, 200) }] : [];
  });
}

function parseJsonArray(rawText: string): unknown[] | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  const candidates: string[] = [trimmed];
  const fencedJsonBlocks = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const match of fencedJsonBlocks) {
    const block = match[1]?.trim();
    if (block) candidates.push(block);
  }

  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start !== -1 && end > start) {
    candidates.push(trimmed.slice(start, end + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

function fallbackInterests(cleanAnswers: Array<{ field: keyof WarmupAnswers; answer: string }>): ProposedInterest[] {
  const candidates = cleanAnswers
    .map(({ field, answer }, index) => {
      const domain = titleCase(
        answer
          .replace(/[^\p{L}\p{N}\s'&-]/gu, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .split(/\s+/)
          .slice(0, 5)
          .join(' '),
      );

      if (domain.length < 2) return null;

      return {
        domain,
        broadCategory: FALLBACK_CATEGORIES[index % FALLBACK_CATEGORIES.length] ?? 'General Knowledge',
        rationale: `Based on your answer for ${WARMUP_LABELS[field]}.`,
      };
    })
    .filter((interest): interest is ProposedInterest => Boolean(interest));

  const defaults: ProposedInterest[] = [
    {
      domain: 'Modern Literary Fiction',
      broadCategory: 'Literature',
      rationale: 'A focused reading territory that can support rich trivia.',
    },
    {
      domain: 'Auteur Film Favorites',
      broadCategory: 'Film & Television',
      rationale: 'A film-specific lane that can be narrowed further as you play.',
    },
    {
      domain: 'Personal Canon Music',
      broadCategory: 'Music',
      rationale: 'A music lane based on artists you return to often.',
    },
    {
      domain: 'Recent Cultural Obsessions',
      broadCategory: 'Pop Culture',
      rationale: 'A flexible lane for recurring references and current fixations.',
    },
    {
      domain: '20th-Century Cultural History',
      broadCategory: 'History',
      rationale: 'A historically grounded lane for specific eras and movements.',
    },
    {
      domain: 'Everyday Science Concepts',
      broadCategory: 'Science',
      rationale: 'A factual lane that tends to generate accessible questions.',
    },
  ];

  return uniqueByDomain([...candidates, ...defaults]).slice(0, 14);
}

function normalizeInterest(value: unknown): ProposedInterest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const domain = asTrimmedString(record.domain ?? record.label);
  const broadCategory = asTrimmedString(record.broadCategory ?? record.broad_category);
  const rationale = asTrimmedString(record.rationale ?? record.description);

  if (!domain || !broadCategory || !rationale) return null;

  return {
    domain: domain.slice(0, 100),
    broadCategory: (normalizeBroadCategory(broadCategory) ?? 'General Knowledge').slice(0, 80),
    rationale: rationale.slice(0, 180),
  };
}

function uniqueByDomain(interests: ProposedInterest[]): ProposedInterest[] {
  const seen = new Set<string>();
  const unique: ProposedInterest[] = [];

  for (const interest of interests) {
    const key = interest.domain.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(interest);
  }

  return unique;
}

export async function proposeInterests(input: {
  warmupAnswers: WarmupAnswers;
  culturalAnchor?: CulturalAnchor;
}): Promise<ProposedInterest[]> {
  const { warmupAnswers, culturalAnchor } = input;
  const cleanAnswers = cleanWarmupAnswers(warmupAnswers);

  if (cleanAnswers.length === 0) {
    return fallbackInterests([]);
  }

  const demographicLine = buildCulturalAnchorPrompt(culturalAnchor);

  const systemPrompt = `You propose declared interests for Joshing, a daily personal trivia game.
Return a JSON array only. No wrapper object, no markdown:
[
  { "domain": "...", "broadCategory": "...", "rationale": "..." }
]

Rules:
- Generate exactly 10 to 14 candidate interests.
- Every domain must be hyper-specific and useful for trivia.
- Avoid broad categories as domains. Never use domains like "Music", "Literature", "History", "Film", "Science", or "Pop Culture".
- Prefer person/era/movement/work/scene labels over generic fields.
- Good domains: "Late Tchaikovsky", "19th-Century Russian Symphonies", "Modernist American Poetry", "Weimar-Era Cinema".
- Bad domains: "Music", "Books", "Movies", "History", "General Trivia".
- Distribute across the warm-up answers. Include at least one candidate per non-empty warm-up field if possible.
- Each rationale must briefly tie the candidate to a specific warm-up answer or demographic context.
- broadCategory is a stable top-level bucket, such as Music, Literature, Film & Television, History, Science, Philosophy, Sports, Pop Culture, Language, General Knowledge. It must not be an author/work/movement-specific territory; for example, James Joyce, Irish Modernism, novels, poetry, and fiction all use Literature.
- Never return "Other" as a broadCategory. Use "General Knowledge" only when no more precise top-level bucket applies.
- Do not invent private facts. Infer plausible interest territories only from the answers and cultural anchor context.${demographicLine ? `\n\n${demographicLine}` : ''}`;

  const userMessage = `Warm-up answers:
${cleanAnswers.map(({ field, answer }) => `- ${WARMUP_LABELS[field]}: ${answer}`).join('\n')}

Propose candidate interests. Return JSON array only.`;

  const client = getAnthropicClient();
  if (!client) return fallbackInterests(cleanAnswers);

  const response = await loggedMessagesCreate(client, 'interests-suggest', {
    model: ANTHROPIC_MODEL,
    max_tokens: 1600,
    temperature: 0.65,
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = extractTextContent(response.content);
  const parsed = parseJsonArray(text);
  const interests = uniqueByDomain((parsed ?? []).flatMap((interest) => {
    const normalized = normalizeInterest(interest);
    return normalized ? [normalized] : [];
  }));

  if (interests.length < 10) {
    return uniqueByDomain([...interests, ...fallbackInterests(cleanAnswers)]).slice(0, 14);
  }

  return interests.slice(0, 14);
}

function buildCulturalAnchorPrompt(anchor: CulturalAnchor | undefined): string {
  if (!anchor) return '';

  const { birthYear, grewUpCountry, grewUpRegion } = anchor;
  const location = [grewUpRegion, grewUpCountry].filter(Boolean).join(', ');

  return `The player was born in ${birthYear} and grew up in ${location}. Use this to infer culturally-specific knowledge domains from that era and place — television, music, film, political events, sports, advertising, popular books, religious or civic touchstones — that someone of that age and geography would plausibly know well.

Geography determines cultural context. Someone who grew up in Iran in the 1980s shares neither the American TV landscape nor the British one. Someone who grew up in suburban Michigan in the late 1970s shares neither the New York City cultural landscape nor the rural Midwestern one in detail.

Combine cultural anchor signal with the player's warm-up answers to generate 10-14 candidate domains at hyper-specific granularity.

Examples of good culturally-anchored candidates:
- Born 1979, suburban Michigan: 'Saturday Morning Cartoons of the 1980s', 'He-Man and the Masters of the Universe', 'Animaniacs', 'Early MTV (1981-1987)', 'Top 40 Radio of the Late 1980s'
- Born 1968, London: 'British New Wave Cinema', 'Post-Punk UK Music', 'Thatcher-Era British Television', '1970s BBC Drama'

Do NOT generate generic domains like 'Music', 'Television', 'History'. Always specify era + place + medium when culturally anchored.`;
}

export async function canonicalizeInterest(rawInput: string): Promise<CanonicalizedInterest> {
  const cleanInput = rawInput.trim().replace(/\s+/g, ' ').slice(0, 100);
  const fallback: CanonicalizedInterest = {
    suggested: cleanInput,
    broadCategory: 'General Knowledge',
    explanation: 'Kept your original wording because a suggestion was not available.',
  };

  if (!cleanInput) return fallback;

  const client = getAnthropicClient();
  if (!client) return fallback;

  const systemPrompt = `The user wants to add this as a declared trivia interest.
Suggest a more hyper-specific version that would generate good trivia questions. If the input is already specific enough, return it unchanged.
Avoid broad categories like "Music", "Literature", "History". Prefer forms like "Late Tchaikovsky", "Russian 19th-Century Novels", "Weimar-Era Cinema".
Never return "Other" as broadCategory; use "General Knowledge" only when no precise top-level bucket applies.
Respond in JSON only: { "suggested": "...", "broadCategory": "...", "explanation": "..." }`;

  const response = await loggedMessagesCreate(client, 'interests-canonicalize', {
    model: CANONICALIZE_MODEL,
    max_tokens: 260,
    temperature: 0.2,
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: cleanInput }],
  });

  const text = extractTextContent(response.content);
  const parsed = parseJsonObject(text);
  const suggested = asTrimmedString(parsed?.suggested);
  const broadCategory = asTrimmedString(parsed?.broadCategory ?? parsed?.broad_category);
  const explanation = asTrimmedString(parsed?.explanation);

  if (!suggested || !broadCategory || !explanation) {
    return fallback;
  }

  return {
    suggested: suggested.slice(0, 100),
    broadCategory: (normalizeBroadCategory(broadCategory) ?? 'General Knowledge').slice(0, 80),
    explanation: explanation.slice(0, 180),
  };
}
