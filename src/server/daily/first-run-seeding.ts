// Pure, dependency-free domain-planning rules for a brand-new user's FIRST
// Daily Five. Kept free of DB/network imports so it can be unit/smoke-tested in
// isolation (see scripts/first-five-seeding.smoke.mjs). The random-mode domain
// selection in ./generate-questions.ts calls planFirstRunDomains when building a
// user's very first queue.
//
// Product rule (PRD prompt 5): infer priority from SELECTION ORDER — no ranking
// step. The first few areas the user picked are "strong signal"; later picks are
// "light signal". The first session should draw mostly from strong-signal areas
// while keeping enough variety that it never feels like one topic on repeat.

// How many of the user's first-picked areas count as "strong signal". Areas
// selected after this are "light signal" and seed the first session more lightly.
export const FIRST_RUN_STRONG_SIGNAL_COUNT = 3;

// How many light-signal areas to weave into the first session for variety. The
// strong-signal areas lead the palette (so generation favors them); a small
// number of light-signal areas follow so the session reads as 3–4 from the
// strong areas + 1–2 from the rest, per the spec's "prefer variety" rule.
export const FIRST_RUN_LIGHT_SIGNAL_VARIETY = 2;

// Build the domain palette that seeds a new user's first Daily Five.
//
// orderedDeclared: the user's declared-interest domains in SELECTION ORDER
//   (first-picked first), already filtered to ones we can actually draw from
//   (in the knowledge base, not excluded, not resting).
// count: the Daily Five size (number of question slots being seeded).
//
// Returns a deduped domain palette (length <= count), ordered so that:
//   - strong-signal areas lead, so most generated questions draw from them,
//   - up to FIRST_RUN_LIGHT_SIGNAL_VARIETY light-signal areas follow for variety,
//   - it never collapses to a single domain when the user selected more than one
//     (the generator distributes `count` questions across the palette, so a
//     multi-domain palette keeps all five from being one area), and
//   - leftover slots are backfilled from the remaining light-signal areas.
//
// Returns [] only when there are no usable areas — the caller then falls back to
// its normal diverse selection, so a sparse knowledge base never errors.
export function planFirstRunDomains(orderedDeclared: string[], count: number): string[] {
  if (count <= 0) return [];

  // Dedupe case-insensitively while preserving selection order and original casing.
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const raw of orderedDeclared) {
    const domain = raw.trim();
    const key = domain.toLowerCase();
    if (!domain || seen.has(key)) continue;
    seen.add(key);
    ordered.push(domain);
  }

  if (ordered.length === 0) return [];
  if (ordered.length === 1) return [ordered[0]];

  const strong = ordered.slice(0, FIRST_RUN_STRONG_SIGNAL_COUNT);
  const light = ordered.slice(FIRST_RUN_STRONG_SIGNAL_COUNT);

  const palette: string[] = [];

  // Strong-signal areas lead the palette (capped by count).
  for (const domain of strong) {
    if (palette.length >= count) break;
    palette.push(domain);
  }

  // Weave in a few light-signal areas for variety.
  const lightVariety = Math.min(
    light.length,
    FIRST_RUN_LIGHT_SIGNAL_VARIETY,
    Math.max(0, count - palette.length),
  );
  for (let i = 0; i < lightVariety; i += 1) {
    palette.push(light[i]);
  }

  // Backfill any remaining slots from the rest of the light-signal areas (only
  // reached when the user selected more areas than count - already-used slots).
  for (let i = lightVariety; i < light.length && palette.length < count; i += 1) {
    palette.push(light[i]);
  }

  return palette;
}
