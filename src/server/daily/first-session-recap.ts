/**
 * First-Session Recap (B-FirstRecap-1) — pure beat computation.
 *
 * A one-time cinematic recap (`type = 'first_session'`) that fires immediately
 * after the end-of-session summary on the user's FIRST ever completed Daily
 * Five. It is NOT the biweekly ceremony: its own (shorter) three-beat set, no
 * shareable card, and its own beat logic — none of the ceremony's
 * beat-computation code is reused here.
 *
 * CORE PRINCIPLE — grading fails toward the player. After five questions there
 * is not enough signal to characterize a domain as weakness. Beat 2 uses
 * DISCOVERY framing only for wrong answers ("new territory"), never judgment.
 * There is deliberately no "resistance"/"struggled"/"missed"/"weak" path.
 *
 * The pure decision functions (eligibility + beat shaping) live here, split from
 * the DB I/O in get-first-session-recap.ts, so first-session detection and the
 * Beat 3 branch selection are unit-testable without a database — mirroring the
 * pick/dedupe/build split in backfill-inviter-feed.ts.
 */

export type FirstSessionRecapQuestion = {
  /** Human-readable domain label for this question (e.g. "Film Tv"). */
  domainDisplayName: string;
  isCorrect: boolean;
  isSkipped: boolean;
};

export type FirstSessionRecapBeat2 = {
  /** Distinct domains the five questions touched, in first-seen order. */
  touchedDomains: string[];
  /** One domain answered correctly ("off the ground"); null when none correct. */
  offTheGroundDomain: string | null;
  /** One wrong domain framed as discovery; null when all correct. */
  newTerritoryDomain: string | null;
};

export type FirstSessionRecapBeat3 =
  // Inviter has played in window — their backfilled questions are already on the
  // home feed (present tense).
  | { kind: 'inviter_present'; inviterName: string }
  // Inviter on record but no backfilled items yet (future tense).
  | { kind: 'inviter_future'; inviterName: string }
  // Organic/admin signup with no inviter on record — invite-flow CTA instead.
  | { kind: 'no_inviter' };

export type FirstSessionRecapView = {
  type: 'first_session';
  /** First name for Beat 1; '' when the user has no display name. */
  firstName: string;
  /** Null only in the defensive empty-session case; Beat 1 always renders. */
  beat2: FirstSessionRecapBeat2 | null;
  beat3: FirstSessionRecapBeat3;
};

export type FirstSessionRecapInput = {
  displayName: string | null;
  questions: FirstSessionRecapQuestion[];
  /** Resolved inviter (name already normalized); null when none on record. */
  inviter: { name: string } | null;
  /**
   * Count of the inviter's backfilled `friend_answered` feed items currently
   * present for this user. > 0 ⇒ present tense; 0 ⇒ future tense.
   */
  inviterBackfillItemCount: number;
};

/**
 * First-session detection. Eligible only when the recap has never been shown
 * AND this is the user's first completed Daily Five round. Pure so both
 * branches are testable without a DB.
 */
export function isFirstSessionRecapEligible(input: {
  seenAt: Date | null;
  isFirstCompletedRound: boolean;
}): boolean {
  return input.seenAt == null && input.isFirstCompletedRound === true;
}

/** First token of the display name; '' when there is no usable name. */
export function pickFirstName(displayName: string | null): string {
  const trimmed = displayName?.trim().replace(/\s+/g, ' ') ?? '';
  if (!trimmed) return '';
  return trimmed.split(' ')[0] ?? '';
}

function computeBeat2(
  questions: FirstSessionRecapQuestion[],
): FirstSessionRecapBeat2 | null {
  // "Touched" = distinct domains across the five served questions, first-seen
  // order. A skipped question still touched its domain (it was shown).
  const touchedDomains: string[] = [];
  const seen = new Set<string>();
  for (const question of questions) {
    const domain = question.domainDisplayName?.trim();
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    touchedDomains.push(domain);
  }
  if (touchedDomains.length === 0) return null;

  // "Off the ground" = the domain with the most correct answers; ties broken by
  // first-seen order. Null when nothing was answered correctly.
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

  // One wrong domain, discovery framing only. Prefer a domain other than the
  // off-the-ground one so the two lines never contradict each other. Null when
  // every answer was correct.
  const newTerritoryDomain =
    wrongDomains.find((domain) => domain !== offTheGroundDomain) ?? null;

  return { touchedDomains, offTheGroundDomain, newTerritoryDomain };
}

function computeBeat3(
  inviter: { name: string } | null,
  inviterBackfillItemCount: number,
): FirstSessionRecapBeat3 {
  if (!inviter) return { kind: 'no_inviter' };
  if (inviterBackfillItemCount > 0) {
    return { kind: 'inviter_present', inviterName: inviter.name };
  }
  return { kind: 'inviter_future', inviterName: inviter.name };
}

export function computeFirstSessionRecapBeats(
  input: FirstSessionRecapInput,
): FirstSessionRecapView {
  return {
    type: 'first_session',
    firstName: pickFirstName(input.displayName),
    beat2: computeBeat2(input.questions),
    beat3: computeBeat3(input.inviter, input.inviterBackfillItemCount),
  };
}
