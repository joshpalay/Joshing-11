/**
 * B-DOMAIN-BONUS-ROTATION-01 — does a demonstrated-mastery domain feed the core
 * Daily Five rotation?
 *
 * A friend-sourced +2 bonus answer records mastery like any other (so stats and
 * the player's "map" count it), but the row is written rotation_eligible=false so
 * the domain can't silently leak into the core five. It rejoins the rotation only
 * once the player has a real claim on it:
 *
 *   - rotationEligible — earned it through core/feed/declared play (or it's a
 *     legacy row, where the column defaults true), OR
 *   - declared        — it's an active declared interest, OR
 *   - adopted         — the player set a non-resting frequency (Often / Sometimes
 *                       / Blue Moon) on the bonus reveal card. Blue Moon counts:
 *                       it rotates, just rarely. Only "Never" (resting) / unset
 *                       leaves a bonus-only domain parked.
 *
 * Pure + db-free so it can be unit-tested without the query layer.
 */
export function masteryDomainFeedsRotation(input: {
  rotationEligible: boolean;
  declared: boolean;
  adopted: boolean;
}): boolean {
  return input.rotationEligible || input.declared || input.adopted;
}
