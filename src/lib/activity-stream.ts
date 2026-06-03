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
import type { LatelyMoment } from '@/server/db/queries/lately';
import { LATELY_TIER, latelyTierForMomentDir } from '@/lib/lately';
import type { LatelyMilestone } from '@/lib/lately-milestones';

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
  // True when the viewer has already answered this question correctly. Drives
  // the milestone "{k} of {n} answered" progress and the no-double-credit story.
  answered: boolean;
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
    };

// A trailing, non-expanding utility action carried by some plain one-liners.
export type StreamAction =
  | { kind: 'link'; href: string; label: string }
  | { kind: 'friend_request'; friendshipId: string }
  | { kind: 'reaction_got_it'; reactionId: string; replied: boolean };

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
      (item.type === 'friend_request' || item.type === 'follow_request') &&
      item.referenceId
        ? `friendship-${item.referenceId}`
        : null,
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
        action: null,
        expand:
          item.referenceId && faq?.questionText
            ? {
                kind: 'your_question',
                question: {
                  questionId: item.referenceId,
                  text: faq.questionText,
                  domain,
                  answered: false,
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
        action: null,
        expand:
          item.referenceId && nm?.questionText
            ? {
                kind: 'niche_match',
                question: {
                  questionId: item.referenceId,
                  text: nm.questionText,
                  domain,
                  answered: false,
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
        action: null,
        expand:
          item.referenceId && nm?.questionText
            ? {
                kind: 'niche_match',
                question: {
                  questionId: item.referenceId,
                  text: nm.questionText,
                  domain,
                  answered: true,
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
        action: null,
        expand: null,
      };
    }

    case 'received_direct_question':
      return {
        ...base,
        line: [a, txt(' sent you a question')],
        secondLine: item.reference.directQuestion?.questionText ?? null,
        action: { kind: 'link', href: '/', label: 'Answer' },
        expand: null,
      };

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
              href: complete
                ? `/games/${item.referenceId}/summary`
                : `/games/${item.referenceId}`,
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
        secondLine:
          'A look at the questions, friends, and territories that defined your week.',
        action: item.referenceId
          ? { kind: 'link', href: `/ceremony/${item.referenceId}`, label: 'See it now' }
          : null,
        expand: null,
      };

    case 'friend_request':
    case 'follow_request': {
      const request = item.reference.friendshipRequest;
      const pending =
        request &&
        request.status === 'pending' &&
        request.requestedByUserId !== item.userId;
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
  return type === 'niche_match_answered_your_question' ||
    type === 'niche_match_you_answered'
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
    expand: {
      kind: 'your_question',
      question: {
        questionId: moment.questionId,
        text: moment.questionText,
        domain: moment.category,
        answered: true,
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
