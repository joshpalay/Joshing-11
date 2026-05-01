export type CeremonyMode = 'solo' | 'duo' | 'group';

export function ceremonyModeFromAnsweringCount(activeAnsweringPlayers: number): CeremonyMode {
  if (activeAnsweringPlayers <= 1) return 'solo';
  if (activeAnsweringPlayers === 2) return 'duo';
  return 'group';
}
