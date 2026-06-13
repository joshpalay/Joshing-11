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
import { ActivityIcon, QuestionTriangle, specForIcon } from './ActivityIcon';
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

export function ActorLink({
  name,
  userId,
  style,
}: {
  name: string;
  userId: string | null;
  // Optional override for surfaces that render the actor in a different voice
  // (e.g. the playable milestone headline, where the name reads in the large
  // Editorial serif rather than the default activity-blue sans link).
  style?: CSSProperties;
}) {
  if (!userId) return <b style={{ fontWeight: 600, color: ACTOR_BLUE, ...style }}>{name}</b>;
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
        ...style,
      }}
    >
      {name}
    </Link>
  );
}

// Strip the leading connective space from a milestone predicate so it reads
// cleanly as its own second line under the name ("went deep on …", not
// " went deep on …").
function trimLeadingPredicate(parts: StreamLinePart[]): StreamLinePart[] {
  const [first, ...rest] = parts;
  if (first && first.t === 'text') {
    return [{ t: 'text', v: first.v.replace(/^\s+/, '') }, ...rest];
  }
  return parts;
}

// The name reads in the large Editorial serif headline voice — still a profile
// link, but dressed as the byline of the milestone sentence rather than the
// default activity-blue sans actor.
const HEADLINE_NAME_STYLE: CSSProperties = {
  fontFamily: 'var(--font-serif)',
  fontWeight: 500,
  fontSize: 22,
  letterSpacing: 0.2,
  color: INK,
  textDecoration: 'none',
};

export function Line({ parts, plain = false }: { parts: StreamLinePart[]; plain?: boolean }) {
  return (
    <>
      {parts.map((part, i) => {
        if (part.t === 'actor') {
          return <ActorLink key={i} name={part.name} userId={part.userId} />;
        }
        if (part.t === 'category') {
          // `plain` (the ambient activity stream): the category stays in the
          // row's own sans face so the one-liner reads in a single voice — only
          // a touch of weight + the secondary ink set it apart from the sentence.
          if (plain) {
            return (
              <span key={i} style={{ fontWeight: 600, color: INK2 }}>
                {part.v}
              </span>
            );
          }
          // Default (editorial surfaces): category names read in the Editorial
          // serif (STYLE-GUIDE-TYPE §5) — warm, in their stored title case
          // ("Shakespearean Tragedy"), a register away from the sans sentence.
          return (
            <span
              key={i}
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: '1.05em',
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
//   - authorName === null  → a non-person LLM-origin question (LLM_QUESTION_ATTRIBUTION)
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
  onQuestionResolved,
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
  // Fires after a milestone question is resolved in place (answered right or
  // wrong). The pending-playables overflow subpage (B-HOME-OVERFLOW-02 §7)
  // uses it to invalidate the client router cache so Home recomputes its
  // served window on return; surfaces that don't care simply omit it.
  onQuestionResolved?: () => void;
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
    onQuestionResolved?.();
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

  // On a playable milestone card the headline splits into two serif lines: the
  // person's NAME (large) and the rest of the sentence (medium) below it. The
  // milestone line is always built as [actor, ...predicate], so peel the leading
  // actor part off here and render the remainder as the second line.
  const headlineActor =
    playableCard && item.line[0]?.t === 'actor' ? item.line[0] : null;
  const headlinePredicate = headlineActor
    ? trimLeadingPredicate(item.line.slice(1))
    : null;
  // The lower-right affordance is a bare verb that tracks the card's state. The
  // friend's name already headlines the card directly above it, so the link
  // doesn't re-state it — it lands on the action instead. "Play" while there are
  // questions left to answer, "Revisit" once they're all answered (opening then
  // only reveals the read-only AnsweredHistory — nothing left to play, only to
  // look back at), and "Close" while the bundle is open (in step with the
  // chevron flipping up).
  const allAnswered =
    !!milestoneProgress && milestoneProgress.answered >= milestoneProgress.total;
  const playAffordanceLabel = open ? 'Close' : allAnswered ? 'Revisit' : 'Play';

  const containerStyle: CSSProperties = nested
    ? // Nested under a per-person heading: no border/fill, light padding.
      { padding: opened ? '6px 0' : '4px 0' }
    : playableCard
      ? {
          padding: opened ? '16px 14px' : '14px',
          // The "From Friends" playable milestone cards share the elevated feed
          // fill token (defaults to the warm game-card cream) so the dev CARD
          // COLOR cycler repaints them alongside the For You cards, and the same
          // neutral hairline stroke as the Today's 5 card (no gold accent).
          background: 'var(--feed-card-elevated)',
          border: '1px solid var(--brand-border)',
          borderRadius: 4,
          boxShadow: '0 4px 12px rgba(40, 32, 30, 0.1)',
        }
      : opened
        ? // Opened reveal: a soft paper wash defines the expanded cluster, with
          // the same very-light hairline below as the flat rows so the stream
          // keeps an even rhythm of dividers whether a row is open or closed.
          {
            padding: '16px 2px',
            background: PAPER,
            borderBottom: `1px solid ${RULE}`,
          }
        : // Calm default: a very-light hairline separates consecutive rows so the
          // one-liners read as a divided list rather than relying on whitespace
          // alone.
          { padding: '14px 2px', borderBottom: `1px solid ${RULE}` };

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
          alignItems: 'flex-start',
          cursor: expandable ? 'pointer' : 'default',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        {playableCard ? (
          // Playable milestone card (home "What's Happening"): an editorial
          // two-line headline — the person's NAME in the large serif, the rest
          // of the sentence in a medium serif below it — with the play
          // affordance in the lower-right corner (replacing the bare chevron).
          <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <ActivityIcon spec={iconSpec} seed={item.id} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <p
                  style={{
                    margin: 0,
                    fontFamily: 'var(--font-serif)',
                    fontSize: 22,
                    lineHeight: 1.15,
                    letterSpacing: 0.2,
                    color: INK,
                  }}
                >
                  {headlineActor ? (
                    <ActorLink
                      name={headlineActor.name}
                      userId={headlineActor.userId}
                      style={HEADLINE_NAME_STYLE}
                    />
                  ) : (
                    <Line parts={item.line} />
                  )}
                </p>
                {headlinePredicate && headlinePredicate.length > 0 ? (
                  <p
                    style={{
                      margin: '3px 0 0',
                      fontFamily: 'var(--font-serif)',
                      fontSize: 16,
                      lineHeight: 1.4,
                      color: INK2,
                    }}
                  >
                    <Line parts={headlinePredicate} />
                  </p>
                ) : null}
                {milestoneProgress ? (
                  <p
                    style={{
                      margin: '8px 0 0',
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
            </div>
            {/* Lower-right play affordance. The whole card is the button
                (aria-expanded on the wrapper), so this is a styled label, not a
                nested button; the disclosure arrow flips as the bundle opens. */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                alignItems: 'center',
                marginTop: 12,
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  // Same text treatment as the "Answer →" feed action: the
                  // Editorial serif at 18px in the link slate, underlined.
                  fontFamily: 'var(--font-serif)',
                  fontSize: 18,
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  color: 'var(--brand-link)',
                  textDecoration: 'underline',
                  textUnderlineOffset: 4,
                }}
              >
                {playAffordanceLabel}
                <ChevronDown
                  size={16}
                  aria-hidden
                  style={{
                    transition: 'transform 150ms ease',
                    transform: open ? 'rotate(180deg)' : 'none',
                  }}
                />
              </span>
            </div>
          </div>
        ) : (
          <>
        {/* Nested rows carry no shape — the per-person heading holds the one
            diamond; everything beneath it is a plain indented line. */}
        {nested ? null : <ActivityIcon spec={iconSpec} seed={item.id} open={opened} />}

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
            {/* `plain` keeps the whole one-liner in the row's sans face — no
                serif category run — so the ambient stream reads in one voice. */}
            <Line parts={item.line} plain />
          </p>
          {item.secondLine ? (
            <p
              style={{
                margin: '2px 0 0',
                // Domain/label metadata stays System mono with the caps +
                // tracking label signature (§2); everything else stays in the
                // row's sans face (no serif), so the stream reads in one voice.
                ...(item.secondLineVoice === 'system'
                  ? {
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      textTransform: 'uppercase' as const,
                      letterSpacing: 1,
                    }
                  : {
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
          {/* No disclosure chevron — the whole row is the button (aria-expanded
              above); the ambient one-liners read clean on the right edge. */}
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
  // Per-question share affordance: the open drawer is keyed by questionId so
  // each quote in the cluster carries its own Send glyph. The category and
  // authorship labels are intentionally omitted here — the headline already
  // names the cluster's domains, so each quote reads clean with just its share.
  const [sendQuestionId, setSendQuestionId] = useState<string | null>(null);
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
        <div
          key={q.questionId}
          style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}
        >
          <p
            style={{
              margin: 0,
              flex: 1,
              minWidth: 0,
              fontFamily: 'var(--font-serif)',
              fontStyle: 'italic',
              fontSize: 14,
              lineHeight: 1.55,
              color: INK2,
            }}
          >
            &ldquo;{q.text}&rdquo;
          </p>
          {/* Quiet, icon-only share affordance per quote — the paper-plane Send
              glyph, matching the homepage share treatment. Opens the same
              SendQuestionDrawer. */}
          <button
            type="button"
            onClick={() => setSendQuestionId(q.questionId)}
            aria-label="Send to a friend"
            style={{
              flexShrink: 0,
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
          <SendQuestionDrawer
            isOpen={sendQuestionId === q.questionId}
            onClose={() => setSendQuestionId(null)}
            question={{
              id: q.questionId,
              text: q.text,
              domain: q.domain ?? '',
            }}
          />
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
