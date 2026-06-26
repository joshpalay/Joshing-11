/**
 * The Loading Moment — typed card taxonomy and payload shape.
 *
 * Spec: D-LOADING-MOMENT-SURFACE-01. Build: B-LOADING-MOMENT-01.
 *
 * One Loading Moment shows exactly one card, chosen by the fallback ladder in
 * `selectLoadingMoment`. Every value the selector reads comes from a
 * pre-computed, client-readable `LoadingMomentPayload` assembled OFF the
 * critical path (C-1: no fetch on the loading path). The selector is pure and
 * synchronous; if the payload is absent or stale it resolves to the plain
 * loading state (C-3), never holding the screen to populate a card.
 */

/** The six D-doc card types. One entry per card in the taxonomy. */
export type LoadingMomentCardKind =
  | "deepest-territory" // Card 1
  | "rare-knowledge" // Card 2 — DEFERRED this build (no rarity signal exists; see Phase 1 report)
  | "turnaround" // Card 3 — a wrong answer turned around
  | "deepest-cut" // Card 4
  | "overlap" // Card 5
  | "waiting-discovery"; // Card 6

/**
 * A resolution outcome. The data-backed cards plus the sparse / cold-start
 * default. The plain loading state (no card) is represented by the selector
 * returning `null`, not by a kind here.
 */
export type LoadingMomentKind = LoadingMomentCardKind | "sparse";

/**
 * Pre-computed, cached-only inputs for the selector. Each optional field is the
 * already-verified fact for one card; a field is present ONLY when its
 * underlying fact is real (C-2 truth gate). The selector additionally treats an
 * empty/whitespace string as "absent" so a half-built payload can never emit a
 * card with a blank slot.
 *
 * `generatedAt` (epoch ms) stamps when this payload was assembled off the
 * critical path. The selector rejects a payload older than
 * `LOADING_MOMENT_MAX_AGE_MS` as stale (→ plain state), so a card never renders
 * a fact that has gone cold.
 *
 * `rareKnowledge` is intentionally never populated in this build — there is no
 * rarity/tribe-size signal in the model yet (Phase 1 report). The field and its
 * ladder slot exist so a later build can light it up without reshaping anything.
 */
export type LoadingMomentPayload = {
  generatedAt: number;
  deepestTerritory?: { subcategory: string };
  rareKnowledge?: { subcategory: string };
  turnaround?: { subcategory: string };
  deepestCut?: { questionStem: string };
  overlap?: { friendName: string; subcategory: string };
  waitingDiscovery?: { friendName: string; subcategory: string };
};

/**
 * A fully resolved Loading Moment, ready to render in the existing copy slot.
 * `label` is System voice (Josefin Sans, small-caps); `artifact` is Editorial
 * voice (Cormorant Garamond). The label is always present so meaning never
 * rests on color alone (C-4).
 */
export type ResolvedLoadingMoment = {
  kind: LoadingMomentKind;
  /** System-voice label, e.g. "YOUR KNOWLEDGE". Always present (color-independence). */
  label: string;
  /** Editorial-voice artifact line. */
  artifact: string;
};

/**
 * The locked sparse / cold-start line. Single fixed string — never rotated,
 * paraphrased, or A/B'd in this build (B-LOADING-MOMENT-01). Shown only when no
 * data-backed card is eligible AND the payload is present and fresh (a genuine
 * low-history player), never on a cached-miss.
 */
export const SPARSE_LOADING_MOMENT_LINE =
  "Your knowledge map starts filling in as you play.";

export const SPARSE_LOADING_MOMENT_LABEL = "YOUR KNOWLEDGE MAP";

/**
 * Freshness window for a cached payload. Older than this and the selector
 * treats it as a cached-miss (plain state) rather than risk a stale fact.
 */
export const LOADING_MOMENT_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Competition-register / superlative words banned from this surface
 * (D-doc C-4). Exposed for the banned-word scan test.
 */
export const LOADING_MOMENT_BANNED_WORDS = [
  "rank",
  "score",
  "streak",
  "best",
  "top",
  "#1",
  "fastest",
  "leaderboard",
] as const;
