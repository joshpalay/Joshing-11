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

import { HOME_TOP3_ELIGIBLE_TYPES } from '@/server/activity/write-activity';
import type { ActivityItemView } from '@/server/db/queries/activity';
import type { MasteryTier } from '@/types/db';
import type { LatelyMoment } from '@/server/db/queries/lately';
import { LATELY_TIER, latelyTierForMomentDir } from '@/lib/lately';
import type { LatelyMilestone } from '@/lib/lately-milestones';
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
  // A category/topic name embedded in a one-liner. Rendered in the editorial
  // serif register — the SAME font treatment categories get as the `secondLine`
  // on the homepage "What's Happening" head (see ActivityStreamItem).
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
  // SAME shared questions correctly. READ-ONLY — both already answered, so the
  // reveal just shows the cluster's questions (no answer, no send, no reaction).
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
//   - 'diamond'   → tan/darkyellow rhombus: someone answered ("got") a question.
//   - 'hourglass' → orange/teal triangles apex-to-apex: someone sends you a Q.
//   - 'domain'    → orange/teal half-triangles split on a diagonal: a new
//                   domain opened (expansion).
export type StreamIconKind = 'bundle' | 'diamond' | 'hourglass' | 'domain' | null;

// An optional rich embed rendered inline beneath a row's one-liner. Almost no
// rows carry one. The common-ground promo (homepage "What's happening" ONLY)
// uses it to surface a few domains the viewer shares with a friend as the
// overlapping-circle motif from the profile page — a quiet discovery nudge.
export type CommonGroundPromoDomain = {
  label: string;
  viewer: { points: number; tier: MasteryTier };
  friend: { points: number; tier: MasteryTier };
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
export type StreamEmbed =
  | {
      kind: 'common_ground';
      friendId: string;
      friendFirstName: string;
      friendHref: string;
      domains: CommonGroundPromoDomain[];
    }
  | {
      kind: 'recently_expanding';
      href: string;
      domains: RecentlyExpandingPromoDomain[];
    }
  | {
      kind: 'add_friends';
      variant: 'suggestions';
      href: string;
      people: AddFriendsPromoPerson[];
    }
  | {
      kind: 'add_friends';
      variant: 'invite';
      href: string;
    };

export type StreamItem = {
  id: string;
  sortAt: Date;
  tier: number;
  // Whether this item is eligible for the homepage's curated head.
  homeEligible: boolean;
  line: StreamLinePart[];
  secondLine: string | null;
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
  };

  const a = act(actorName(item), item.actorUserId);

  switch (item.type) {
    case 'friend_answered_your_question': {
      // Your authored question a friend answered (got it or missed it). Either
      // way it's YOUR question -> expand to reveal it and offer "send onward".
      const faq = item.reference.friendAnsweredQuestion;
      const got = faq?.result === 'correct';
      const domain = faq?.domain?.trim() || null;
      return {
        ...base,
        line: [a, txt(got ? ' got your question' : ' answered your question')],
        secondLine: domain,
        icon: 'diamond',
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
        action: null,
        expand: null,
      };
    }

    case 'reaction_received': {
      const reaction = item.reference.reaction;
      const label = reaction?.reactionLabel
        ? `${reaction.reactionEmoji ? `${reaction.reactionEmoji} ` : ''}${reaction.reactionLabel}`
        : null;
      return {
        ...base,
        line: [a, txt(' reacted to your question')],
        secondLine: label,
        action: {
          kind: 'reaction_got_it',
          reactionId: reaction?.id ?? item.referenceId ?? '',
          replied: Boolean(reaction?.repliedAt),
        },
        expand: null,
      };
    }

    case 'question_curated':
      return {
        ...base,
        line: [a, txt(' saved your question')],
        secondLine: item.reference.curatedQuestion?.questionText ?? null,
        action: null,
        expand: null,
      };

    case 'authored_question_shared': {
      const shared = item.reference.authoredSharedQuestion;
      const count = shared?.recipientCount ?? 0;
      const friendWord = count === 1 ? 'friend' : 'friends';
      return {
        ...base,
        line: [txt(`You shared a question with ${count} ${friendWord}`)],
        secondLine: shared?.domain ?? null,
        icon: 'hourglass',
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
      return {
        ...base,
        line: [a, txt(' wants to follow you')],
        secondLine: null,
        action: pending ? { kind: 'friend_request', friendshipId: request.id } : null,
        expand: null,
      };
    }

    case 'follow':
      return {
        ...base,
        line: [a, txt(' started following you')],
        secondLine: null,
        action: null,
        expand: null,
      };

    case 'follow_approved':
      return {
        ...base,
        line: [a, txt(' accepted your follow')],
        secondLine: null,
        action: null,
        expand: null,
      };

    case 'invited_friend_played_first_five':
      return {
        ...base,
        line: [a, txt(' played their first five questions')],
        secondLine: null,
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
  const friend = act(moment.friendName, moment.friendId);
  const theyGotYou = moment.dir === 'they_got_you';
  return {
    id: moment.momentId,
    sortAt: moment.answeredAt,
    tier: latelyTierForMomentDir(moment.dir),
    // they_got_you ("Robyn got your question") is the headline social signal —
    // home-eligible. you_got_them is quieter; keep it to the full list.
    homeEligible: theyGotYou,
    line: theyGotYou
      ? [friend, txt(' got your question')]
      : [txt('You got '), friend, txt(' on '), cat(moment.category)],
    secondLine: theyGotYou ? moment.category : null,
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

// A milestone is a quiet roll-up of a friend showing skill. Collapsed: a few
// domains + "and N others". Expanded: the friend's literal ≤5 questions, each
// ANSWERABLE (someone else's questions -> answer).
export function milestoneToStreamItem(
  milestone: LatelyMilestone,
  questions: StreamQuestion[],
): StreamItem {
  const friend = act(milestone.friendName, milestone.friendId);
  const tail =
    milestone.kind === 'milestone_deep'
      ? [txt(' went deep on '), cat(milestone.domain)]
      : breadthTail(milestone.domains.map((d) => d.domain));
  return {
    id: milestone.id,
    sortAt: milestone.sortAt,
    tier: LATELY_TIER.MILESTONE,
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

// "X and Y", "X, Y and 3 others" — the breadth roll-up names ~2 domains and
// rolls the rest into a count, instead of enumerating every domain. The named
// domains are emitted as `category` parts so they pick up the serif treatment;
// the connective copy and "N others" count stay plain text.
function breadthTail(domains: string[]): StreamLinePart[] {
  const [first, second, ...rest] = domains;
  const lead = txt(' has been on a streak — ');
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
// friend's first name as an actor link. It is Lately-ONLY (homeEligible: false,
// the same slow-burn treatment as niche-match) and READ-ONLY: expanding reveals
// the cluster's questions (domains may appear there as texture) with no answer,
// send, or reaction affordance.
export function convergenceToStreamItem(
  convergence: Convergence,
  questions: StreamQuestion[],
  captionTemplate: string,
): StreamItem {
  const [before, after] = captionTemplate.split('{Name}');
  const line: StreamLinePart[] = [];
  if (before) line.push(txt(before));
  line.push(act(convergence.friendFirstName, convergence.friendId));
  if (after) line.push(txt(after));
  return {
    id: convergence.id,
    sortAt: convergence.sortAt,
    tier: LATELY_TIER.MILESTONE,
    homeEligible: false,
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
