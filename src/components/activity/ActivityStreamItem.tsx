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
import { ActivityIcon, specForIcon } from './ActivityIcon';
import { FF, FM, INK, INK2, INK3, PAPER, RULE } from '@/components/lately/tokens';
import { assertNever } from '@/lib/assert-never';

// Friend names render in the activity-blue from Figma (--brand-link #4a5d75),
// linked or not, so the actor reads as the warm social anchor of the row.
const ACTOR_BLUE = 'var(--brand-link)';

function ActorLink({ name, userId }: { name: string; userId: string | null }) {
  if (!userId) return <b style={{ fontWeight: 600, color: ACTOR_BLUE }}>{name}</b>;
  return (
    <Link
      href={`/users/${userId}`}
      onClick={(e) => e.stopPropagation()}
      style={{
        color: ACTOR_BLUE,
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
  switch (expand.kind) {
    // Question-list reveals: only expandable when there's something to reveal.
    case 'milestone':
    case 'same_correct':
      return expand.questions.length > 0;
    // Single-question reveals are always backed by their one question.
    case 'your_question':
    case 'niche_match':
      return true;
    default:
      // Exhaustiveness guard: a new StreamExpand kind won't compile until it's
      // handled here (and in the expansion render below).
      return assertNever(expand, 'StreamExpand');
  }
}

// One in-session answer to a milestone question: what the viewer typed and
// whether it was scored correct. Drives the calm "Answered" history copy.
type Resolution = { submitted: string; isCorrect: boolean };

export function ActivityStreamItem({ item, timestamp }: { item: StreamItem; timestamp: string }) {
  const [open, setOpen] = useState(false);
  const expandable = questionBacked(item.expand);

  // CORRECTION 3 (revised): the answered-of-total counter lives on the LINE
  // (collapsed and expanded), so the answered-state is held HERE — not inside
  // the expansion — and ticks up + persists as the viewer answers, even after
  // the result pop-up closes or the line is collapsed and reopened. We also keep
  // each in-session resolution (submitted answer + correctness) here so the
  // expanded "Answered" history can read it back. Milestone lines only.
  const expand = item.expand;
  const milestoneQuestions = expand && expand.kind === 'milestone' ? expand.questions : null;
  // Questions the server already records as answered (correctly) on load. We
  // don't have the original submitted text for these, so the history shows a
  // calm "Correct" without the "You answered:" clause for them.
  const [serverAnswered] = useState<Set<string>>(
    () => new Set((milestoneQuestions ?? []).filter((q) => q.answered).map((q) => q.questionId)),
  );
  // Resolutions captured this session — both correct and "not this time" — keyed
  // by questionId, carrying what the viewer typed so the history can echo it. A
  // question goes in here on the FIRST answer regardless of correctness, which is
  // what locks it: see isResolved.
  const [resolutions, setResolutions] = useState<Map<string, Resolution>>(() => new Map());

  // A resolved question is settled and NO LONGER answerable for the rest of this
  // session — answering it wrong once retires it the same way a correct answer
  // does (it drops out of the active slot below and into the Answered history),
  // so the viewer can't take a second swing at it here.
  function isResolved(questionId: string): boolean {
    return serverAnswered.has(questionId) || resolutions.has(questionId);
  }

  function resolve(questionId: string, submitted: string, isCorrect: boolean) {
    setResolutions((prev) => {
      const next = new Map(prev);
      next.set(questionId, { submitted, isCorrect });
      return next;
    });
  }

  const answeredCount = (milestoneQuestions ?? []).filter((q) => isResolved(q.questionId)).length;

  const milestoneProgress =
    milestoneQuestions && milestoneQuestions.length > 0
      ? { answered: answeredCount, total: milestoneQuestions.length }
      : null;

  // The bundle mark (milestone) shares the row's live answered-state: as the
  // viewer answers questions inline, solid triangles flip to hollow. Caps at 5
  // triangles silently (the questions array is already ≤5); copy stays truthful.
  const bundleCounts =
    item.icon === 'bundle' && milestoneQuestions
      ? (() => {
          const total = Math.min(milestoneQuestions.length, 5);
          const answered = Math.min(answeredCount, total);
          return { total, unanswered: total - answered };
        })()
      : null;
  const iconSpec = specForIcon(item.icon, bundleCounts);

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

  // Opened milestone clusters read as a distinct, quiet "opened" state: a touch
  // more vertical room, a faint inset (slightly lifted paper + a gentle inset of
  // the side padding) and top/bottom hairlines — never a heavy card shadow or
  // loud fill, so the item still sits inside the feed.
  const opened = expandable && open;

  return (
    <div
      id={item.anchorId ?? undefined}
      style={
        opened
          ? {
              borderTop: `1px solid ${RULE}`,
              borderBottom: `1px solid ${RULE}`,
              padding: '18px 10px',
              background: PAPER,
            }
          : {
              borderBottom: `1px solid ${RULE}`,
              padding: '12px 2px',
            }
      }
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
          cursor: expandable ? 'pointer' : 'default',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <ActivityIcon spec={iconSpec} seed={item.id} />

        <div style={{ minWidth: 0, flex: 1, paddingRight: 12 }}>
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
              {milestoneProgress.answered} of {milestoneProgress.total} questions
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
        </div>
      </div>

      {item.action ? <ItemAction action={item.action} /> : null}

      {expandable && open && expand ? (
        expand.kind === 'milestone' ? (
          <MilestoneExpansion
            expand={expand}
            isResolved={isResolved}
            resolutions={resolutions}
            onResolved={resolve}
          />
        ) : expand.kind === 'same_correct' ? (
          <ConvergenceExpansion expand={expand} />
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

// CORRECTION 3 (revised): the opened milestone reads as a cluster with ONE
// playable question. The active (first still-unanswered) question leads —
// directly under the header — as the single focal point and single action.
// Everything already answered drops into a quiet "Answered" history below it,
// so the viewer never scans past settled questions to find the thing they can
// do now. The answered-state is owned by the parent so the line's quiet
// "{answered} of {total}" counter and the triangle mark stay in lockstep.
function MilestoneExpansion({
  expand,
  isResolved,
  resolutions,
  onResolved,
}: {
  expand: Extract<StreamExpand, { kind: 'milestone' }>;
  isResolved: (questionId: string) => boolean;
  resolutions: Map<string, Resolution>;
  onResolved: (questionId: string, submitted: string, isCorrect: boolean) => void;
}) {
  const active = expand.questions.find((q) => !isResolved(q.questionId)) ?? null;
  const answered = expand.questions.filter((q) => isResolved(q.questionId));

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        marginTop: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}
    >
      {active ? (
        <InlineAnswerFlow key={active.questionId} question={active} onResolved={onResolved} />
      ) : null}
      {answered.length > 0 ? (
        <AnsweredHistory questions={answered} resolutions={resolutions} />
      ) : null}
    </div>
  );
}

// The quiet history beneath the active question: each settled question shows a
// descriptive result with what the viewer typed — "Correct - {answer}" in green
// or "Not this time - {answer}" in red — then the original question in a
// lighter, smaller serif. A settled question (right OR wrong) lives here and is
// no longer answerable; the result colors come from the same semantic answer
// tokens the AnswerFeedbackSheet uses.
function AnsweredHistory({
  questions,
  resolutions,
}: {
  questions: StreamQuestion[];
  resolutions: Map<string, Resolution>;
}) {
  return (
    <div>
      <p
        style={{
          margin: 0,
          fontFamily: FM,
          fontSize: 10,
          letterSpacing: 1.5,
          color: INK3,
        }}
      >
        ANSWERED
      </p>
      <div
        style={{
          marginTop: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {questions.map((q) => {
          const r = resolutions.get(q.questionId);
          // No in-session resolution means the server already had it on load as
          // a correct answer; we lack the original text, so we show a calm
          // "Correct" without the answer clause rather than invent one.
          const isCorrect = r ? r.isCorrect : true;
          // Result reads in the app's semantic answer colors: green for correct,
          // red for "not this time" — same tokens the AnswerFeedbackSheet uses.
          const resultColor = isCorrect ? 'var(--game-correct)' : 'var(--game-wrong-strong)';
          return (
            <div key={q.questionId}>
              <p
                style={{
                  margin: 0,
                  fontFamily: FF,
                  fontSize: 12.5,
                  lineHeight: 1.45,
                  letterSpacing: 0.2,
                  fontWeight: 600,
                  color: resultColor,
                }}
              >
                {isCorrect ? 'Correct' : 'Not this time'}
                {r ? ` - ${r.submitted}` : null}
              </p>
              <p
                style={{
                  margin: '3px 0 0',
                  paddingRight: 24,
                  fontFamily: 'Georgia, serif',
                  fontStyle: 'italic',
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: INK3,
                }}
              >
                &ldquo;{q.text}&rdquo;
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Convergence (B-Convergence-1) reveal. READ-ONLY: both people already answered
// these correctly, so it just lists the cluster's questions in the editorial
// serif register — domains appear quietly as texture (never promoted to the
// headline). No Answer, no Send Onward, no reaction affordance.
export function ConvergenceExpansion({
  expand,
}: {
  expand: Extract<StreamExpand, { kind: 'same_correct' }>;
}) {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        marginTop: 12,
        borderLeft: `2px solid ${RULE}`,
        paddingLeft: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {expand.questions.map((q) => (
        <div key={q.questionId}>
          <p
            style={{
              margin: 0,
              fontFamily: 'Georgia, serif',
              fontStyle: 'italic',
              fontSize: 14,
              lineHeight: 1.55,
              color: INK2,
            }}
          >
            &ldquo;{q.text}&rdquo;
          </p>
          {q.domain ? (
            <p
              style={{
                margin: '4px 0 0',
                fontFamily: FM,
                fontSize: 10,
                letterSpacing: 1,
                color: INK3,
              }}
            >
              {q.domain.toUpperCase()}
            </p>
          ) : null}
        </div>
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
