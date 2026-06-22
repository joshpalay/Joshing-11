import type { StreamQuestion } from '@/lib/activity-stream';

// Helpers for the From Friends streak page (B-FROMFRIENDS-STREAK-PAGE-01): the
// page header names the friend and the categories their streak spans, mirroring
// the phrasing of the bundle summary line on Home.

// Distinct, order-preserving category labels across a streak's questions.
export function streakCategories(questions: StreamQuestion[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of questions) {
    const c = q.domain?.trim();
    if (c && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

// "Tennis Fundamentals, Early 20th Century American History and 3 others" — the
// same lead-two + "and N others" shape the bundle summary line uses.
export function categoryPhrase(categories: string[]): string {
  if (categories.length === 0) return '';
  if (categories.length === 1) return categories[0]!;
  if (categories.length === 2) return `${categories[0]} and ${categories[1]}`;
  const rest = categories.length - 2;
  return `${categories[0]}, ${categories[1]} and ${rest} other${rest === 1 ? '' : 's'}`;
}

// The streak page title: "{Friend}'s questions about {categories}", falling back
// to "{Friend}'s questions" when no category is known.
export function streakPageTitle(friendName: string, questions: StreamQuestion[]): string {
  const name = friendName.trim() || 'Your friend';
  const possessive = `${name}’s`;
  const phrase = categoryPhrase(streakCategories(questions));
  return phrase ? `${possessive} questions about ${phrase}` : `${possessive} questions`;
}
