import 'server-only';

// D-KNOWLEDGE-CIRCLE-GRID-01 P4 / D7 — the "Fully explored" honor: a domain has
// NO unanswered available questions left for the viewer. This is deliberately
// distinct from `mastered` (a points threshold), `domain_exhausted` (a
// generation-side author-invitation reason), and `isSetComplete` (set-level) —
// none of those is a per-viewer availability read, so none may back this badge.
//
// GATED — the signal is not built yet, and this stub returns an empty set so
// NOTHING renders (P1–P3 behavior intact). It is a real, honest gate, not a
// placeholder to forget: a clean signal needs two things this codebase doesn't
// hand us cheaply today —
//   1. A per-viewer "answered / dismissed" question set. Today that history is
//      spread across joshingGameResponses, daily sends, feed sends and
//      milestones (generate-questions assembles `answeredCanonicalTexts` from
//      several sources); there is no single answered-set to diff.
//   2. A per-domain "available authored+verified pool" count. The supply is
//      GENERATIVE — new questions are minted on demand — so a raw count of
//      existing rows is only a floor, and `available === 0` is rarely true and
//      fuzzy in meaning.
//
// When both exist, replace the body with: for each owned canonicalSubcategory,
// available = (verified, viewer-eligible questions in domain) − (viewer already
// answered/dismissed); `available === 0` → add the normalized domain key to the
// set. Rotation must NOT change when a domain is fully explored (D7): this is a
// read only. The UI already renders the honor from this set the moment it's
// non-empty, so shipping the signal later is a one-file change here.
export async function getFullyExploredDomains(_userId: string): Promise<Set<string>> {
  return new Set<string>();
}
