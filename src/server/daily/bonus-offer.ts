import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/server/db';
import { users } from '@/server/db/schema';

/**
 * B-BONUS-OFFER-01 — the one-time friend-bonus interstitial.
 *
 * The +2 additive slots append past the core five with no explanation and, until
 * this build, no "continue" affordance at all: the action row offered only
 * "Show me the answer", "Dismiss", and the durable opt-out. New players read the
 * opt-out as the way forward. Measured on prod 2026-08-24 — of the 7 players who
 * ever met a bonus slot on their first session, 3 tapped the opt-out immediately
 * (two of them on BOTH bonus slots), while no established player has ever done
 * it on day one.
 *
 * So the interstitial is a FIRST-RUN EXPLAINER, not a recurring gate: it fires at
 * most once per account and is stamped on either resolution (Josh, 2026-08-25 —
 * "only appear once, I think it would be annoying multiple times"). After it has
 * been seen, bonus slots flow inline exactly as they do today.
 */
export async function markBonusOfferSeen(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ bonusOfferSeenAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.bonusOfferSeenAt)));
}

/**
 * Has this player already been shown the interstitial? Fails CLOSED (true) if the
 * lookup comes back empty: a missing user row should suppress a first-run
 * explainer, never re-nag someone who has already seen it.
 */
export async function hasSeenBonusOffer(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ seenAt: users.bonusOfferSeenAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ? row.seenAt !== null : true;
}
