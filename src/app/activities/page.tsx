import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { CreatorNoteReadButton } from '@/app/activities/CreatorNoteReadButton';
import { filterUtilityActivities } from '@/app/activities/filter-utility-activities';
import { FriendRequestActions } from '@/app/activities/FriendRequestActions';
import { MarkActivitiesRead } from '@/app/activities/MarkActivitiesRead';
import { ReactionGotItButton } from '@/app/activities/ReactionGotItButton';
import { LatelyFeed, type LatelyFeedItem } from '@/components/lately/LatelyFeed';
import {
  CREAM,
  FH,
  FS,
  HILITE,
  INK,
  INK2,
} from '@/components/lately/tokens';
import {
  UnderlineName,
  UtilityActionLink,
} from '@/components/lately/UtilityCard';
import { creatorNoteSubmittedAnswerText } from '@/lib/creator-note-submitted-answer';
import { getSession } from '@/server/auth/session';
import {
  getActivitiesForUser,
  type ActivityItemView,
} from '@/server/db/queries/activity';
import { getLatelyMoments } from '@/server/db/queries/lately';
import { getUserById } from '@/server/db/queries/users';

function actorName(item: ActivityItemView) {
  return item.actor?.displayName ?? 'Someone';
}

function ActivityCopy({ item }: { item: ActivityItemView }) {
  const game = item.reference.game;
  const title = game?.title ?? 'a Joshing Game';
  const masteryEvent = item.reference.masteryEvent;

  if (item.type === 'received_joshing_game') {
    if (game?.viewerStatus === 'complete') {
      return (
        <>
          <UnderlineName>{actorName(item)}</UnderlineName> sent you {title}
        </>
      );
    }
    return (
      <>
        <UnderlineName>{actorName(item)}</UnderlineName> sent you a Joshing
        Game: {title}
      </>
    );
  }

  if (item.type === 'joshing_game_progress') {
    return (
      <>
        <UnderlineName>{actorName(item)}</UnderlineName> played {title}
      </>
    );
  }

  if (item.type === 'joshing_game_result') {
    return <>Everyone played {title}</>;
  }

  if (item.type === 'friend_mastery') {
    return (
      <>
        <UnderlineName>{actorName(item)}</UnderlineName> reached{' '}
        {masteryEvent?.tier ?? 'a new tier'} in{' '}
        {masteryEvent?.domain ?? 'a domain'}
      </>
    );
  }

  if (item.type === 'ceremony_ready') {
    return <>Your weekly reflection is ready</>;
  }

  if (item.type === 'friend_request') {
    return (
      <>
        <UnderlineName>{actorName(item)}</UnderlineName> thought of you for
        Joshing.
      </>
    );
  }

  if (item.type === 'friend_request_accepted') {
    return (
      <>
        You and <UnderlineName>{actorName(item)}</UnderlineName> are now
        friends
      </>
    );
  }

  if (item.type === 'reaction_received') {
    return (
      <>
        <UnderlineName>{actorName(item)}</UnderlineName> reacted to your
        question
      </>
    );
  }

  if (item.type === 'received_direct_question') {
    return (
      <>
        <UnderlineName>{actorName(item)}</UnderlineName> sent you a question.
      </>
    );
  }

  if (item.type === 'question_curated') {
    return (
      <>
        <UnderlineName>{actorName(item)}</UnderlineName> saved your question
      </>
    );
  }

  if (item.type === 'creator_note_received') {
    return (
      <>
        <UnderlineName>{actorName(item)}</UnderlineName> sent you a note about
        a question you missed
      </>
    );
  }

  if (item.type === 'authored_question_shared') {
    const shared = item.reference.authoredSharedQuestion;
    const count = shared?.recipientCount ?? 0;
    const friendWord = count === 1 ? 'friend' : 'friends';
    const domain = shared?.domain ?? 'a domain';
    return (
      <>
        You shared a question with {count} {friendWord} — {domain}
      </>
    );
  }

  if (item.type === 'friend_answered_your_question') {
    const faq = item.reference.friendAnsweredQuestion;
    const domain = faq?.domain;
    const domainText = domain ? ` ${domain}` : '';
    return (
      <>
        <UnderlineName>{actorName(item)}</UnderlineName> answered your
        {domainText} question — couldn&apos;t get it
      </>
    );
  }

  if (item.type === 'declared_promoted') {
    const dp = item.reference.declaredPromoted;
    const domain = dp?.domain;
    return domain ? (
      <>
        <UnderlineName>{actorName(item)}</UnderlineName> answered your {domain}{' '}
        question — that domain is now proven territory on your map
      </>
    ) : (
      <>
        <UnderlineName>{actorName(item)}</UnderlineName> answered your question
        — a domain is now proven territory on your map
      </>
    );
  }

  if (item.type === 'grade_dispute_filed') {
    return (
      <>
        <UnderlineName>{actorName(item)}</UnderlineName> asked for a re-look at
        your question
      </>
    );
  }

  return <>Something happened on Joshing</>;
}

export function ActivitySubcopy({ item }: { item: ActivityItemView }) {
  if (item.type === 'creator_note_received') {
    const note = item.reference.creatorNote;
    if (!note) return null;
    return (
      <CreatorNoteReadButton noteId={note.id}>
        <div className="bg-background rounded-md border p-3 text-sm leading-6">
          <p>
            <span className="text-foreground font-medium">Question:</span>{' '}
            {note.questionText}
          </p>
          <p className="text-muted-foreground mt-1">
            <span className="text-foreground font-medium">Answer:</span>{' '}
            {note.correctAnswer}
          </p>
          <p className="text-muted-foreground mt-1">
            <span className="text-foreground font-medium">You said:</span>{' '}
            {creatorNoteSubmittedAnswerText(note.submittedAnswer, 'Your')}
          </p>
          <blockquote className="border-primary/40 bg-muted/50 text-foreground mt-3 border-l-4 px-3 py-2">
            {note.noteText}
          </blockquote>
        </div>
      </CreatorNoteReadButton>
    );
  }

  if (item.type === 'received_direct_question') {
    const directQuestion = item.reference.directQuestion;
    if (!directQuestion) return null;

    return (
      <div className="text-muted-foreground mt-1 space-y-1 text-sm">
        {directQuestion.personalMessage ? (
          <p className="italic">
            &ldquo;{directQuestion.personalMessage}&rdquo;
          </p>
        ) : null}
        <p className="line-clamp-2">{directQuestion.questionText}</p>
      </div>
    );
  }

  if (item.type === 'question_curated') {
    const curatedQuestion = item.reference.curatedQuestion;
    if (!curatedQuestion) return null;
    return (
      <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
        {curatedQuestion.questionText}
      </p>
    );
  }

  if (item.type === 'friend_request') {
    const interests = item.reference.friendshipRequest?.suggestedInterests ?? [];
    if (interests.length === 0) return null;

    const label =
      interests.length === 1
        ? interests[0]
        : interests.length === 2
          ? `${interests[0]} and ${interests[1]}`
          : `${interests[0]}, ${interests[1]}, and ${interests[2]}`;

    return (
      <p className="text-muted-foreground mt-1 text-sm">
        They left a few ideas: {label}. Keep, edit, or ignore them.
      </p>
    );
  }

  if (item.type === 'grade_dispute_filed') {
    const dispute = item.reference.gradeDispute;
    if (!dispute) return null;
    return (
      <div className="bg-background mt-1 space-y-1 rounded-md border p-3 text-sm leading-6">
        <p>
          <span className="text-foreground font-medium">Question:</span>{' '}
          {dispute.questionText}
        </p>
        <p className="text-muted-foreground">
          <span className="text-foreground font-medium">Canonical answer:</span>{' '}
          {dispute.canonicalAnswer}
        </p>
        {/* §8.22 dispute path: the answerer initiated the dispute, which is
            the consent gate that lets the author see their literal text. */}
        <p className="text-muted-foreground">
          <span className="text-foreground font-medium">They wrote:</span>{' '}
          {dispute.submittedAnswer || '(no text)'}
        </p>
        <p className="text-muted-foreground text-xs">
          {disputeStatusLabel(dispute.status, dispute.acceptedAlternative)}
        </p>
      </div>
    );
  }

  if (item.type !== 'reaction_received') return null;
  const reaction = item.reference.reaction;
  if (!reaction) return null;

  return (
    <div className="text-muted-foreground mt-1 space-y-1 text-sm">
      <p>
        {reaction.reactionEmoji ? `${reaction.reactionEmoji} ` : ''}
        {reaction.reactionLabel}
        {reaction.customMessage ? ` - ${reaction.customMessage}` : ''}
      </p>
      <p className="line-clamp-2 italic">{reaction.questionText}</p>
      {/* §8.22 opt-in: rendered only when the answerer explicitly chose to
          include their submitted text. */}
      {reaction.submittedAnswer ? (
        <p>
          <span className="text-foreground font-medium">They wrote:</span>{' '}
          {reaction.submittedAnswer}
        </p>
      ) : null}
    </div>
  );
}

function disputeStatusLabel(
  status: string,
  acceptedAlternative: string | null,
): string {
  if (status === 'alternative_added') {
    return acceptedAlternative
      ? `Accepted — added "${acceptedAlternative}" as an alternative.`
      : 'Accepted — alternative added.';
  }
  if (status === 'dismissed') return 'Dismissed — grade stands.';
  if (status === 'reviewed') return 'Reviewed.';
  return 'Pending review.';
}

function activityAction(item: ActivityItemView): ReactNode | null {
  if (!item.referenceId) return null;

  if (item.type === 'received_joshing_game') {
    const complete = item.reference.game?.viewerStatus === 'complete';
    return (
      <UtilityActionLink
        href={
          complete
            ? `/games/${item.referenceId}/summary`
            : `/games/${item.referenceId}`
        }
        label={complete ? 'See results' : 'Play'}
      />
    );
  }

  if (item.type === 'joshing_game_progress') {
    return (
      <UtilityActionLink
        href={`/games/${item.referenceId}/summary`}
        label="See so far"
      />
    );
  }

  if (item.type === 'joshing_game_result') {
    return (
      <UtilityActionLink
        href={`/games/${item.referenceId}/summary`}
        label="See results"
      />
    );
  }

  if (item.type === 'ceremony_ready') {
    return (
      <UtilityActionLink
        href={`/ceremony/${item.referenceId}`}
        label="See it now"
      />
    );
  }

  if (item.type === 'reaction_received') {
    return (
      <ReactionGotItButton
        reactionId={item.reference.reaction?.id ?? item.referenceId}
        replied={Boolean(item.reference.reaction?.repliedAt)}
      />
    );
  }

  if (item.type === 'received_direct_question') {
    return <UtilityActionLink href="/" label="Answer" />;
  }

  if (item.type === 'friend_request') {
    const request = item.reference.friendshipRequest;
    if (
      !request ||
      request.status !== 'pending' ||
      request.requestedByUserId === item.userId
    ) {
      return null;
    }
    return <FriendRequestActions friendshipId={request.id} />;
  }

  if (item.type === 'declared_promoted') {
    const domain = item.reference.declaredPromoted?.domain;
    const href = domain
      ? `/knowledge/${encodeURIComponent(domain)}`
      : '/knowledge';
    return <UtilityActionLink href={href} label="See your map" />;
  }

  return null;
}

const INCOMING_TYPES = new Set([
  'received_direct_question',
  'received_joshing_game',
  'friend_request',
  'creator_note_received',
]);

function activityCaption(item: ActivityItemView): string {
  return INCOMING_TYPES.has(item.type) ? 'INCOMING' : 'FROM JOSHING';
}

function activityToFeedItem(item: ActivityItemView): LatelyFeedItem {
  const title = <ActivityCopy item={item} />;
  const subcopy = <ActivitySubcopy item={item} />;

  const italicBody: ReactNode | null =
    item.type === 'received_direct_question'
      ? item.reference.directQuestion?.category ?? null
      : null;

  const anchorId =
    item.type === 'friend_request' && item.referenceId
      ? `friendship-${item.referenceId}`
      : null;

  return {
    kind: 'utility',
    id: item.id,
    sortAt: item.createdAt,
    utility: {
      caption: activityCaption(item),
      title,
      italicBody,
      regularBody:
        item.type === 'ceremony_ready'
          ? 'A look at the questions, friends, and territories that defined your week.'
          : null,
      extra:
        item.type === 'received_direct_question' ? null : subcopy,
      action: activityAction(item),
      anchorId,
    },
  };
}

export default async function ActivitiesPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const [items, moments, viewer] = await Promise.all([
    getActivitiesForUser(session.userId),
    getLatelyMoments(session.userId),
    getUserById(session.userId),
  ]);
  const tz = viewer?.timezone ?? 'America/New_York';

  const utilityItems: LatelyFeedItem[] = filterUtilityActivities(items, moments)
    .map(activityToFeedItem);

  const momentItems: LatelyFeedItem[] = moments.map((m) => ({
    kind: 'moment',
    id: m.momentId,
    sortAt: m.answeredAt,
    moment: m,
  }));

  const feedItems: LatelyFeedItem[] = [...momentItems, ...utilityItems];

  return (
    <main
      style={{
        background: CREAM,
        color: INK,
        minHeight: '100dvh',
      }}
    >
      <div
        style={{
          maxWidth: 420,
          margin: '0 auto',
          padding: '18px 20px 100px',
          boxSizing: 'border-box',
        }}
      >
        <MarkActivitiesRead />

        <div style={{ marginBottom: 6 }}>
          <h1
            style={{
              fontSize: 52,
              fontFamily: FS,
              fontWeight: 400,
              fontStyle: 'italic',
              lineHeight: 1,
              margin: 0,
              letterSpacing: -1.5,
              position: 'relative',
              display: 'inline-block',
            }}
          >
            Lately.
            <span
              aria-hidden
              style={{
                position: 'absolute',
                left: 0,
                right: '30%',
                bottom: 4,
                height: 8,
                background: HILITE,
                zIndex: -1,
                opacity: 0.85,
              }}
            />
          </h1>
        </div>
        <div
          style={{
            fontSize: 13,
            color: INK2,
            fontStyle: 'italic',
            lineHeight: 1.5,
            marginBottom: 4,
          }}
        >
          Moments of connection from across your games.
        </div>
        <div
          style={{
            fontFamily: FH,
            fontSize: 18,
            color: INK2,
            marginTop: 6,
            marginLeft: 2,
            transform: 'rotate(-1deg)',
            display: 'inline-block',
          }}
        >
          — the people who get you, getting you.
        </div>

        <LatelyFeed items={feedItems} tz={tz} />
      </div>
    </main>
  );
}
