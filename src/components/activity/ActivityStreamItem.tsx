'use client';

import Link from 'next/link';
import { useState, type KeyboardEvent } from 'react';

import { FriendRequestActions } from '@/app/activities/FriendRequestActions';
import { ReactionGotItButton } from '@/app/activities/ReactionGotItButton';
import { SendQuestionDrawer } from '@/components/SendQuestionDrawer';
import type {
  StreamExpand,
  StreamItem,
  StreamLinePart,
  StreamQuestion,
} from '@/lib/activity-stream';

import { InlineAnswerFlow } from './InlineAnswerFlow';
import { FM, INK, INK2, INK3, RULE } from '@/components/lately/tokens';

function ActorLink({ name, userId }: { name: string; userId: string | null }) {
  if (!userId) return <b style={{ fontWeight: 600 }}>{name}</b>;
  return (
    <Link
      href={`/users/${userId}`}
      onClick={(e) => e.stopPropagation()}
      style={{
        color: INK,
        fontWeight: 600,
        textDecoration: 'underline',
        textDecorationColor: RULE,
        textUnderlineOffset: 3,
      }}
    >
      {name}
    </Link>
  );
}

function Line({ parts }: { parts: StreamLinePart[] }) {
  return (
    <>
      {parts.map((part, i) => {
        if (part.t === 'actor') {
          return <ActorLink key={i} name={part.name} userId={part.userId} />;
        }
        if (part.t === 'category') {
          // Same editorial serif register categories get as the homepage
          // "What's Happening" second line, applied inline here.
          return (
            <span key={i} style={{ fontFamily: 'Georgia, serif', color: INK2 }}>
              {part.v}
            </span>
          );
        }
        return <span key={i}>{part.v}</span>;
      })}
    </>
  );
}

function questionBacked(expand: StreamExpand | null): boolean {
  if (!expand) return false;
  if (expand.kind === 'milestone') return expand.questions.length > 0;
  return true;
}

export function ActivityStreamItem({
  item,
  timestamp,
}: {
  item: StreamItem;
  timestamp: string;
}) {
  const [open, setOpen] = useState(false);
  const expandable = questionBacked(item.expand);

  // CORRECTION 3: the answered-of-total counter lives on the LINE (collapsed and
  // expanded), so the answered-state is held HERE — not inside the expansion —
  // and ticks up + persists as the viewer answers, even after the result pop-up
  // closes or the line is collapsed and reopened. Milestone lines only.
  const expand = item.expand;
  const milestoneQuestions =
    expand && expand.kind === 'milestone' ? expand.questions : null;
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(
    () =>
      new Set(
        (milestoneQuestions ?? [])
          .filter((q) => q.answered)
          .map((q) => q.questionId),
      ),
  );

  function markAnswered(questionId: string) {
    setAnsweredIds((prev) => {
      const next = new Set(prev);
      next.add(questionId);
      return next;
    });
  }

  const milestoneProgress =
    milestoneQuestions && milestoneQuestions.length > 0
      ? {
          answered: milestoneQuestions.filter((q) =>
            answeredIds.has(q.questionId),
          ).length,
          total: milestoneQuestions.length,
        }
      : null;

  function toggle() {
    if (expandable) setOpen((v) => !v);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (!expandable) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  }

  return (
    <div
      id={item.anchorId ?? undefined}
      style={{
        borderBottom: `1px solid ${RULE}`,
        padding: '12px 2px',
      }}
    >
      <div
        role={expandable ? 'button' : undefined}
        tabIndex={expandable ? 0 : undefined}
        aria-expanded={expandable ? open : undefined}
        onClick={toggle}
        onKeyDown={handleKeyDown}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          cursor: expandable ? 'pointer' : 'default',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <p
            style={{
              margin: 0,
              fontSize: 15,
              lineHeight: 1.5,
              letterSpacing: 0.2,
              color: INK,
            }}
          >
            <Line parts={item.line} />
          </p>
          {item.secondLine ? (
            <p
              style={{
                margin: '2px 0 0',
                fontFamily: 'Georgia, serif',
                fontSize: 14,
                lineHeight: 1.45,
                color: INK2,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {item.secondLine}
            </p>
          ) : null}
          {milestoneProgress ? (
            <p
              style={{
                margin: '4px 0 0',
                fontFamily: FM,
                fontSize: 10,
                letterSpacing: 1,
                color: INK3,
              }}
            >
              {milestoneProgress.answered} of {milestoneProgress.total}
            </p>
          ) : null}
        </div>

        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 4,
          }}
        >
          <span style={{ fontSize: 13, color: INK3, whiteSpace: 'nowrap' }}>{timestamp}</span>
          {expandable ? (
            <span style={{ fontFamily: FM, fontSize: 9, letterSpacing: 1.5, color: INK3 }}>
              {open ? '− QUESTION' : '+ QUESTION'}
            </span>
          ) : null}
        </div>
      </div>

      {item.action ? <ItemAction action={item.action} /> : null}

      {expandable && open && expand ? (
        expand.kind === 'milestone' ? (
          <MilestoneExpansion
            expand={expand}
            answeredIds={answeredIds}
            onAnswered={markAnswered}
          />
        ) : (
          <SendOnwardExpansion expand={expand} />
        )
      ) : null}
    </div>
  );
}

function ItemAction({ action }: { action: NonNullable<StreamItem['action']> }) {
  return (
    <div style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
      {action.kind === 'link' ? (
        <Link
          href={action.href}
          style={{
            display: 'inline-block',
            background: INK,
            color: '#fcf8f2',
            fontFamily: FM,
            fontSize: 10,
            letterSpacing: 2,
            padding: '8px 12px',
            textDecoration: 'none',
          }}
        >
          {action.label.toUpperCase()} →
        </Link>
      ) : action.kind === 'friend_request' ? (
        <FriendRequestActions friendshipId={action.friendshipId} />
      ) : (
        <ReactionGotItButton reactionId={action.reactionId} replied={action.replied} />
      )}
    </div>
  );
}

// CORRECTION 3: the expanded milestone questions render at the homepage's FULL
// width — no narrow inset (the old left-rule/indent is gone) — matching the
// one-liner register. The answered-state is owned by the parent so the line's
// quiet "{answered} of {total}" counter ticks up here; this only lists the
// friend's ≤5 literal questions to answer.
function MilestoneExpansion({
  expand,
  answeredIds,
  onAnswered,
}: {
  expand: Extract<StreamExpand, { kind: 'milestone' }>;
  answeredIds: Set<string>;
  onAnswered: (questionId: string) => void;
}) {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        marginTop: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {expand.questions.map((q) => (
        <InlineAnswerFlow
          key={q.questionId}
          question={q}
          answered={answeredIds.has(q.questionId)}
          onAnswered={onAnswered}
        />
      ))}
    </div>
  );
}

function SendOnwardExpansion({
  expand,
}: {
  expand: Extract<StreamExpand, { kind: 'your_question' | 'niche_match' }>;
}) {
  const [sendOpen, setSendOpen] = useState(false);
  const question: StreamQuestion = expand.question;

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        marginTop: 12,
        borderLeft: `2px solid ${RULE}`,
        paddingLeft: 12,
      }}
    >
      <p
        style={{
          margin: '0 0 12px',
          fontFamily: 'Georgia, serif',
          fontStyle: 'italic',
          fontSize: 14,
          lineHeight: 1.55,
          color: INK2,
        }}
      >
        &ldquo;{question.text}&rdquo;
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button
          type="button"
          onClick={() => setSendOpen(true)}
          style={{
            background: INK,
            color: '#fcf8f2',
            border: 'none',
            fontFamily: FM,
            fontSize: 10,
            letterSpacing: 2,
            padding: '8px 14px',
            cursor: 'pointer',
          }}
        >
          SEND IT ONWARD →
        </button>

        {expand.kind === 'niche_match' && expand.strangerId ? (
          <Link
            href={`/users/${expand.strangerId}`}
            style={{
              background: 'transparent',
              color: INK,
              border: `1.5px solid ${INK}`,
              fontFamily: FM,
              fontSize: 10,
              letterSpacing: 2,
              padding: '8px 14px',
              textDecoration: 'none',
            }}
          >
            DISCOVER {expand.strangerName.split(/\s+/)[0]?.toUpperCase() ?? 'THEM'} →
          </Link>
        ) : null}
      </div>

      <SendQuestionDrawer
        isOpen={sendOpen}
        onClose={() => setSendOpen(false)}
        question={{
          id: question.questionId,
          text: question.text,
          domain: question.domain ?? '',
        }}
      />
    </div>
  );
}
