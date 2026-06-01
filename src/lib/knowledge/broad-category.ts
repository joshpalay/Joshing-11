const BROAD_CATEGORY_ALIASES: Record<string, string> = {
  'film & tv': 'Film & Television',
  'film and tv': 'Film & Television',
  'film and television': 'Film & Television',
  television: 'Film & Television',
  tv: 'Film & Television',
  'classical music': 'Music',
  'world history': 'History',
  'pop culture & television': 'Film & Television',
  'pop culture and television': 'Film & Television',
  other: 'General Knowledge',
  general: 'General Knowledge',
  potpourri: 'General Knowledge',
};

const STABLE_BROAD_CATEGORIES = new Set([
  'Literature',
  'Music',
  'Film & Television',
  'Architecture & Design',
  'Food & Cuisine',
  'Technology',
  'Sports',
  'History',
  'Science',
  'Philosophy',
  'Pop Culture',
  'Language',
  'General Knowledge',
]);

const LITERATURE_BROAD_CATEGORY_PATTERNS = [
  /\bliterat(?:ure|ary)\b/i,
  /\bfiction\b/i,
  /\bnovels?\b/i,
  /\bpoe(?:m|try|ts?)\b/i,
  /\bplaywrights?\b/i,
  /\bmodernis(?:m|t)\b/i,
  /\bjames joyce\b/i,
  /\bjoyce(?:'s|an)?\b/i,
  /\bvirginia woolf\b/i,
  /\bshakespeare\b/i,
];

function cleanBroadCategory(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Broad categories are the top-level portrait buckets. LLMs sometimes return a
 * territory-sized label here (for example, "James Joyce & Irish Modernism").
 * Normalize those labels back to stable buckets so specific territories remain
 * children of broad categories instead of becoming top-level sections.
 */
export function normalizeBroadCategory(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = cleanBroadCategory(value);
  if (!cleaned) return null;

  const exactAlias = BROAD_CATEGORY_ALIASES[cleaned.toLowerCase()];
  if (exactAlias) return exactAlias;

  const stableMatch = [...STABLE_BROAD_CATEGORIES].find(
    (category) => category.toLowerCase() === cleaned.toLowerCase(),
  );
  if (stableMatch) return stableMatch;

  if (LITERATURE_BROAD_CATEGORY_PATTERNS.some((pattern) => pattern.test(cleaned))) {
    return 'Literature';
  }

  return cleaned;
}
