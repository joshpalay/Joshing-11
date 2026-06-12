/**
 * First-Game Recap (B-FirstGameRecap-1) — pure beat computation.
 *
 * A one-time cinematic helper that fires after a user completes their first
 * Joshing game. This intentionally uses a separate seen-signal from the Daily
 * Five first-session recap so the two onboarding moments do not suppress each
 * other.
 */

export type FirstGameRecapQuestion = {
  /** Human-readable domain label for this question (e.g. "Film Tv"). */
  domainDisplayName: string;
  isCorrect: boolean;
  isSkipped: boolean;
};

export type FirstGameRecapBeat2 = {
  /** Distinct domains the game touched, in first-seen order. */
  touchedDomains: string[];
  /** One domain answered correctly ("off the ground"); null when none correct. */
  offTheGroundDomain: string | null;
  /** One wrong domain framed as discovery; null when all correct. */
  newTerritoryDomain: string | null;
};

export type FirstGameRecapView = {
  type: 'first_game';
  /** First name for Beat 1; '' when the user has no display name. */
  firstName: string;
  /** The game whose summary the final CTA returns to. */
  gameTitle: string;
  /** Null only in the defensive empty-game case; Beat 1 still renders. */
  beat2: FirstGameRecapBeat2 | null;
};

export type FirstGameRecapInput = {
  displayName: string | null;
  gameTitle: string;
  questions: FirstGameRecapQuestion[];
};

/** Eligible only when this game is complete, first, and never seen. */
export function isFirstGameRecapEligible(input: {
  seenAt: Date | null;
  isCurrentGameComplete: boolean;
  isFirstCompletedGame: boolean;
}): boolean {
  return (
    input.seenAt == null &&
    input.isCurrentGameComplete === true &&
    input.isFirstCompletedGame === true
  );
}

/** First token of the display name; '' when there is no usable name. */
export function pickFirstName(displayName: string | null): string {
  const trimmed = displayName?.trim().replace(/\s+/g, ' ') ?? '';
  if (!trimmed) return '';
  return trimmed.split(' ')[0] ?? '';
}

function computeBeat2(questions: FirstGameRecapQuestion[]): FirstGameRecapBeat2 | null {
  const touchedDomains: string[] = [];
  const seen = new Set<string>();
  for (const question of questions) {
    const domain = question.domainDisplayName?.trim();
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    touchedDomains.push(domain);
  }
  if (touchedDomains.length === 0) return null;

  const correctCounts = new Map<string, number>();
  const wrongDomains: string[] = [];
  for (const question of questions) {
    const domain = question.domainDisplayName?.trim();
    if (!domain || question.isSkipped) continue;
    if (question.isCorrect) {
      correctCounts.set(domain, (correctCounts.get(domain) ?? 0) + 1);
    } else {
      wrongDomains.push(domain);
    }
  }

  let offTheGroundDomain: string | null = null;
  let bestCount = 0;
  for (const domain of touchedDomains) {
    const count = correctCounts.get(domain) ?? 0;
    if (count > bestCount) {
      bestCount = count;
      offTheGroundDomain = domain;
    }
  }

  const newTerritoryDomain = wrongDomains.find((domain) => domain !== offTheGroundDomain) ?? null;

  return { touchedDomains, offTheGroundDomain, newTerritoryDomain };
}

export function computeFirstGameRecapBeats(input: FirstGameRecapInput): FirstGameRecapView {
  return {
    type: 'first_game',
    firstName: pickFirstName(input.displayName),
    gameTitle: input.gameTitle,
    beat2: computeBeat2(input.questions),
  };
}
