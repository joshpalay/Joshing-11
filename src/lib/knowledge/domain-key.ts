// Typographic apostrophes/quotes get folded to a plain ASCII apostrophe before
// any domain comparison. iOS auto-correct turns a user-typed "90's" into the
// curly "90’s" (U+2019) when they declare an interest, while the question
// pipeline emits the straight "90's" (U+0027). Without folding, those two
// spellings produce different territory keys, so a declared interest and the
// questions answered against it split into two separate territories and their
// mastery points never merge. See also normalizeDeclaredInterest and
// normalizeCanonicalSubcategory, which apply the same fold at write time.
export function foldDomainPunctuation(value: string): string {
  // U+2018/U+2019 curly single quotes, U+02BC modifier letter apostrophe.
  return value.replace(/[‘’ʼ]/g, "'");
}

// Connector punctuation that fragments a single domain into spelling variants
// without changing WHICH topic it names. We fold these in the comparison key
// (never in the stored display string) so "Star Trek: The Next Generation",
// "Star Trek - The Next Generation", and "Star Trek The Next Generation" all map
// to one territory. Critically this only collapses CONNECTORS between words — it
// never drops a word — so two genuinely different domains ("Alien" vs
// "Alien: Covenant", "Henry IV" vs "Henry IV, Part 2") never collide.
//
// In scope: ASCII colon, en/em dashes (U+2013/U+2014), a space-delimited hyphen
// separator (" - "), and the ampersand connector ("&" ↔ "and"). Deliberately NOT
// in scope: in-word hyphens ("D-Day", "Republic-to-Empire") and periods (the
// "T. S. Eliot" spacing is unified by normalizeCanonicalSubcategory at write
// time instead) — folding those risks false merges or needs word-aware spacing.
function foldDomainConnectors(value: string): string {
  return value
    .replace(/\s*[:–—]\s*/g, ' ') // colon / en-dash / em-dash → space
    .replace(/\s+-\s+/g, ' ') // spaced-hyphen separator → space
    .replace(/\s*&\s*/g, ' and '); // ampersand connector → "and"
}

// Canonical comparison key for a knowledge domain / canonical subcategory.
// Apostrophe-folded, connector-folded, whitespace-collapsed, and lowercased so
// the same topic always maps to one territory regardless of typographic spelling.
export function domainKey(value: string): string {
  return foldDomainConnectors(foldDomainPunctuation(value))
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}
