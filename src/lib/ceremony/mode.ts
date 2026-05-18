export type CeremonyMode = 'solo' | 'duo' | 'group';

// activeAnsweringPlayers is the count of distinct players (including the user
// themselves) who answered at least one question in the cycle. Mapping in raw
// friend terms: 0 active friends → solo, 1 → duo, 2+ → group. The thresholds
// are already at their minimum sensible values; at weekly cadence the friend
// fallback inside Beat1/Beat5 (not the mode classifier) is what compensates
// for sparser cycles. See compute-beats.ts.
export function ceremonyModeFromAnsweringCount(activeAnsweringPlayers: number): CeremonyMode {
  if (activeAnsweringPlayers <= 1) return 'solo';
  if (activeAnsweringPlayers === 2) return 'duo';
  return 'group';
}
