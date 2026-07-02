// Lexical similarity between two domain labels, mirroring pg_trgm's
// word-trigram Jaccard (shared / union) so thresholds tuned for
// KNOWLEDGE_CONVERGE_TRGM_THRESHOLD carry over. Pure and DB-free: the crafter
// worklist clusters ~250 corpus labels in memory, where a pg_trgm round-trip
// per pair would be silly and the extension may be absent anyway.
//
// This intentionally catches only LEXICAL siblings — word-order and connector
// variants like "Medieval & Renaissance Polyphony" / "Renaissance & Medieval
// Polyphony" (similarity 1.0: same word set, same trigrams). Semantic siblings
// with disjoint vocabulary ("Renaissance Florence" / "Italian Renaissance
// Painting" ≈ 0.29) stay apart — folding those needs the near-ness tree and
// waits on D-SUPPLY-FINITE-SET-01.
import { domainKey } from '@/lib/knowledge/domain-key';

function trigramsOf(value: string): Set<string> {
  const grams = new Set<string>();
  const words = domainKey(value)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  for (const word of words) {
    // pg_trgm pads each word with two leading and one trailing space.
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i += 1) {
      grams.add(padded.slice(i, i + 3));
    }
  }
  return grams;
}

/** Trigram Jaccard similarity in [0, 1]. Empty/degenerate labels score 0. */
export function labelSimilarity(a: string, b: string): number {
  const gramsA = trigramsOf(a);
  const gramsB = trigramsOf(b);
  if (gramsA.size === 0 || gramsB.size === 0) return 0;
  let shared = 0;
  for (const gram of gramsA) if (gramsB.has(gram)) shared += 1;
  return shared / (gramsA.size + gramsB.size - shared);
}
