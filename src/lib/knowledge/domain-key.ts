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

// Canonical comparison key for a knowledge domain / canonical subcategory.
// Apostrophe-folded, whitespace-collapsed, and lowercased so the same topic
// always maps to one territory regardless of typographic spelling.
export function domainKey(value: string): string {
  return foldDomainPunctuation(value).trim().replace(/\s+/g, ' ').toLowerCase();
}
