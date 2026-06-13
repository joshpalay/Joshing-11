// Smart, deterministic title-casing for knowledge domain labels (declared
// interests and PlayerMastery canonical subcategories). Users — and pre-seeders —
// type these in every casing under the sun ("russian literature", "RUSSIAN
// LITERATURE", "90's HIP HOP", "lord of the rings"), and the old display path
// just up-cased every word boundary, which produced "90S Hip Hop" and could not
// fix minor words. This module standardizes them.
//
// It is intentionally rule-based (no LLM): zero latency/cost and fully
// predictable. It cannot infer brand casing it has never seen ("iPhone") unless
// the term is in CANONICAL_TERMS, but it nails the common cases the team
// actually complained about.
//
// Casing does NOT affect territory matching — domainKey() lowercases everything
// before comparison — so restyling a label never fragments a user's mastery.
import { foldDomainPunctuation } from './domain-key';

// Minor words kept lowercase in title case, unless they are the first or last
// word of the label (a standard AP/Chicago-style short list).
const SMALL_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'but',
  'by',
  'for',
  'from',
  'in',
  'into',
  'nor',
  'of',
  'off',
  'on',
  'onto',
  'or',
  'over',
  'per',
  'the',
  'to',
  'vs',
  'via',
  'with',
]);

// Roman numerals we confidently up-case ("World War Ii" -> "World War II",
// "Final Fantasy Vii" -> "Final Fantasy VII"). Single-letter numerals (I, V, X…)
// are deliberately excluded — they collide with real words and initials.
const ROMAN_NUMERALS = new Set([
  'ii',
  'iii',
  'iv',
  'vi',
  'vii',
  'viii',
  'ix',
  'xi',
  'xii',
  'xiii',
  'xiv',
  'xv',
]);

// Canonical casing for common acronyms and stylized terms, applied regardless of
// how the user typed them ("nba" / "NBA" / "Nba" all land on "NBA"). Keep this
// conservative: only entries whose lowercase form is not also a common English
// word, so ordinary prose is never mangled.
const CANONICAL_TERMS = new Map<string, string>([
  // Sports / orgs
  ['nba', 'NBA'],
  ['nfl', 'NFL'],
  ['nhl', 'NHL'],
  ['mlb', 'MLB'],
  ['ncaa', 'NCAA'],
  ['mvp', 'MVP'],
  ['fifa', 'FIFA'],
  ['uefa', 'UEFA'],
  ['nascar', 'NASCAR'],
  ['f1', 'F1'],
  // Geography / institutions
  ['usa', 'USA'],
  ['uk', 'UK'],
  ['eu', 'EU'],
  ['un', 'UN'],
  ['ussr', 'USSR'],
  ['uae', 'UAE'],
  ['nasa', 'NASA'],
  ['fbi', 'FBI'],
  ['cia', 'CIA'],
  ['nato', 'NATO'],
  ['nyc', 'NYC'],
  ['dc', 'DC'],
  // Media / tech
  ['tv', 'TV'],
  ['hbo', 'HBO'],
  ['bbc', 'BBC'],
  ['cnn', 'CNN'],
  ['mtv', 'MTV'],
  ['espn', 'ESPN'],
  ['nyt', 'NYT'],
  ['ai', 'AI'],
  ['diy', 'DIY'],
  ['faq', 'FAQ'],
  ['ceo', 'CEO'],
  ['gdp', 'GDP'],
  ['dna', 'DNA'],
  ['ufo', 'UFO'],
  ['edm', 'EDM'],
  ['rpg', 'RPG'],
  ['fps', 'FPS'],
  ['dlc', 'DLC'],
  // History
  ['wwi', 'WWI'],
  ['wwii', 'WWII'],
  // Stylized brands / genres
  ['youtube', 'YouTube'],
  ['tiktok', 'TikTok'],
  ['github', 'GitHub'],
  ['javascript', 'JavaScript'],
  ['ios', 'iOS'],
  ['macos', 'macOS'],
  ['iphone', 'iPhone'],
  ['ipad', 'iPad'],
  ['k-pop', 'K-Pop'],
  ['j-pop', 'J-Pop'],
  ['hip-hop', 'Hip-Hop'],
  ['sci-fi', 'Sci-Fi'],
  ['lo-fi', 'Lo-Fi'],
  ['r&b', 'R&B'],
]);

// A token whose alphabetic characters are all uppercase, with at least two
// letters ("NBA", "HBO", "WWII"). Used both to preserve a stray acronym the user
// typed and to detect SHOUTING input.
function isAcronymToken(token: string): boolean {
  const letters = token.replace(/[^A-Za-z]/g, '');
  return letters.length >= 2 && letters === letters.toUpperCase();
}

// Title-case a single hyphen-free, space-free chunk: capitalize the first letter
// and lowercase the rest. Chunks that start with a digit ("90s", "1990s") keep
// their trailing letters lowercase rather than producing "90S". Chunks led by
// punctuation ("(Verdi", quotes) still capitalize their first letter — only a
// DIGIT before the first letter suppresses capitalization.
function capitalizeChunk(chunk: string): string {
  const lower = chunk.toLowerCase();
  const firstLetter = lower.search(/[a-z]/);
  if (firstLetter < 0) return lower; // no letters at all (pure digits/symbols)
  // A digit anywhere before the first letter means a decade-/number-led chunk
  // ("90s", "1990s") — keep it lowercase. Leading punctuation does not.
  if (/\d/.test(lower.slice(0, firstLetter))) return lower;
  return lower.slice(0, firstLetter) + lower[firstLetter].toUpperCase() + lower.slice(firstLetter + 1);
}

type Position = 'first' | 'last' | 'mid';

function normalizeToken(token: string, position: Position, shouting: boolean): string {
  const lower = token.toLowerCase();

  // 1) Curated canonical terms always win ("nba" -> "NBA", "k-pop" -> "K-Pop").
  const canonical = CANONICAL_TERMS.get(lower);
  if (canonical) return canonical;

  // 2) Roman numerals up-case.
  if (ROMAN_NUMERALS.has(lower)) return lower.toUpperCase();

  // 3) Preserve a stray all-caps acronym the user typed ("NBA", "HBO"), but only
  //    when the label is not SHOUTING — otherwise "RUSSIAN LITERATURE" would be
  //    left untouched.
  if (!shouting && isAcronymToken(token)) return token;

  // 4) Minor words stay lowercase unless they anchor the title.
  if (position === 'mid' && SMALL_WORDS.has(lower)) return lower;

  // 5) Default: title-case each hyphen-separated part ("hip-hop" -> "Hip-Hop").
  return lower.split('-').map(capitalizeChunk).join('-');
}

// Standardize the capitalization of a knowledge domain label.
//   "russian literature"  -> "Russian Literature"
//   "RUSSIAN LITERATURE"  -> "Russian Literature"
//   "lord of the rings"   -> "Lord of the Rings"
//   "90's hip hop"        -> "90's Hip Hop"
//   "world war ii"        -> "World War II"
//   "nba history"         -> "NBA History"
export function titleCaseDomain(value: string): string {
  // Fold curly apostrophes, turn underscores into spaces (slug artifacts), and
  // collapse whitespace. Hyphens are preserved and handled per-part below.
  const cleaned = foldDomainPunctuation(value).replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';

  const tokens = cleaned.split(' ');

  // SHOUTING detection. If the label has no lowercase letters at all it was
  // almost certainly typed in caps, so its words should NOT be preserved as
  // acronyms. We also treat "two or more multi-letter all-caps words" as
  // shouting, which rescues "90's HIP HOP" while still preserving a lone "NBA"
  // in "NBA history". Curated terms and roman numerals are excluded from the
  // count since they are handled explicitly.
  const hasLower = /[a-z]/.test(cleaned);
  const acronymish = tokens.filter(
    (t) =>
      isAcronymToken(t) &&
      !ROMAN_NUMERALS.has(t.toLowerCase()) &&
      !CANONICAL_TERMS.has(t.toLowerCase()),
  ).length;
  const shouting = !hasLower || acronymish >= 2;

  return tokens
    .map((token, i) => {
      const position: Position = i === 0 ? 'first' : i === tokens.length - 1 ? 'last' : 'mid';
      return normalizeToken(token, position, shouting);
    })
    .join(' ');
}
