const BROAD_CATEGORY_ALIASES: Record<string, string> = {
  'film & tv': 'Film & Television',
  'film and tv': 'Film & Television',
  'film and television': 'Film & Television',
  'television': 'Film & Television',
  'tv': 'Film & Television',
  'classical music': 'Music',
  'world history': 'History',
  'pop culture & television': 'Film & Television',
  'pop culture and television': 'Film & Television',
  'other': 'General Knowledge',
  'general': 'General Knowledge',
  'potpourri': 'General Knowledge',
  'mythology': 'Religion & Mythology',
  'religion': 'Religion & Mythology',
  'religion and mythology': 'Religion & Mythology',
};

// The top-level portrait buckets. "General Knowledge" is the catch-all and is
// intentionally last.
export const STABLE_BROAD_CATEGORIES = [
  'Literature',
  'Music',
  'Film & Television',
  'Architecture & Design',
  'Food & Cuisine',
  'Technology',
  'Sports',
  'History',
  'Geography',
  'Religion & Mythology',
  'Science',
  'Philosophy',
  'Pop Culture',
  'Language',
  'General Knowledge',
] as const;

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

// Fold to a stable comparison form: lowercase, unify "&"/"and", and collapse
// separators so "Architecture & Design", "architecture and design", and
// "architecture_design" all match the same bucket.
function foldForBucketMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s*&\s*/g, ' and ')
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const BROAD_CATEGORY_LABELS_FOLDED = new Set<string>(
  [...STABLE_BROAD_CATEGORIES, ...Object.keys(BROAD_CATEGORY_ALIASES)].map(foldForBucketMatch),
);

/**
 * True when `value` is itself a top-level broad-category bucket or a direct alias
 * of one (e.g. "Technology", "film & tv", "world history"). Unlike
 * normalizeBroadCategory, this does NOT apply the territory→Literature pattern
 * folding, so a specific label such as "James Joyce" returns false. Used by the
 * declared-interest specificity guard to reject bucket-level topics.
 */
export function isBroadCategoryLabel(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false;
  const folded = foldForBucketMatch(value);
  return folded.length > 0 && BROAD_CATEGORY_LABELS_FOLDED.has(folded);
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

  // A territory-sized label that ends in a bucket name ("American Auto History",
  // "European Military History") belongs in that bucket rather than becoming a
  // top-level section of its own (QA 2026-09-27, S3).
  const lower = cleaned.toLowerCase();
  const trailingBucket = [...STABLE_BROAD_CATEGORIES].find((category) => {
    const bucket = category.toLowerCase();
    return lower !== bucket && lower.endsWith(` ${bucket}`);
  });
  if (trailingBucket) return trailingBucket;

  return cleaned;
}

// Topic names that say which bucket they belong in. The categorizer model has
// filed "Australian Geography" under History and "Greek Mythology" under History
// (QA 2026-09-27, S3); when the player's own label names the field, trust it.
const DOMAIN_BUCKET_PATTERNS: Array<[RegExp, string]> = [
  [/\bgeograph(?:y|ical)\b/i, 'Geography'],
  [/\bmytholog(?:y|ies|ical)\b/i, 'Religion & Mythology'],
];

/**
 * The broad category to store for a declared topic: the topic's own name wins
 * when it names a bucket outright, otherwise the proposed (usually LLM) category
 * is normalized as usual.
 */
export function broadCategoryForDomain(
  domain: string | null | undefined,
  proposed: string | null | undefined,
): string | null {
  if (typeof domain === 'string') {
    for (const [pattern, bucket] of DOMAIN_BUCKET_PATTERNS) {
      if (pattern.test(domain)) return bucket;
    }
  }
  return normalizeBroadCategory(proposed);
}
