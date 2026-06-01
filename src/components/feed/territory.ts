// Shared parsing for the "new territory" signal carried on an answer
// response's masteryDelta. A correct answer in an unfamiliar domain opens it
// in the player's Knowledge base by default (B-1); writeMasteryEvent reports
// that via `openedNewTerritory` + `domain`. Both the Feed reveal
// (AnswerFeedbackSheet) and the Daily reveal (GameplayChat) read it through
// these guards, so the runtime shape stays in one place.

export function pickOpenedNewTerritory(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  return r.openedNewTerritory === true;
}

export function pickOpenedTerritoryDomain(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.openedNewTerritory !== true) return null;
  return typeof r.domain === 'string' && r.domain.trim() ? r.domain : null;
}
