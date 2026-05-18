/**
 * PRD §8.1.13 (v11.1) — Session Close Messaging is two layers:
 *   Layer 1: score-based line (always present)
 *   Layer 2: interpretive line (highest-priority match only, may be omitted)
 *
 * The interpretive line appears ~300ms after Layer 1; that delay is enforced
 * by the renderer (SessionCloseMessage), not here.
 *
 * Priority order for Layer 2 (highest first):
 *   1. tier crossing
 *   2. first correct in a new demonstrated domain
 *   3. 5/5 sweep
 *   4. 0/5 wipeout
 *   5. 3+ correct in a row
 *   6. all wrong in a single domain
 * If nothing qualifies, Layer 2 is null.
 */

export type SessionSlotSummary = {
  domain: string | null;
  answer_state: 'correct' | 'incorrect' | null;
  /** Server-side mastery delta for this slot; populated when available. */
  tier_crossed?: boolean;
  new_tier?: string | null;
  /** True iff this answer opened the first demonstrated point in this domain. */
  is_first_in_new_demonstrated_domain?: boolean;
};

export type SessionCloseLines = {
  scoreLine: string;
  interpretiveLine: string | null;
};

function tierDisplay(tier: string | null | undefined): string | null {
  if (!tier) return null;
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

export function buildScoreLine(correctCount: number): string {
  if (correctCount >= 5) return 'Untouched.';
  if (correctCount === 4) return 'Strong.';
  if (correctCount === 3) return 'Solid.';
  if (correctCount === 2) return 'Working ground.';
  return "Tomorrow's another five.";
}

export function buildInterpretiveLine(slots: SessionSlotSummary[]): string | null {
  const answered = slots.filter((s) => s.answer_state === 'correct' || s.answer_state === 'incorrect');
  if (answered.length === 0) return null;

  // 1. Tier crossing
  const tierCrossing = answered.find((s) => s.tier_crossed && s.new_tier && s.domain);
  if (tierCrossing) {
    return `You moved to ${tierDisplay(tierCrossing.new_tier)} in ${tierCrossing.domain}.`;
  }

  // 2. First correct in a new demonstrated domain
  const newDomain = answered.find((s) => s.is_first_in_new_demonstrated_domain && s.domain);
  if (newDomain) {
    return `New ground: ${newDomain.domain} is yours now.`;
  }

  const correctCount = answered.filter((s) => s.answer_state === 'correct').length;
  const wrongCount = answered.length - correctCount;

  // 3. 5/5 sweep
  if (answered.length >= 5 && correctCount === answered.length) {
    return 'Clean sweep.';
  }

  // 4. 0/5 wipeout
  if (answered.length >= 5 && correctCount === 0) {
    return 'Every one of them. Tomorrow.';
  }

  // 5. 3+ correct in a row
  let maxStreak = 0;
  let currentStreak = 0;
  for (const slot of slots) {
    if (slot.answer_state === 'correct') {
      currentStreak += 1;
      if (currentStreak > maxStreak) maxStreak = currentStreak;
    } else if (slot.answer_state === 'incorrect') {
      currentStreak = 0;
    }
  }
  if (maxStreak >= 3) {
    return `${maxStreak === 3 ? 'Three' : maxStreak === 4 ? 'Four' : 'Five'} in a row at one point.`;
  }

  // 6. All wrong in a single domain (a domain with 2+ slots, all incorrect)
  if (wrongCount > 0) {
    const byDomain = new Map<string, { correct: number; incorrect: number }>();
    for (const slot of answered) {
      if (!slot.domain) continue;
      const counts = byDomain.get(slot.domain) ?? { correct: 0, incorrect: 0 };
      if (slot.answer_state === 'correct') counts.correct += 1;
      else counts.incorrect += 1;
      byDomain.set(slot.domain, counts);
    }
    for (const [domain, counts] of byDomain.entries()) {
      if (counts.incorrect >= 2 && counts.correct === 0) {
        return `${domain} is worth a deeper look.`;
      }
    }
  }

  return null;
}

export function buildSessionCloseLines(slots: SessionSlotSummary[]): SessionCloseLines {
  const correctCount = slots.filter((s) => s.answer_state === 'correct').length;
  return {
    scoreLine: buildScoreLine(correctCount),
    interpretiveLine: buildInterpretiveLine(slots),
  };
}
