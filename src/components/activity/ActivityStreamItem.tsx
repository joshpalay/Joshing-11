'use client';

import { ChevronDown, Send } from 'lucide-react';
import Link from 'next/link';
import { useState, type CSSProperties, type KeyboardEvent } from 'react';

import { FriendRequestActions } from '@/app/activities/FriendRequestActions';
import { ReactionGotItButton } from '@/app/activities/ReactionGotItButton';
import { SendQuestionDrawer } from '@/components/SendQuestionDrawer';
import type {
  StreamExpand,
  StreamItem,
  StreamLinePart,
  StreamQuestion,
} from '@/lib/activity-stream';

import { DirectQuestionAnswer } from './DirectQuestionAnswer';
import { InlineAnswerFlow } from './InlineAnswerFlow';
import { ActivityIcon, MilestoneStar, QuestionTriangle, specForIcon } from './ActivityIcon';
import { FF, FM, INK, INK2, INK3, PAPER, RULE } from '@/components/lately/tokens';
import { assertNever } from '@/lib/assert-never';
import { HOUSE_AUTHOR, LLM_QUESTION_ATTRIBUTION } from '@/lib/questions-types';

// Friend names render in the activity-blue from Figma (--brand-link #4a5d75),
// linked or not, so the actor reads as the warm social anchor of the row.
const ACTOR_BLUE = 'var(--brand-link)';


// An opened reveal indents to sit UNDER the row's header text, not flush to the
// far-left edge below the icon. This is exactly the ActivityIcon column width —
// MARK_W (24) + GAP (8) — so the expansion's left rule lines up with where the
// actor name / update copy begins, reading as a clear child of the update.
const EXPANSION_INDENT = 32;

export function ActorLink({ name, userId }: { name: string; userId: string | null }) {
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

export function Line({ parts }: { parts: StreamLinePart[] }) {
  return (
    <>
      {parts.map((part, i) => {
        if (part.t === 'actor') {
          return <ActorLink key={i} name={part.name} userId={part.userId} />;
        }
        if (part.t === 'category') {
          // Category names are structured metadata — System voice (mono) with
          // its caps + tracking signature (STYLE-GUIDE-TYPE §2, §5), set a step
          // smaller than the sentence so it reads as a label, not typewriter
          // prose. The sentence around it stays in the sans.
          return (
            <span
              key={i}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.8em',
                textTransform: 'uppercase',
                letterSpacing: 0.8,
                color: INK2,
              }}
            >
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

// D-FEED-GROUP3-01 §4 (honesty, load-bearing): when a row expands to reveal its
// question, a house/LLM-authored question MUST be marked — never rendered as if
// a person wrote it. Returns the marker text, or null when no marker is needed:
//   - authorIsHouse        → the house identity ("Joshing · Editorial")
//   - authorName === null  → a non-person LLM-origin question ("Generated")
//   - human name / undefined → null (the row frame already attributes it; a
//                              human author needs no machine-honesty marker)
function questionProvenance(q: StreamQuestion): string | null {
  if (q.authorIsHouse) return `${HOUSE_AUTHOR.displayName} · ${HOUSE_AUTHOR.label}`;
  if (q.authorName === null) return LLM_QUESTION_ATTRIBUTION;
  return null;
}

function QuestionProvenance({ q, style }: { q: StreamQuestion; style?: CSSProperties }) {
  const label = questionProvenance(q);
  if (!label) return null;
  return (
    <p
      style={{
        margin: '4px 0 0',
        fontFamily: FM,
        fontSize: 10,
        letterSpacing: 1,
        color: INK3,
        ...style,
      }}
    >
      {label.toUpperCase()}
    </p>
  );
}

export function ActivityStreamItem({
  item,
  timestamp,
  nested = false,
  showTimestamp = true,
  elevated = false,
}: {
  item: StreamItem;
  timestamp: string;
  // When nested beneath a per-person heading, the row drops its own shape mark
  // (the heading carries the only shape) and its hairline/padding chrome, so the
  // sub-items read as a quiet indented list under the statement.
  nested?: boolean;
  // The home "What's Happening" feed hides the relative timestamp for a calmer,
  // less ledger-like read; the full /activities log keeps it. Defaults on.
  showTimestamp?: boolean;
  // On the home "What's Happening" feed, the playable milestone bundles (the
  // "X of 5 questions" rows you can answer inline) read as cream cards — a warm
  // fill, a light stroke, and a soft drop shadow — so they step forward off the
  // page as the thing you can play, while the ambient one-liners stay flat. Off
  // by default (the full /activities log keeps every row flat).
  elevated?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const expandable = questionBacked(item.expand);

  // CORRECTION 3 (revised): the answered-of-total state is conveyed by the
  // bundle triangle mark (solid → hollow as questions are answered), so the
  // answered-state is held HERE — not inside the expansion — and ticks up +
  // persists as the viewer answers, even after the result pop-up closes or the
  // line is collapsed and reopened. We also keep each in-session resolution
  // (submitted answer + correctness) here so the expanded "Answered" history can
  // read it back. Milestone lines only.
  const expand = item.expand;
  const milestoneQuestions = expand && expand.kind === 'milestone' ? expand.questions : null;
  // Questions the server already records as attempted on load — right OR wrong.
  // A single attempt is the viewer's only swing in the feed, so any prior
  // result locks the question here. We don't have the original submitted text
  // for these, so the history shows a calm "Correct" / "Not this time" (per the
  // server-recorded result) without the "You answered:" clause for them.
  const [serverAnswered] = useState<Set<string>>(
    () =>
      new Set(
        (milestoneQuestions ?? [])
          .filter((q) => q.priorResult !== null)
          .map((q) => q.questionId),
      ),
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

  // The plain "{answered} of {total} questions" progress label that rides under a
  // milestone line, in lockstep with the bundle triangle mark — so the viewer can
  // read their progress at a glance whether or not the card is open.
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

  // The "invited friend played their first five" star is a celebratory
  // announcement, not a normal left-aligned event row: it renders centered with
  // a star flourish on each side (star — line — star) instead of a single mark
  // in the left icon column. It carries no action/expansion/second line, so the
  // centered branch is a self-contained one-liner. Nested rows keep the plain
  // indented form.
  const centeredStar = !nested && item.icon === 'star';

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
  // more vertical room, a slightly lifted paper fill, and top/bottom hairlines —
  // never a heavy card shadow or loud fill, so the item still sits inside the
  // feed. Horizontal padding stays constant with the collapsed state so the icon
  // and header text don't shift sideways when the card opens.
  const opened = expandable && open;

  // The playable card treatment (home feed only): a milestone bundle is the
  // answer-inline row, so on the home feed it reads as a cream card that steps
  // forward — a warm fill, a light warm-ink stroke, and a soft drop shadow.
  // Matches the FeedCardShell elevated question cards so the two playable
  // surfaces share one "liftable" look. Other activity rows (relationship
  // events, reactions, read-only reveals) stay flat one-liners.
  const playableCard =
    elevated && !nested && expandable && expand?.kind === 'milestone';

  const containerStyle: CSSProperties = nested
    ? // Nested under a per-person heading: no border/fill, light padding.
      { padding: opened ? '6px 0' : '4px 0' }
    : playableCard
      ? {
          padding: opened ? '16px 14px' : '14px',
          background: 'var(--game-card-question)',
          border: '1px solid rgba(40, 32, 30, 0.22)',
          borderRadius: 4,
          boxShadow: '0 4px 12px rgba(40, 32, 30, 0.1)',
        }
      : opened
        ? // Opened reveal: a soft paper wash defines the expanded cluster —
          // no hard hairlines (v2 §4 prefers whitespace over dividers).
          {
            padding: '16px 2px',
            background: PAPER,
          }
        : // Calm default: no row hairline; whitespace separates the rows.
          { padding: '14px 2px' };

  return (
    <div id={item.anchorId ?? undefined} style={containerStyle}>
      <div
        role={expandable ? 'button' : undefined}
        tabIndex={expandable ? 0 : undefined}
        aria-expanded={expandable ? open : undefined}
        onClick={toggle}
        onKeyDown={handleKeyDown}
        style={{
          display: 'flex',
          alignItems: centeredStar ? 'center' : 'flex-start',
          justifyContent: centeredStar ? 'center' : undefined,
          gap: centeredStar ? 10 : undefined,
          cursor: expandable ? 'pointer' : 'default',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        {centeredStar ? (
          // Celebratory announcement: a single star leading the centered line.
          <>
            <MilestoneStar seed={item.id} />
            <p
              style={{
                margin: 0,
                fontSize: 15,
                lineHeight: 1.5,
                letterSpacing: 0.2,
                color: INK,
                textAlign: 'center',
              }}
            >
              <Line parts={item.line} />
            </p>
          </>
        ) : (
          <>
        {/* Nested rows carry no shape — the per-person heading holds the one
            diamond; everything beneath it is a plain indented line. */}
        {nested ? null : <ActivityIcon spec={iconSpec} seed={item.id} />}

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
                // Voice follows content (STYLE-GUIDE-TYPE §5): domain/label
                // metadata is System mono with the caps + tracking label
                // signature (§2); question text / sentences are Editorial serif.
                ...(item.secondLineVoice === 'system'
                  ? {
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      textTransform: 'uppercase' as const,
                      letterSpacing: 1,
                    }
                  : {
                      fontFamily: 'var(--font-serif)',
                      fontSize: 14,
                    }),
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
            alignSelf: 'stretch',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 4,
          }}
        >
          {/* Metadata recedes to near-invisible (v2 §4): quiet, small timestamp.
              Hidden entirely on the home feed (showTimestamp=false). */}
          {showTimestamp ? (
            <span style={{ fontSize: 12, color: INK3, opacity: 0.6, whiteSpace: 'nowrap' }}>
              {timestamp}
            </span>
          ) : null}
          {/* Decorative disclosure chevron — demoted; the row itself is the
              button (aria-expanded above). */}
          {expandable ? (
            <ChevronDown
              size={16}
              aria-hidden
              style={{
                color: INK3,
                opacity: 0.5,
                transition: 'transform 150ms ease',
                transform: open ? 'rotate(180deg)' : 'none',
              }}
            />
          ) : null}
        </div>
          </>
        )}
      </div>

      {item.action ? <ItemAction action={item.action} /> : null}

      {expandable && open && expand ? (
        <div style={{ marginLeft: EXPANSION_INDENT }}>
          {expand.kind === 'milestone' ? (
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
          )}
        </div>
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
            color: 'var(--brand-cream-page)',
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
      ) : action.kind === 'answer_direct' ? (
        <DirectQuestionAnswer action={action} />
      ) : (
        <ReactionGotItButton reactionId={action.reactionId} replied={action.replied} />
      )}
    </div>
  );
}

// The opened milestone reveals EVERY still-unanswered question stacked together,
// each independently playable, so the viewer sees the whole bundle the line
// promised ("{answered} of {total} questions") rather than one question at a
// time. Each settled question (right OR wrong) drops out of the stack and into
// the quiet "Answered" history below, so what remains above is always exactly
// the work left to do. The answered-state is owned by the parent so the bundle
// triangle mark ticks from solid to hollow in lockstep as questions settle.
export function MilestoneExpansion({
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
  const unanswered = expand.questions.filter((q) => !isResolved(q.questionId));
  const answered = expand.questions.filter((q) => isResolved(q.questionId));

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        marginTop: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
      }}
    >
      {unanswered.map((q) => (
        // Solid triangle = still to play. It leads each answerable question so the
        // per-question marks read solid→hollow in step with the bundle mark above.
        <div key={q.questionId} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span style={{ marginTop: 6 }}>
            <QuestionTriangle solid seed={q.questionId} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <InlineAnswerFlow question={q} onResolved={onResolved} />
          </div>
        </div>
      ))}
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
          // No in-session resolution means the server already had this attempt on
          // load; we lack the original text, so we show a calm "Correct" / "Not
          // this time" from the server-recorded result without inventing an
          // answer clause. priorResult is non-null here (it's why the question
          // sits in this answered list); treat anything but 'incorrect' as right.
          const isCorrect = r ? r.isCorrect : q.priorResult !== 'incorrect';
          // Result reads in the app's semantic answer colors: green for correct,
          // red for "not this time" — same tokens the AnswerFeedbackSheet uses.
          const resultColor = isCorrect ? 'var(--game-correct)' : 'var(--game-wrong-strong)';
          return (
            // Hollow triangle = already answered (spent), matching the bundle
            // mark's hollow state, so the viewer sees which ones they've done.
            <div key={q.questionId} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ marginTop: 4 }}>
                <QuestionTriangle solid={false} seed={q.questionId} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
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
                    fontFamily: 'var(--font-serif)',
                    fontStyle: 'italic',
                    fontSize: 13,
                    lineHeight: 1.5,
                    color: INK3,
                  }}
                >
                  &ldquo;{q.text}&rdquo;
                </p>
              </div>
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
              fontFamily: 'var(--font-serif)',
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
          {/* Honest authorship (§4): mark a house/LLM question even in the
              read-only convergence reveal. */}
          <QuestionProvenance q={q} />
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
          margin: '0 0 4px',
          fontFamily: 'var(--font-serif)',
          fontStyle: 'italic',
          fontSize: 14,
          lineHeight: 1.55,
          color: INK2,
        }}
      >
        &ldquo;{question.text}&rdquo;
      </p>
      {/* Honest authorship (§4): house/LLM questions are marked so the reveal
          never implies a person wrote machine content. */}
      <QuestionProvenance q={question} style={{ margin: '0 0 12px' }} />

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        {/* Quiet, icon-only share affordance — no oversized labeled button.
            Send (paper plane) is the homepage's share glyph by request; the
            knowledge surfaces still use Share2. Opens the same SendQuestionDrawer. */}
        <button
          type="button"
          onClick={() => setSendOpen(true)}
          aria-label="Send to a friend"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            padding: 4,
            color: INK,
            cursor: 'pointer',
          }}
        >
          <Send size={15} strokeWidth={1.8} aria-hidden="true" />
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
