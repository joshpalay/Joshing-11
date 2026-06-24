/**
 * Unified activity stream (D-4 CORRECTION 2).
 *
 * One quiet one-liner model, rendered the SAME way on the homepage
 * "What's Happening" (the curated head) and on Lately / `/activities` (the full
 * list). This module is the single, pure (DB-free) transform from the three
 * upstream sources — activity rows, Lately moments, Lately milestones — into a
 * serializable `StreamItem[]`. The async assembler that runs the queries lives
 * in `src/server/activity/build-stream.ts`; the rendering lives in
 * `src/components/activity/*`.
 *
 * The organising rule (stated once): an item that is BACKED BY A QUESTION
 * expands in place to reveal it, and the expanded action follows from the
 * viewer's relationship to that question:
 *   - someone else's question  -> ANSWER it (milestone: the friend's questions)
 *   - your own question        -> SEND IT ONWARD (you can't answer your own)
 * Non-question items stay plain one-liners (some still carry a trailing utility
 * action — friend-request approve, reaction ack, a link — but they don't expand).
 */

import { HOME_TOP3_ELIGIBLE_TYPES } from '@/lib/activity-types';
import type { ActivityItemView } from '@/server/db/queries/activity';
import type { MasteryTier } from '@/types/db';
import type { LatelyMoment } from '@/server/db/queries/lately';
import { LATELY_TIER, latelyTierForMomentDir, djb2 } from '@/lib/lately';
import type { LatelyMilestone } from '@/lib/lately-milestones';
import type { FriendActivityCard } from '@/lib/friend-activity';
import type { Convergence } from '@/lib/convergence';
import type { RelationshipResult } from '@/server/db/queries/friend-requests';

// --- Serializable model ------------------------------------------------------

// One segment of a one-liner. `actor` renders as a profile link when we have a
// user id; everything else is plain text. Keeping the line as parts (rather than
// a pre-rendered node) is what lets the SAME data cross the server -> client
// boundary and render identically on both surfaces.
export type StreamLinePart =
  | { t: 'text'; v: string }
  | { t: 'actor'; name: string; userId: string | null }
  // A category/topic name embedded in a one-liner. Rendered in the Editorial
  // serif (STYLE-GUIDE-TYPE §5) — title case, a warm register apart from the
  // sans sentence around it (see the `category` branch in ActivityStreamItem).
  | { t: 'category'; v: string };

export type StreamQuestion = {
  questionId: string;
  text: string;
  domain: string | null;
  // The viewer's own prior result on this question, if any. `null` = never
  // attempted. ANY non-null value (correct OR incorrect) locks the question in
  // the milestone expansion — a single attempt is the viewer's only swing in
  // the feed — and drives the ANSWERED history's "Correct" / "Not this time"
  // copy plus the bundle progress mark.
  priorResult: 'correct' | 'incorrect' | null;
  // Honest authorship for the expanded reveal (D-FEED-GROUP3-01 §4). Tri-state,
  // and the distinction is load-bearing for the provenance marker:
  //   - undefined        — provenance not resolved for this source; show nothing
  //                        (the row frame already attributes it, e.g. moments are
  //                        human by construction).
  //   - null             — a non-person LLM-origin question → render the
  //                        LLM_QUESTION_ATTRIBUTION label.
  //   - string (+isHouse) — a human name, or the house identity when authorIsHouse.
  // A house/LLM question must NEVER render as if a person wrote it.
  authorName?: string | null;
  authorIsHouse?: boolean;
  // D-4 via-attribution (From Friends only): the two-hop relay source the
  // ANSWERING friend got this question from — rendered as "via Josh". Distinct
  // from authorName (who WROTE it): an LLM-authored ("Maid Acasa") question that
  // reached the viewer through Josh shows BOTH the author marker and the via
  // line. null/undefined when the friend met it organically or the source can't
  // be surfaced.
  via?: { userId: string; name: string } | null;
};

// The action an expanded, question-backed item offers — determined by the
// viewer's relationship to the question.
export type StreamExpand =
  // Someone else's questions (the friend's literal ≤5) -> ANSWER each.
  | {
      kind: 'milestone';
      friendId: string;
      friendName: string;
      questions: StreamQuestion[];
    }
  // Your own authored question a friend answered -> SEND IT ONWARD.
  | { kind: 'your_question'; question: StreamQuestion }
  // A stranger crossed your question (either direction) -> SEND IT ONWARD, and
  // (still) follow / discover the stranger, side by side.
  | {
      kind: 'niche_match';
      question: StreamQuestion;
      strangerId: string | null;
      strangerName: string;
    }
  // Convergence (B-Convergence-1): you and a friend independently answered the
  // SAME shared questions correctly. Both already answered, so the reveal shows
  // the cluster's questions as clean quotes with a quiet per-quote share glyph
  // (the streamlined reveal, commit 151b5a1) — no answer or reaction affordance.
  | {
      kind: 'same_correct';
      friendId: string;
      friendName: string;
      questions: StreamQuestion[];
    };

// A trailing, non-expanding utility action carried by some plain one-liners.
export type StreamAction =
  | { kind: 'link'; href: string; label: string }
  | { kind: 'friend_request'; friendshipId: string }
  | { kind: 'reaction_got_it'; reactionId: string; replied: boolean }
  // A question a friend addressed directly to you (received_direct_question) ->
  // ANSWER it inline, right here in the stream. The card is backed by a feed
  // item, so the answer posts to /api/feed/{feedItemId}/answer (NOT the
  // milestone endpoint). Everything the inline answer flow needs travels on the
  // action so the row never has to round-trip to the home feed to be answered.
  | {
      kind: 'answer_direct';
      feedItemId: string;
      questionId: string;
      questionText: string;
      domain: string | null;
    };

// The triangle event-indicator family (Figma "From Your Friends" marks). One
// 24px-wide mark per event class, rendered in the activity row's icon column
// (see ActivityIcon). `null` = no mark, but the column is still reserved so
// every row's text starts at the same x.
//   - 'bundle'    → 2–2–1 cluster: a friend's questions for you (milestone).
//                   Solid = unanswered, hollow = already played. Live count
//                   comes from the row's answered-state; caps at 5 silently.
//   - 'star'      → a five-point star built from five palette triangles (one per
//                   question): a friend you invited played their first five. The
//                   five points read as the milestone; distinct from the diamond/
//                   bundle so it doesn't blur into the rest of the triangle family.
//   - 'diamond'   → tan/darkyellow rhombus: someone answered ("got") a question.
//   - 'hourglass' → orange/teal triangles apex-to-apex: someone sends you a Q.
//   - 'domain'    → orange/teal half-triangles split on a diagonal: a new
//                   domain opened (expansion).
export type StreamIconKind =
  | 'bundle'
  | 'star'
  | 'diamond'
  | 'hourglass'
  | 'domain'
  | null;

// An optional rich embed rendered inline beneath a row's one-liner. Almost no
// rows carry one. The common-ground promo (homepage "What's happening" ONLY)
// uses it to surface a few domains the viewer shares with a friend as the
// overlapping-circle motif from the profile page — a quiet discovery nudge.
export type CommonGroundPromoDomain = {
  label: string;
  viewer: { points: number; tier: MasteryTier };
  friend: { points: number; tier: MasteryTier };
};

// One friend in the common-ground promo carousel: the friend, plus their
// strongest shared-but-untested domains (at least one, at most two — see
// MAX_DOMAINS_PER_FRIEND in common-ground-promo.ts). The promo carries a few of
// these so the carousel is a quiet tour of the viewer's circle — a slide per
// friend, with swipes moving between PEOPLE, not between areas.
export type CommonGroundPromoFriend = {
  friendId: string;
  friendFirstName: string;
  friendHref: string;
  // Strongest first; never empty.
  domains: CommonGroundPromoDomain[];
};

export type RecentlyExpandingPromoDomain = {
  // The domain display name, its short supporting line, and the letter shown in
  // the row's colored badge — all precomputed server-side so the embed stays a
  // pure render (mirrors the /knowledge "Recently Expanding" module rows).
  label: string;
  caption: string;
  initial: string;
};

export type AddFriendsPromoPerson = {
  // A contact-match suggestion. avatarColor / handle may be null; relationship
  // drives the AddFriendButton state machine (so the embed stays a pure render).
  id: string;
  displayName: string;
  handle: string | null;
  avatarColor: string | null;
  relationship: RelationshipResult;
};

// Inline embeds rendered under a stream row's one-liner. A discriminated union
// so each promo carries only its own payload; ActivityStreamItem switches on
// `kind`. `common_ground` draws the overlapping-circle motif with a link to a
// friend; `recently_expanding` lists the viewer's fastest-growing territories
// with a link to /knowledge; `add_friends` either suggests people to follow or
// (when there are none) nudges toward inviting someone.
// Promos recur as the same promo TYPE over time, so the hash-by-event-id trick
// the relationship lines use won't vary them. Each embed instead carries a
// `headlineIndex` (D-FEED-GROUP3-01 Pool 4) — a day-seeded number the feature
// component takes `% pool.length` to rotate the HEADLINE only (eyebrow, CTA, and
// supporting copy stay fixed for wayfinding). Optional so older callers/tests
// default to the first headline.
export type StreamEmbed =
  | {
      kind: 'common_ground';
      // The featured (first) friend — drives the row's one-liner and the
      // headline. `friends` carries the full carousel set (featured first).
      friendId: string;
      friendFirstName: string;
      friendHref: string;
      friends: CommonGroundPromoFriend[];
      headlineIndex?: number;
    }
  | {
      kind: 'recently_expanding';
      href: string;
      domains: RecentlyExpandingPromoDomain[];
      headlineIndex?: number;
    }
  | {
      kind: 'add_friends';
      variant: 'suggestions';
      href: string;
      people: AddFriendsPromoPerson[];
      headlineIndex?: number;
    }
  | {
      kind: 'add_friends';
      variant: 'invite';
      href: string;
      headlineIndex?: number;
    };

export type StreamItem = {
  id: string;
  sortAt: Date;
  tier: number;
  // The single friend this row belongs to, used to group a friend's relationship
  // activity into one per-person card on the home feed. `null` for friend-less
  // rows ("You shared…", "Everyone played…", the weekly ceremony, and the
  // viewer-only promos). Set at construction so the grouping never re-parses the
  // line parts.
  friendId?: string | null;
  // How this row reads inside a per-person relationship cluster, so the cluster
  // can roll events up by direction without re-parsing copy (D-FEED-TIER v2 §3):
  //   you_got     — you answered THEIR question right ("got {Name} — topics")
  //   got_you     — they answered YOUR question ("{Name} got yours — topics")
  //   convergence — you both knew the same shared questions (folded, one line)
  //   saved       — they saved your question
  //   reacted     — they reacted to your question
  // Undefined = not a per-person relationship event (renders as a plain line).
  relationship?: 'you_got' | 'got_you' | 'convergence' | 'saved' | 'reacted';
  // The topic/category this event is about, for the cluster's rolled-up lists.
  topic?: string | null;
  // Whether this item is eligible for the homepage's curated head.
  homeEligible: boolean;
  line: StreamLinePart[];
  secondLine: string | null;
  // Which type voice renders `secondLine` (STYLE-GUIDE-TYPE §5): 'system' for
  // structured metadata (domain names, reaction labels) → mono; omitted for
  // Editorial content (question text, sentences) → serif. secondLine carries
  // both kinds depending on the row, so the builder declares which it is.
  secondLineVoice?: 'system';
  // Optional DOM id (friend-invitation deep link: /activities#friendship-{id}).
  anchorId: string | null;
  action: StreamAction | null;
  expand: StreamExpand | null;
  // Which triangle mark (if any) precedes this row. See StreamIconKind.
  icon: StreamIconKind;
  // Optional inline embed rendered under the one-liner (see StreamEmbed).
  embed?: StreamEmbed | null;
};

// --- Small builders ----------------------------------------------------------

const txt = (v: string): StreamLinePart => ({ t: 'text', v });
const cat = (v: string): StreamLinePart => ({ t: 'category', v });
const act = (name: string, userId: string | null): StreamLinePart => ({
  t: 'actor',
  name,
  userId,
});

function actorName(item: ActivityItemView): string {
  return item.actor?.displayName ?? 'Someone';
}

const HOME_ELIGIBLE = new Set<string>(HOME_TOP3_ELIGIBLE_TYPES);

// --- Relationship copy pools (D-FEED-GROUP3-01 Appendix A) --------------------
//
// Full-sentence lone-event copy. Each line is hash-selected per event id (the
// same djb2 the convergence pool uses) so a feed of the same event type still
// varies, while a given event always reads the same way. The `{friend}` token
// becomes the actor link; `{topic}` the serif category. Every line is safe for
// ANY instance of its type, and the register is connection-only — the banned
// competition words (beat/called/nailed/crushed/schooled/"had your number") are
// kept out by construction.
//
// Pool 1 — got_you: a friend answered a question YOU wrote (one-way; no "you both").
const GOT_YOU_LINES = [
  '{friend} knew your {topic} question',
  '{friend} knows {topic} down',
  '{friend} was right there with you on {topic}',
  '{friend} came through on your {topic} question',
  '{friend} understood your {topic} question',
  '{friend} has {topic} down cold',
] as const;
// When the event carries no topic, fall back to the calm topic-less baseline
// rather than dangling an empty category.
const GOT_YOU_NO_TOPIC = '{friend} got your question';

// Pool 2 — you_got: YOU answered a friend's question (one-way; no "you both").
const YOU_GOT_LINES = [
  "You knew {friend}'s {topic} question",
  'You know {topic} down',
  'You were right there with {friend} on {topic}',
  "You came through on {friend}'s {topic} question",
  "You understood {friend}'s {topic} question",
  "You've got {topic} down cold",
] as const;
const YOU_GOT_NO_TOPIC = "You knew {friend}'s question";

function pickLine(
  pool: readonly string[],
  noTopic: string,
  eventId: string,
  topic: string | null,
): string {
  if (!topic) return noTopic;
  return pool[djb2(eventId) % pool.length];
}

// Render a copy template into stream line parts: `{friend}` → actor link,
// `{topic}` → serif category, everything else plain text.
function renderTemplate(
  template: string,
  friend: { name: string; userId: string | null },
  topic: string | null,
): StreamLinePart[] {
  const parts: StreamLinePart[] = [];
  const re = /\{(friend|topic)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    if (m.index > last) parts.push(txt(template.slice(last, m.index)));
    parts.push(m[1] === 'friend' ? act(friend.name, friend.userId) : cat(topic ?? ''));
    last = re.lastIndex;
  }
  if (last < template.length) parts.push(txt(template.slice(last)));
  return parts;
}

// --- Activity rows -----------------------------------------------------------

// Port of the per-type copy (formerly split across NewsRow.buildCopy and the
// /activities ActivityCopy switch) into one quiet one-liner per type.
export function activityToStreamItem(item: ActivityItemView): StreamItem {
  const base = {
    id: item.id,
    sortAt: item.createdAt,
    tier: nicheTier(item.type),
    homeEligible: HOME_ELIGIBLE.has(item.type),
    anchorId:
      (item.type === 'friend_request' || item.type === 'follow_request') && item.referenceId
        ? `friendship-${item.referenceId}`
        : null,
    // Default: no mark, column reserved. Overridden per type below.
    icon: null as StreamIconKind,
    // Most activity rows are a single friend acting; the friend-less cases
    // ("You shared…", "Everyone played…", the ceremony) null this out below.
    friendId: item.actorUserId,
  };

  const a = act(actorName(item), item.actorUserId);

  switch (item.type) {
    case 'friend_answered_your_question': {
      // Your authored question a friend answered (got it or missed it). Either
      // way it's YOUR question -> expand to reveal it and offer "send onward".
      const faq = item.reference.friendAnsweredQuestion;
      const got = faq?.result === 'correct';
      const domain = faq?.domain?.trim() || null;
      // Correct = the warm "got_you" event: full-sentence Pool 1 copy with the
      // topic folded into the line (so no echoed second line). A miss keeps the
      // calm factual "answered your question" with the domain as the second line.
      const line = got
        ? renderTemplate(
            pickLine(GOT_YOU_LINES, GOT_YOU_NO_TOPIC, item.id, domain),
            { name: actorName(item), userId: item.actorUserId },
            domain,
          )
        : [a, txt(' answered your question')];
      return {
        ...base,
        line,
        secondLine: got ? null : domain,
        secondLineVoice: 'system',
        icon: 'diamond',
        relationship: 'got_you',
        topic: domain,
        action: null,
        expand:
          item.referenceId && faq?.questionText
            ? {
                kind: 'your_question',
                question: {
                  questionId: item.referenceId,
                  text: faq.questionText,
                  domain,
                  priorResult: null,
                  authorName: faq.authorName,
                  authorIsHouse: faq.authorIsHouse,
                },
              }
            : null,
      };
    }

    case 'niche_match_answered_your_question': {
      const nm = item.reference.nicheMatch;
      const domain = nm?.domain?.trim() || null;
      return {
        ...base,
        line: [a, txt(' answered your question — someone shares this corner')],
        secondLine: domain,
        secondLineVoice: 'system',
        icon: 'diamond',
        action: null,
        expand:
          item.referenceId && nm?.questionText
            ? {
                kind: 'niche_match',
                question: {
                  questionId: item.referenceId,
                  text: nm.questionText,
                  domain,
                  priorResult: null,
                },
                strangerId: item.actorUserId,
                strangerName: actorName(item),
              }
            : null,
      };
    }

    case 'niche_match_you_answered': {
      const nm = item.reference.nicheMatch;
      const domain = nm?.domain?.trim() || null;
      return {
        ...base,
        line: [txt('You answered '), a, txt("'s question — you found someone")],
        secondLine: domain,
        secondLineVoice: 'system',
        icon: 'diamond',
        action: null,
        expand:
          item.referenceId && nm?.questionText
            ? {
                kind: 'niche_match',
                question: {
                  questionId: item.referenceId,
                  text: nm.questionText,
                  domain,
                  priorResult: 'correct',
                },
                strangerId: item.actorUserId,
                strangerName: actorName(item),
              }
            : null,
      };
    }

    case 'declared_promoted': {
      const dp = item.reference.declaredPromoted;
      const domain = dp?.domain?.trim() || null;
      return {
        ...base,
        line: [a, txt(domain ? ' opened ' + domain : ' opened a new domain')],
        secondLine: domain,
        secondLineVoice: 'system',
        icon: 'domain',
        action: domain
          ? {
              kind: 'link',
              href: `/knowledge/${encodeURIComponent(domain)}`,
              label: 'See your map',
            }
          : { kind: 'link', href: '/knowledge', label: 'See your map' },
        expand: null,
      };
    }

    case 'friend_mastery': {
      const m = item.reference.masteryEvent;
      return {
        ...base,
        line: [a, txt(` reached ${m?.tier ?? 'a new tier'}`)],
        secondLine: m?.domain ?? null,
        secondLineVoice: 'system',
        action: null,
        expand: null,
      };
    }

    case 'reaction_received': {
      const reaction = item.reference.reaction;
      const label = reaction?.reactionLabel
        ? `${reaction.reactionEmoji ? `${reaction.reactionEmoji} ` : ''}${reaction.reactionLabel}`
        : null;
      const domain = reaction?.domain?.trim() || null;
      return {
        ...base,
        line: [a, txt(' reacted to your question')],
        secondLine: label,
        secondLineVoice: 'system',
        relationship: 'reacted',
        topic: domain,
        // Keep the lightweight "got it" acknowledgement AND let the row expand to
        // reveal the reacted-to question with honest authorship + send-onward
        // (D-FEED-GROUP3-01 §4).
        action: {
          kind: 'reaction_got_it',
          reactionId: reaction?.id ?? item.referenceId ?? '',
          replied: Boolean(reaction?.repliedAt),
        },
        expand:
          reaction?.questionId && reaction.questionText
            ? {
                kind: 'your_question',
                question: {
                  questionId: reaction.questionId,
                  text: reaction.questionText,
                  domain,
                  priorResult: null,
                  authorName: reaction.authorName,
                  authorIsHouse: reaction.authorIsHouse,
                },
              }
            : null,
      };
    }

    case 'question_curated': {
      const cq = item.reference.curatedQuestion;
      const domain = cq?.domain?.trim() || null;
      return {
        ...base,
        line: [a, txt(' saved your question')],
        secondLine: cq?.questionText ?? null,
        relationship: 'saved',
        topic: domain,
        action: null,
        // Expand to reveal the saved question (honest authorship) and send it
        // onward (D-FEED-GROUP3-01 §4). The question id is the activity referenceId.
        expand:
          item.referenceId && cq?.questionText
            ? {
                kind: 'your_question',
                question: {
                  questionId: item.referenceId,
                  text: cq.questionText,
                  domain,
                  priorResult: null,
                  authorName: cq.authorName,
                  authorIsHouse: cq.authorIsHouse,
                },
              }
            : null,
      };
    }

    case 'authored_question_shared': {
      const shared = item.reference.authoredSharedQuestion;
      const count = shared?.recipientCount ?? 0;
      const friendWord = count === 1 ? 'friend' : 'friends';
      return {
        ...base,
        line: [txt(`You shared a question with ${count} ${friendWord}`)],
        secondLine: shared?.domain ?? null,
        secondLineVoice: 'system',
        icon: 'hourglass',
        // Friend-less: this is the viewer's own broadcast, not one friend acting.
        friendId: null,
        action: null,
        expand: null,
      };
    }

    case 'received_direct_question': {
      const dq = item.reference.directQuestion;
      return {
        ...base,
        line: [a, txt(' sent you a question')],
        secondLine: dq?.questionText ?? null,
        icon: 'hourglass',
        // Answer it right here rather than linking to '/' (which only reloaded
        // home and left the recipient with no way to actually answer). Falls
        // back to a deep link only if the feed-item reference didn't hydrate.
        action: dq
          ? {
              kind: 'answer_direct',
              feedItemId: dq.feedItemId,
              questionId: dq.questionId,
              questionText: dq.questionText,
              domain: dq.category,
            }
          : { kind: 'link', href: '/', label: 'Answer' },
        expand: null,
      };
    }

    case 'received_joshing_game': {
      const complete = item.reference.game?.viewerStatus === 'complete';
      const title = item.reference.game?.title ?? 'a Joshing Game';
      return {
        ...base,
        line: [a, txt(` sent you ${title}`)],
        secondLine: null,
        action: item.referenceId
          ? {
              kind: 'link',
              href: complete ? `/games/${item.referenceId}/summary` : `/games/${item.referenceId}`,
              label: complete ? 'See results' : 'Play',
            }
          : null,
        expand: null,
      };
    }

    case 'joshing_game_progress':
      return {
        ...base,
        line: [a, txt(` played ${item.reference.game?.title ?? 'a Joshing Game'}`)],
        secondLine: null,
        // Game events stand on their own (their own link), not in a person card.
        friendId: null,
        action: item.referenceId
          ? { kind: 'link', href: `/games/${item.referenceId}/summary`, label: 'See so far' }
          : null,
        expand: null,
      };

    case 'joshing_game_result':
      return {
        ...base,
        line: [txt(`Everyone played ${item.reference.game?.title ?? 'a Joshing Game'}`)],
        secondLine: null,
        // Group/ambient event — no single friend to card it under.
        friendId: null,
        action: item.referenceId
          ? { kind: 'link', href: `/games/${item.referenceId}/summary`, label: 'See results' }
          : null,
        expand: null,
      };

    case 'ceremony_ready':
      return {
        ...base,
        line: [txt('Your weekly reflection is ready')],
        secondLine: 'A look at the questions, friends, and territories that defined your week.',
        // System event — viewer-only, not a friend's activity.
        friendId: null,
        action: item.referenceId
          ? { kind: 'link', href: `/ceremony/${item.referenceId}`, label: 'See it now' }
          : null,
        expand: null,
      };

    case 'friend_request':
    case 'follow_request': {
      const request = item.reference.friendshipRequest;
      const pending =
        request && request.status === 'pending' && request.requestedByUserId !== item.userId;
      // Surface the areas the requester flagged (the same suggestedInterests the
      // Friends Hub card shows as chips) so the feed row isn't a blind ask. Topic
      // labels render in the System mono metadata voice, like domain names.
      const interests = request?.suggestedInterests ?? [];
      return {
        ...base,
        // Phase 1 frames the follow model as friend requests (the asymmetric
        // follow vocabulary returns in phase 2).
        line: [a, txt(' wants to be friends')],
        secondLine: interests.length > 0 ? interests.join(' · ') : null,
        secondLineVoice: interests.length > 0 ? 'system' : undefined,
        action: pending ? { kind: 'friend_request', friendshipId: request.id } : null,
        expand: null,
      };
    }

    case 'follow':
      return {
        ...base,
        line: [a, txt(' added you as a friend')],
        secondLine: null,
        action: null,
        expand: null,
      };

    case 'follow_approved':
      return {
        ...base,
        line: [a, txt(' accepted your friend request')],
        secondLine: null,
        action: null,
        expand: null,
      };

    case 'follow_mutual':
      // Written to the accepter when they approve a request: the two are now
      // mutual friends. The actor is the new friend; name-first reads as the
      // quiet "now connected" confirmation the accepter was missing.
      return {
        ...base,
        line: [a, txt(' is now a friend')],
        secondLine: null,
        action: null,
        expand: null,
      };

    case 'invited_friend_played_first_five':
      return {
        ...base,
        line: [a, txt(' played their first five questions')],
        secondLine: null,
        // A friend you invited cleared their first five: the five-point star mark
        // (five palette triangles, one per question). Its radial silhouette stands
        // apart from the diamond/bundle so the milestone doesn't blur into the
        // rest of the triangle family.
        icon: 'star',
        action: null,
        expand: null,
      };

    case 'grade_dispute_filed':
      return {
        ...base,
        line: [a, txt(' asked for a re-look at your question')],
        secondLine: item.reference.gradeDispute?.questionText ?? null,
        action: null,
        expand: null,
      };

    default:
      return {
        ...base,
        line: [txt('Something happened on Joshing')],
        secondLine: null,
        action: null,
        expand: null,
      };
  }
}

function nicheTier(type: ActivityItemView['type']): number {
  return type === 'niche_match_answered_your_question' || type === 'niche_match_you_answered'
    ? LATELY_TIER.NICHE_MATCH
    : LATELY_TIER.OTHER;
}

// --- Moments -----------------------------------------------------------------

// A Lately moment is always question-backed. they_got_you = a friend answered
// YOUR question -> "send onward". you_got_them = you answered THEIR question;
// it's their question, but you already answered it, so the only forward action
// is still to send it onward to someone new.
export function momentToStreamItem(moment: LatelyMoment): StreamItem {
  const theyGotYou = moment.dir === 'they_got_you';
  const topic = moment.category;
  const friend = { name: moment.friendName, userId: moment.friendId };
  // Full-sentence lone copy from the relationship pools (Appendix A), with the
  // topic folded into the line so there's no echoed second line. Moments are
  // human-authored by query construction (house/LLM questions are excluded), so
  // the reveal needs no provenance marker — author fields stay undefined.
  const line = theyGotYou
    ? renderTemplate(pickLine(GOT_YOU_LINES, GOT_YOU_NO_TOPIC, moment.momentId, topic), friend, topic)
    : renderTemplate(pickLine(YOU_GOT_LINES, YOU_GOT_NO_TOPIC, moment.momentId, topic), friend, topic);
  return {
    id: moment.momentId,
    sortAt: moment.answeredAt,
    tier: latelyTierForMomentDir(moment.dir),
    // they_got_you is the headline social signal — home-eligible. you_got_them is
    // quieter; keep it to the full list.
    homeEligible: theyGotYou,
    friendId: moment.friendId,
    relationship: theyGotYou ? 'got_you' : 'you_got',
    topic,
    line,
    secondLine: null,
    anchorId: null,
    action: null,
    icon: 'diamond',
    expand: {
      kind: 'your_question',
      question: {
        questionId: moment.questionId,
        text: moment.questionText,
        domain: moment.category,
        priorResult: 'correct',
      },
    },
  };
}

// --- Milestones --------------------------------------------------------------

// Copy variation (D-4 §A soft-copy): the milestone headline reads in a few
// interchangeable voices so a feed of milestones doesn't repeat one phrasing.
// Hash-selected per milestone id (the same djb2 the relationship pools use) so a
// given milestone always reads the same way while the feed as a whole varies.
// Every lead is safe for ANY domain set and stays in the warm, non-competitive
// register (no "mastered"/"beat"/"crushed"). DEEP precedes a single domain
// ("{name} went deep on {domain}"); BREADTH precedes the rolled-up domain list
// ("{name} has been on a roll — A, B and N others"). Both start with the leading
// space that joins them to the name part before them.
const DEEP_LEADS = [
  ' went deep on ',
  ' has been all over ',
  " can't get enough of ",
  ' has been living in ',
  ' went down a rabbit hole on ',
  ' has been on a tear through ',
] as const;

const BREADTH_LEADS = [
  ' has been on a streak — ',
  ' has been on a roll — ',
  ' has been all over the map — ',
  ' has been racking them up — ',
  ' has been ranging wide — ',
  ' has been keeping busy — ',
] as const;

// A milestone is a quiet roll-up of a friend showing skill. Collapsed: a few
// domains + "and N others". Expanded: the friend's literal ≤5 questions, each
// ANSWERABLE (someone else's questions -> answer).
export function milestoneToStreamItem(
  milestone: LatelyMilestone,
  questions: StreamQuestion[],
): StreamItem {
  const friend = act(milestone.friendName, milestone.friendId);
  let tail: StreamLinePart[];
  if (milestone.kind === 'milestone_deep') {
    const lead = DEEP_LEADS[djb2(milestone.id) % DEEP_LEADS.length];
    tail = [txt(lead), cat(milestone.domain)];
  } else {
    // Name only the domains whose questions actually survived resolution — a
    // question can be deleted/hidden after the friend answered it, and the
    // header must not claim a domain the expansion can't show. Fall back to all
    // domains if nothing resolved (the line then isn't expandable anyway).
    const survivingIds = new Set(questions.map((q) => q.questionId));
    const surviving = milestone.domains.filter((d) =>
      d.questionIds.some((id) => survivingIds.has(id)),
    );
    const named = (surviving.length > 0 ? surviving : milestone.domains).map((d) => d.domain);
    const lead = BREADTH_LEADS[djb2(milestone.id) % BREADTH_LEADS.length];
    tail = breadthTail(named, lead);
  }
  return {
    id: milestone.id,
    sortAt: milestone.sortAt,
    tier: LATELY_TIER.MILESTONE,
    friendId: milestone.friendId,
    homeEligible: true,
    line: [friend, ...tail],
    secondLine: null,
    anchorId: null,
    action: null,
    icon: 'bundle',
    expand: {
      kind: 'milestone',
      friendId: milestone.friendId,
      friendName: milestone.friendName,
      questions,
    },
  };
}

// --- From Friends activity card (D-FEED-FRIEND-ACTIVITY-01) -------------------

// Flattering, topic-attached leads for the From Friends card. Warm, complimentary
// register (no "mastered"/"beat"/"crushed"). Each ends on a preposition so the
// domain(s) the friend played in this burst follow as serif `category` parts —
// e.g. "{Name} has been killing it in {Geography} and {History}". One lead is
// picked per card id so a stack reads varied.
const FRIEND_ACTIVITY_LEADS = [
  ' has been killing it in ',
  ' has been on a streak of wisdom in ',
  ' is amazing answering questions about ',
  ' has been all over ',
  " can't get enough of ",
  ' has been on a tear through ',
] as const;

// Fallback when none of the burst's questions resolved a domain — keep the same
// complimentary voice without naming a topic.
const FRIEND_ACTIVITY_LEADS_NO_TOPIC = [
  ' has been killing it',
  ' has been on a streak of wisdom',
  ' is on a roll',
] as const;

// Distinct domains the friend played in this card, most-recent first (the
// questions arrive most-recent first). Drives the topic tail.
function friendActivityDomains(questions: StreamQuestion[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of questions) {
    const d = q.domain?.trim();
    if (d && !seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  return out;
}

// One From Friends play burst/batch, expanded to its answerable questions. Mirrors
// `milestoneToStreamItem` (same StreamItem shape, same 'milestone' expand the feed
// already renders) but sorts on the card's chronological `effectiveAt`. The copy
// keeps the flattering breadth voice — a complimentary lead + the burst's domains
// rolled up "A, B and N others" — even though grouping is now time-based.
export function friendActivityToStreamItem(
  card: FriendActivityCard,
  questions: StreamQuestion[],
): StreamItem {
  const friend = act(card.friendName, card.friendId);
  const domains = friendActivityDomains(questions);
  const tail: StreamLinePart[] =
    domains.length > 0
      ? breadthTail(domains, FRIEND_ACTIVITY_LEADS[djb2(card.id) % FRIEND_ACTIVITY_LEADS.length])
      : [txt(FRIEND_ACTIVITY_LEADS_NO_TOPIC[djb2(card.id) % FRIEND_ACTIVITY_LEADS_NO_TOPIC.length])];
  return {
    id: card.id,
    sortAt: card.effectiveAt,
    tier: LATELY_TIER.MILESTONE,
    friendId: card.friendId,
    homeEligible: true,
    line: [friend, ...tail],
    secondLine: null,
    anchorId: null,
    action: null,
    icon: 'bundle',
    expand: {
      kind: 'milestone',
      friendId: card.friendId,
      friendName: card.friendName,
      questions,
    },
  };
}

// "X and Y", "X, Y and 3 others" — the breadth roll-up names ~2 domains and
// rolls the rest into a count, instead of enumerating every domain. The named
// domains are emitted as `category` parts so they pick up the serif treatment;
// the connective copy and "N others" count stay plain text.
function breadthTail(domains: string[], leadCopy: string): StreamLinePart[] {
  const [first, second, ...rest] = domains;
  const lead = txt(leadCopy);
  if (!second) return [lead, cat(first)];
  if (rest.length === 0) return [lead, cat(first), txt(' and '), cat(second)];
  const others = rest.length === 1 ? '1 other' : `${rest.length} others`;
  return [lead, cat(first), txt(', '), cat(second), txt(` and ${others}`)];
}

// --- Convergence -------------------------------------------------------------

// A convergence is the quiet "same-correct overlap" line: you and a friend
// independently got the same shared questions right. The headline is
// PERSON-FIRST and names no domain — the caption template (assigned
// deterministically by moment id) carries a `{Name}` token that becomes the
// friend's first name as an actor link. It is the counterpart to the milestone
// triangle: the triangle row carries questions you have NOT answered
// (answerable), while this row carries the ones you and the friend BOTH already
// got right. Home-eligible so both rows surface together on Home, not just in
// Lately. Expanding reveals the cluster's questions as clean quotes, each with a
// quiet per-quote share glyph (the streamlined reveal); no answer or reaction.
// The domains are named in the headline, not repeated in the reveal.
export function convergenceToStreamItem(
  convergence: Convergence,
  questions: StreamQuestion[],
  captionTemplate: string,
  // Non-null only when all 3 cluster questions share ONE topic (Pool 3a); drives
  // the `{topic}` token. Null → the template is from the topic-less set (3b) and
  // carries no `{topic}` token, so nothing is interpolated.
  sharedTopic: string | null = null,
): StreamItem {
  // Person-first headline: `{Name}` → the friend actor link, `{topic}` → the
  // serif category (only present in the single-topic pool). When the cluster's
  // topics differ (topic-less pool), the distinct categories are appended as a
  // serif tail below so the line still says what you converged on.
  const line: StreamLinePart[] = [];
  const re = /\{(Name|topic)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(captionTemplate)) !== null) {
    if (m.index > last) line.push(txt(captionTemplate.slice(last, m.index)));
    line.push(
      m[1] === 'Name'
        ? act(convergence.friendFirstName, convergence.friendId)
        : cat(sharedTopic ?? ''),
    );
    last = re.lastIndex;
  }
  if (last < captionTemplate.length) line.push(txt(captionTemplate.slice(last)));

  // Topic-less pool (3b): the headline names no single domain, so on its own the
  // line ("…keep landing in the same place") says nothing about WHAT you and the
  // friend converged on. Append the cluster's distinct categories as a quiet
  // serif tail so the overlap is legible. (The single-topic pool already names
  // its one topic inline, so when `sharedTopic` is set we add nothing here.)
  if (!sharedTopic) {
    const seen = new Set<string>();
    const categories: string[] = [];
    for (const q of questions) {
      const d = q.domain?.trim();
      if (d && !seen.has(d)) {
        seen.add(d);
        categories.push(d);
      }
    }
    if (categories.length) {
      // Drop a trailing period on the predicate so the tail reads
      // "…same place — A, B, C" rather than "…same place. — A, B, C".
      const tailIdx = line.length - 1;
      const tailPart = line[tailIdx];
      if (tailPart && tailPart.t === 'text') {
        line[tailIdx] = txt(tailPart.v.replace(/\.\s*$/, ''));
      }
      line.push(txt(' — '));
      categories.forEach((c, i) => {
        if (i > 0) line.push(txt(', '));
        line.push(cat(c));
      });
    }
  }

  return {
    id: convergence.id,
    sortAt: convergence.sortAt,
    tier: LATELY_TIER.MILESTONE,
    friendId: convergence.friendId,
    relationship: 'convergence',
    homeEligible: true,
    line,
    secondLine: null,
    anchorId: null,
    action: null,
    icon: 'diamond',
    expand: {
      kind: 'same_correct',
      friendId: convergence.friendId,
      friendName: convergence.friendName,
      questions,
    },
  };
}

// --- Common-ground promo -----------------------------------------------------

// A homepage-only discovery nudge: "You and {friend} share ground worth
// testing", with the friend's top few shared-but-untested domains drawn as the
// overlapping-circle motif from their profile. Question-free, so it never
// expands; the embed carries everything ActivityStreamItem needs to render the
// circles plus a link through to the friend's profile.
export function commonGroundPromoToStreamItem(
  embed: Extract<StreamEmbed, { kind: 'common_ground' }>,
  sortAt: Date,
  id: string,
): StreamItem {
  return {
    id,
    sortAt,
    tier: LATELY_TIER.OTHER,
    friendId: embed.friendId,
    homeEligible: true,
    line: [txt('You and '), act(embed.friendFirstName, embed.friendId), txt(' share ground worth testing')],
    secondLine: null,
    anchorId: null,
    action: null,
    icon: 'domain',
    expand: null,
    embed,
  };
}

// A homepage-only knowledge nudge: "Your world is expanding", with the viewer's
// fastest-growing territories listed in the same row style as the /knowledge
// "Recently Expanding" module. Question-free, so it never expands; the embed
// carries the (capped) domain rows plus a link through to the knowledge page.
export function recentlyExpandingPromoToStreamItem(
  embed: Extract<StreamEmbed, { kind: 'recently_expanding' }>,
  sortAt: Date,
  id: string,
): StreamItem {
  return {
    id,
    sortAt,
    tier: LATELY_TIER.OTHER,
    friendId: null,
    homeEligible: true,
    line: [txt('Your world is expanding')],
    secondLine: null,
    anchorId: null,
    action: null,
    icon: 'domain',
    expand: null,
    embed,
  };
}

// A homepage-only "grow your circle" nudge. With `suggestions` it lists a few
// contact-match people to follow (each row carries its relationship so the
// embed's AddFriendButton can act); with `invite` it's a copy-only prompt toward
// /friends/find. Question-free, so it never expands.
export function addFriendsPromoToStreamItem(
  embed: Extract<StreamEmbed, { kind: 'add_friends' }>,
  sortAt: Date,
  id: string,
): StreamItem {
  return {
    id,
    sortAt,
    tier: LATELY_TIER.OTHER,
    friendId: null,
    homeEligible: true,
    line: [txt(embed.variant === 'suggestions' ? 'People you may know' : 'Grow your circle')],
    secondLine: null,
    anchorId: null,
    action: null,
    icon: 'domain',
    expand: null,
    embed,
  };
}
