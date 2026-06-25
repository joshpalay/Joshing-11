/**
 * Pure activity-stream type + constant definitions — NO database or other
 * server-only imports. This module exists so the client-shared, DB-free
 * transform in `src/lib/activity-stream.ts` can read HOME_TOP3_ELIGIBLE_TYPES
 * without dragging `src/server/activity/write-activity.ts` (and its `pg` DB
 * import) into the browser bundle. The server writer re-exports these for
 * existing server-side importers; client code imports straight from here.
 */

export type ActivityItemType =
  | 'received_joshing_game'
  | 'joshing_game_result'
  | 'joshing_game_progress'
  | 'friend_mastery'
  | 'ceremony_ready'
  // Legacy friend-request types — no longer written (the follow model below
  // supersedes them) but retained so historical activity rows still type-check
  // and render against the frozen Friendship table.
  | 'friend_request'
  | 'friend_request_accepted'
  // D-1 Stage 3 follow model. `follow` = someone followed you (public account,
  // auto-approved). `follow_request` = someone requested to follow you
  // (approval_required). `follow_approved` = you approved their request (written
  // to the requester). `follow_mutual` = you accepted their request and the two
  // became mutual friends — written to the ACCEPTER as a "now connected" card
  // (the requester's matching card stays `follow_approved`).
  | 'follow'
  | 'follow_request'
  | 'follow_approved'
  | 'follow_mutual'
  // An invited friend both accepted the inviter's invitation and got far
  // enough into the product to play their first five questions. Surfaced to
  // the inviter as a "your invite stuck" milestone. Written from
  // write-mastery-event.ts once the invitee crosses the fifth play.
  | 'invited_friend_played_first_five'
  | 'received_direct_question'
  | 'reaction_received'
  | 'question_curated'
  | 'friend_answered_your_question'
  | 'authored_question_shared'
  | 'declared_promoted'
  // §8.22 grade-dispute path. RETIRED 2026-06-25 — no longer written. This
  // card ("{friend} asked for a re-look at your question") notified the
  // question's author when an answerer disputed their grade, but it carried no
  // action: the re-grade happens in the human-review queue, not on the author's
  // stream. The write was dropped from feed/recheck + milestone/recheck (daily/
  // recheck never wrote it), and filterUtilityActivities now drops historical
  // rows. Retained in the union so those rows still type-check and hydrate.
  | 'grade_dispute_filed'
  // D-2 niche-match discovery (slow-burn organic discovery between strangers
  // through a shared authored question). Two asymmetric writes from
  // notifyNicheMatch() in src/server/feed/create-feed-items-for-answer.ts,
  // each gated by the *exposed* party's discoverableByNicheMatch flag.
  // Deliberately NOT the same as friend_answered_your_question (which targets
  // prior answerers, is friend-scoped, and carries a got-it/couldn't-get-it
  // framing). Kept OUT of HOME_TOP3_ELIGIBLE_TYPES and the bell badge below —
  // this is a slow-burn delight with no volume cues; it surfaces only in the
  // full /activities list.
  | 'niche_match_answered_your_question' // author-side: a stranger correctly answered a question you authored
  | 'niche_match_you_answered'; // answerer-side: you correctly answered a stranger's authored question

// Events surfaced in Home's top-3 RecentActivity and counted by the bell
// badge. Light type filtering only — chronological within this set. Single
// source of truth for "is this event home-worthy?" — see RecentActivitySection
// and getBellBadgeCount.
export const HOME_TOP3_ELIGIBLE_TYPES = [
  'friend_answered_your_question',
  'friend_mastery',
  'declared_promoted',
  'reaction_received',
  'question_curated',
  'authored_question_shared',
  // A question a friend addressed directly to you is high-signal — surface it in
  // Home's top-3 (and the bell badge), not just the full /activities list, so a
  // sent question isn't easy to miss. Already-answered sends are dropped upstream
  // by filterUtilityActivities, so this never shows a stale "sent you a question".
  'received_direct_question',
] as const satisfies readonly ActivityItemType[];

export type HomeTop3EligibleType = (typeof HOME_TOP3_ELIGIBLE_TYPES)[number];
