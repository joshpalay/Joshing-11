/**
 * Refine Your Game — shared types + pure helpers.
 *
 * The daily summary surfaces up to three evidence-based "refine" items drawn
 * from the daily just finished. This module holds the type shapes plus the
 * priority / verb / threshold tables that both the derivation rules
 * (src/server/refine/derive.ts) and the selection step
 * (src/server/refine/select.ts) depend on. Everything here is pure.
 */

export type RefineItemType =
  | 'friend_expansion'
  | 'difficulty_escalation'
  | 'struggle_pruning'
  | 'add_territories';

export type RefineActionVerb = 'Add' | 'Ease off' | 'Rest' | 'Add categories';

export type RefineItemState = 'open' | 'resolved';

/** The three difficulty tiers a missed question can carry. */
export type RefineMissTier = 'accessible' | 'moderate' | 'specialist';

/** A firing-rule output, before copy is attached. */
export interface RefineCandidate {
  type: RefineItemType;
  /** canonical_subcategory the item targets. */
  subdomainId: string;
  subdomainLabel: string;
  /** friend_expansion only — the bonus source friend. */
  friendId?: string;
  friendName?: string;
  /** struggle_pruning only — trailing consecutive miss count, used in evidence copy. */
  missCount?: number;
}

/** The shape the client renders (open or resolved). */
export interface RefineItem {
  id: string;
  type: RefineItemType;
  subdomainId: string;
  subdomainLabel: string;
  friendId?: string;
  friendName?: string;
  openText: string;
  resolvedText: string;
  actionVerb: RefineActionVerb;
  state: RefineItemState;
  /**
   * Navigational items (the add_territories nudge) link out instead of staging a
   * decision. When set, the client renders the action verb as a link to this
   * route and skips the resolve/undo round-trip entirely.
   */
  href?: string;
}

export interface RefineSectionView {
  /** Queue the items belong to; the client posts it on resolve/undo. Null when no daily ran. */
  queueId: string | null;
  items: RefineItem[];
}

/**
 * Selection priority — lower fires first. Matches the spec table:
 * friend_expansion (1) → difficulty_escalation (2) → struggle_pruning (3).
 */
export const REFINE_PRIORITY: Record<RefineItemType, number> = {
  friend_expansion: 0,
  difficulty_escalation: 1,
  struggle_pruning: 2,
  // Lowest priority: the inactivity nudge only fills space the evidence-based
  // items leave open, so on an engaged day it steps aside.
  add_territories: 3,
};

export const REFINE_VERB: Record<RefineItemType, RefineActionVerb> = {
  friend_expansion: 'Add',
  difficulty_escalation: 'Ease off',
  struggle_pruning: 'Rest',
  add_territories: 'Add categories',
};

/** Max items shown at once. */
export const REFINE_MAX_ITEMS = 3;

/**
 * Days of "no new territory added" before the add_territories nudge fires. The
 * signal is the most recent active DeclaredInterest.declaredAt — adding a
 * category resets it, so the nudge disappears the moment the player acts.
 */
export const ADD_TERRITORIES_INACTIVITY_DAYS = 5;

/**
 * Whether to surface the "add some categories?" nudge. Fires when the player has
 * never added a territory (`null`) or hasn't in ADD_TERRITORIES_INACTIVITY_DAYS.
 */
export function shouldNudgeAddTerritories(daysSinceLastAdd: number | null): boolean {
  return daysSinceLastAdd === null || daysSinceLastAdd >= ADD_TERRITORIES_INACTIVITY_DAYS;
}

/**
 * Stable identity / cooldown key for a candidate or decision row. Subdomain is
 * lowercased so casing drift between slot data and stored rows can't split a key.
 */
export function refineItemKey(
  type: RefineItemType,
  subdomainId: string,
  friendId?: string | null,
): string {
  return `${type}:${subdomainId.toLowerCase()}:${friendId ?? ''}`;
}

/**
 * Tiered pruning threshold — N consecutive misses needed to fire, keyed by the
 * tier of the LATEST miss in the run (spec edge case: latest, not hardest).
 *
 * Retuned from 3/4/5 → 2/3/4: at the original thresholds a struggle-pruning
 * suggestion almost never fired in normal play (a single correct answer resets
 * the run, and stacking 3+ same-domain misses in a 5-question daily is rare).
 * The gentler 2/3/4 surfaces a "rest this" nudge after a couple of misses
 * without becoming nag-y on the harder tiers.
 */
export function pruningThreshold(latestMissTier: RefineMissTier): number {
  return { accessible: 2, moderate: 3, specialist: 4 }[latestMissTier];
}
