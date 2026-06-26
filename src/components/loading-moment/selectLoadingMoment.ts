/**
 * The Loading Moment selector — pure, synchronous, cached-only.
 *
 * Spec: D-LOADING-MOMENT-SURFACE-01 (card taxonomy, fallback ladder, C-1…C-7).
 *
 * Given a cached `LoadingMomentPayload` and the kind shown last load, resolve
 * exactly one Loading Moment (or `null` for the plain loading state). No I/O,
 * no `await`, no `Date`-dependent branch other than the explicit `now` arg —
 * so it never adds latency to the loading path (C-3) and is fully unit-testable.
 */

import {
  LOADING_MOMENT_MAX_AGE_MS,
  SPARSE_LOADING_MOMENT_LABEL,
  SPARSE_LOADING_MOMENT_LINE,
  type LoadingMomentCardKind,
  type LoadingMomentKind,
  type LoadingMomentPayload,
  type ResolvedLoadingMoment,
} from "./types";

const LABEL = {
  YOUR_KNOWLEDGE: "YOUR KNOWLEDGE",
  A_DISCOVERY: "A DISCOVERY",
  FROM_YOUR_FRIENDS: "FROM YOUR FRIENDS",
} as const;

/** A fact is "present" only if it is a non-empty, non-whitespace string (C-2). */
function present(value: string | undefined | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Per-card builders. Each returns a resolved card ONLY if its underlying fact is
 * real and complete (truth gate C-2); otherwise `null` (not eligible). Order
 * here is irrelevant — the ladder below decides precedence.
 */
const BUILDERS: Record<
  LoadingMomentCardKind,
  (payload: LoadingMomentPayload) => ResolvedLoadingMoment | null
> = {
  "deepest-territory": (p) =>
    present(p.deepestTerritory?.subcategory)
      ? {
          kind: "deepest-territory",
          label: LABEL.YOUR_KNOWLEDGE,
          artifact: `Your deepest territory right now — ${p.deepestTerritory!.subcategory.trim()}.`,
        }
      : null,

  // Deferred this build: payload.rareKnowledge is never populated, so this
  // builder never fires. Kept for taxonomy completeness and its ladder slot.
  "rare-knowledge": (p) =>
    present(p.rareKnowledge?.subcategory)
      ? {
          kind: "rare-knowledge",
          label: LABEL.YOUR_KNOWLEDGE,
          artifact: `You're one of the few here who knows ${p.rareKnowledge!.subcategory.trim()}.`,
        }
      : null,

  // Discovery framing only — never "you got this wrong" (D-doc Card 3).
  turnaround: (p) =>
    present(p.turnaround?.subcategory)
      ? {
          kind: "turnaround",
          label: LABEL.A_DISCOVERY,
          artifact: `Something you once got wrong, you now know cold — ${p.turnaround!.subcategory.trim()}.`,
        }
      : null,

  "deepest-cut": (p) =>
    present(p.deepestCut?.questionStem)
      ? {
          kind: "deepest-cut",
          label: LABEL.A_DISCOVERY,
          artifact: `The deepest cut you've answered — ${p.deepestCut!.questionStem.trim()}`,
        }
      : null,

  // Honest provenance: both the real friend name and the real category must be
  // present, or the card does not render (no attribution to a person otherwise).
  overlap: (p) =>
    present(p.overlap?.friendName) && present(p.overlap?.subcategory)
      ? {
          kind: "overlap",
          label: LABEL.FROM_YOUR_FRIENDS,
          artifact: `${p.overlap!.friendName.trim()} gets ${p.overlap!.subcategory.trim()} the way you do.`,
        }
      : null,

  "waiting-discovery": (p) =>
    present(p.waitingDiscovery?.friendName) && present(p.waitingDiscovery?.subcategory)
      ? {
          kind: "waiting-discovery",
          label: LABEL.FROM_YOUR_FRIENDS,
          artifact: `${p.waitingDiscovery!.friendName.trim()} just added a question about ${p.waitingDiscovery!.subcategory.trim()} — only you'd get it.`,
        }
      : null,
};

/**
 * The fallback ladder (D-doc "selection order"), highest precedence first:
 *  1. turnaround (north-star discovery moment)
 *  2. rare-knowledge OR deepest-territory, whichever has data
 *  3. waiting-discovery THEN overlap — overlap weighted below the discovery
 *     cards (resolved Q3) so a high-traffic surface doesn't over-promote alignment
 *  4. deepest-cut (lowest; surfaces only when richer cards have no data)
 * Below this: the sparse default, then the plain state (hard floor).
 */
const LADDER: LoadingMomentCardKind[] = [
  "turnaround",
  "rare-knowledge",
  "deepest-territory",
  "waiting-discovery",
  "overlap",
  "deepest-cut",
];

const SPARSE_MOMENT: ResolvedLoadingMoment = {
  kind: "sparse",
  label: SPARSE_LOADING_MOMENT_LABEL,
  artifact: SPARSE_LOADING_MOMENT_LINE,
};

export type SelectLoadingMomentOptions = {
  /** The kind shown on the previous load (client-session memory, C-5). */
  lastShownKind?: LoadingMomentKind | null;
  /** Current time (epoch ms). Defaults to `Date.now()`; injected in tests. */
  now?: number;
};

/**
 * Resolve the Loading Moment for this load.
 *
 * Returns:
 *  - a data-backed card when one is eligible (anti-repeat applied, C-5);
 *  - the locked sparse line when the payload is present + fresh but no card is
 *    eligible (genuine low-history / cold-start player, C-6);
 *  - `null` (→ plain loading state) when the payload is absent or stale — a
 *    cached-miss never blocks the screen and never fabricates a fact (C-2/C-3).
 */
export function selectLoadingMoment(
  payload: LoadingMomentPayload | null | undefined,
  options: SelectLoadingMomentOptions = {},
): ResolvedLoadingMoment | null {
  const now = options.now ?? Date.now();

  // Hard floor / cached-miss: nothing cached in budget → plain state, no card.
  if (!payload) return null;

  // Stale payload → treat as cached-miss rather than risk a cold fact (C-2).
  if (
    typeof payload.generatedAt !== "number" ||
    !Number.isFinite(payload.generatedAt) ||
    now - payload.generatedAt > LOADING_MOMENT_MAX_AGE_MS ||
    now - payload.generatedAt < 0
  ) {
    return null;
  }

  // Eligible cards, in ladder order. Truth gate already applied per builder.
  const eligible = LADDER.map((kind) => BUILDERS[kind](payload)).filter(
    (card): card is ResolvedLoadingMoment => card !== null,
  );

  // No data-backed card but a fresh payload → quiet cold-start default (C-6).
  if (eligible.length === 0) return SPARSE_MOMENT;

  // Anti-repeat (C-5): avoid showing the same kind two loads running WHERE an
  // alternative exists. If only the repeat is eligible, show it anyway.
  const nonRepeat = eligible.find((card) => card.kind !== options.lastShownKind);
  return nonRepeat ?? eligible[0];
}
