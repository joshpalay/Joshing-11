import {
  ANTHROPIC_MODEL,
  extractTextContent,
  getAnthropicClient,
  parseJsonObject,
} from '@/lib/llm';

export type ProposedInterest = {
  label: string;
  description: string;
  broadCategory: string;
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

function fallbackInterests(warmupAnswers: string[]): ProposedInterest[] {
  const candidates = warmupAnswers
    .map((answer) => answer.replace(/[^\p{L}\p{N}\s'&-]/gu, ' ').replace(/\s+/g, ' ').trim())
    .filter((answer) => answer.length >= 3)
    .flatMap((answer, index) => {
      const short = titleCase(answer.split(/\s+/).slice(0, 5).join(' '));
      if (!short) return [];
      return [{
        label: short,
        description: `A focused area drawn from your warm-up answer about ${short}.`,
        broadCategory: FALLBACK_CATEGORIES[index % FALLBACK_CATEGORIES.length] ?? 'Other',
      }];
    });

  const defaults: ProposedInterest[] = [
    {
      label: 'Modern Literary Fiction',
      description: 'Contemporary novels, recurring authors, and the shelves people return to.',
      broadCategory: 'Literature',
    },
    {
      label: 'Auteur Film Favorites',
      description: 'Specific directors, eras, and movies that reward close watching.',
      broadCategory: 'Film & Television',
    },
    {
      label: 'Personal Canon Music',
      description: 'Artists, albums, and styles that have become part of your inner soundtrack.',
      broadCategory: 'Music',
    },
    {
      label: 'Recent Cultural Obsessions',
      description: 'The shows, references, and odd corners you keep wanting to discuss.',
      broadCategory: 'Pop Culture',
    },
  ];

  return [...candidates, ...defaults].slice(0, 8);
}

function normalizeInterest(value: unknown): ProposedInterest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const label = asTrimmedString(record.label);
  const description = asTrimmedString(record.description);
  const broadCategory = asTrimmedString(record.broadCategory ?? record.broad_category);

  if (!label || !description || !broadCategory) return null;

  return {
    label: label.slice(0, 80),
    description: description.slice(0, 180),
    broadCategory: broadCategory.slice(0, 80),
  };
}

function uniqueByLabel(interests: ProposedInterest[]): ProposedInterest[] {
  const seen = new Set<string>();
  const unique: ProposedInterest[] = [];

  for (const interest of interests) {
    const key = interest.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(interest);
  }

  return unique;
}

export async function proposeInterests(warmupAnswers: string[]): Promise<ProposedInterest[]> {
  const cleanAnswers = warmupAnswers
    .map((answer) => answer.trim())
    .filter((answer) => answer.length > 0)
    .slice(0, 6);

  if (cleanAnswers.length === 0) {
    return fallbackInterests([]);
  }

  const systemPrompt = `You propose declared interests for Joshing, a daily personal trivia game.
Return JSON only:
{
  "interests": [
    { "label": "...", "description": "...", "broadCategory": "..." }
  ]
}

Rules:
- Generate 8 to 12 candidate interests.
- Every label must be hyper-specific and portrait-friendly, not broad.
- Prefer person/era/movement/work/scene labels over generic fields.
- Good: "Late-Period Bowie", "19th-Century English Novels", "Weimar Cinema".
- Bad: "Music", "Books", "Movies", "History", "General Trivia".
- Keep labels under 7 words.
- Descriptions are one sentence, warm and concrete.
- broadCategory is stable and broad, such as Literature, Music, Film & Television, History, Science, Philosophy, Sports, Pop Culture, Language, Other.
- Do not invent private facts. Infer only plausible interest territories from the answers.`;

  const userMessage = `Warm-up answers:
${cleanAnswers.map((answer, index) => `${index + 1}. ${answer}`).join('\n')}

Propose candidate interests.`;

  try {
    const client = getAnthropicClient();
    if (!client) return fallbackInterests(cleanAnswers);

    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 1100,
      temperature: 0.7,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = extractTextContent(response.content);
    const parsed = parseJsonObject(text);
    const rawInterests = Array.isArray(parsed?.interests) ? parsed.interests : [];
    const interests = uniqueByLabel(rawInterests.flatMap((interest) => {
      const normalized = normalizeInterest(interest);
      return normalized ? [normalized] : [];
    }));

    if (interests.length < 8) {
      return uniqueByLabel([...interests, ...fallbackInterests(cleanAnswers)]).slice(0, 12);
    }

    return interests.slice(0, 12);
  } catch (error) {
    console.warn('[LLM] proposeInterests fallback', error);
    return fallbackInterests(cleanAnswers);
  }
}
