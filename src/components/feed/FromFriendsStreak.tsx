'use client';

import { useState } from 'react';

import {
  ActorLink,
  Line,
  QuestionProvenance,
  questionProvenance,
} from '@/components/activity/stream-card-helpers';
import { useMilestoneAnswer } from '@/components/activity/use-milestone-answer';
import { FF, FM, FS, INK, INK2, INK3 } from '@/components/lately/tokens';
import type { StreamItem, StreamQuestion } from '@/lib/activity-stream';

import { colorForCategory } from './visual';
import { FeedActionLink } from './FeedActionLink';
import { FeedDismissButton } from './FeedDismissButton';
import { useStreakResolutions, type StreakResolution } from './use-streak-resolutions';

// All color comes from existing tokens — no new hues. The mark uses the named
// teal (--tri-darkteal) the directed card already carries; the category swatch
// pulls from the established category-color system (colorForCategory → the
// --cat-* / portrait scale the feed already uses), so no hex is hand-picked here.
const TEAL = 'var(--tri-darkteal)';

// The card stack indents under the streak header so the cards read as children
// of it. Aligns the cards' left edge with the header TEXT (past the header's
// hourglass mark + gap), the way an expansion sits under its row.
const CARD_INDENT = 20;

// B-FROMFRIENDS-STREAK-HEADER-01 — bundle-as-header, cards-as-children.
//
// A friend's milestone streak renders as a lightweight section HEADER (the
// streak line, once) followed by one ANSWER/DISMISS card per question. Each card
// leads with the question's category (swatch + label), carries honest authorship
// provenance pre-answer, and settles in place — answered cards dim to a calm
// spent state, dismissed cards collapse to an undo bar — never removed.
//
// Decisions (DECISIONS.md, do not re-litigate):
//   D-A  header + per-question cards.
//   D-C  single-question bundles get NO header; the card carries a compact
//        "via {friend}'s streak" line instead. Header renders only at size ≥ 2.
//   D-D  each card renders honest human/house provenance PRE-answer; no generic
//        "A friend" fallback for machine content.
// The budget/server layer is untouched: whole streaks only, never split.
export function FromFriendsStreak({
  item,
  elevated = false,
  onQuestionResolved,
}: {
  item: StreamItem;
  elevated?: boolean;
  // Fires after a card is answered in place. The /from-friends overflow subpage
  // (B-HOME-OVERFLOW-02 §7) uses it to refresh the router cache so Home recomputes
  // its served window on return; Home itself omits it.
  onQuestionResolved?: () => void;
}) {
  const expand = item.expand;
  const questions = expand && expand.kind === 'milestone' ? expand.questions : [];
  // The shared per-card answered-state (Phase 2): one resolution set for the
  // whole streak, so answering one card resolves only that card and persists
  // across the result-sheet close + re-render. Called unconditionally to keep
  // the hook order stable; the early return below guards the render.
  const { isResolved, resolve, resolutions } = useStreakResolutions(questions, onQuestionResolved);

  if (!expand || expand.kind !== 'milestone' || questions.length === 0) return null;

  // New paradigm: a question the viewer has gotten CORRECT drops out of the
  // streak entirely (server-prior or in-session) — "I got it, I don't need to
  // see it again." A miss stays as a spent card; an unanswered one stays
  // answerable. When nothing's left to show, the whole streak (header included)
  // disappears.
  const answeredCorrect = (q: StreamQuestion): boolean => {
    const r = resolutions.get(q.questionId);
    return r ? r.isCorrect : q.priorResult === 'correct';
  };
  const visible = questions.filter((q) => !answeredCorrect(q));
  if (visible.length === 0) return null;

  // D-C: a streak whose ORIGINAL bundle holds ≥2 questions gets the header; a
  // lone-question bundle stands alone with the compact "via {friend}'s streak"
  // line instead. Keyed on the original size so the header doesn't flip to the
  // via-line mid-session as questions resolve away.
  const showHeader = questions.length >= 2;

  const cards = visible.map((q) => (
    <StreakQuestionCard
      key={q.questionId}
      question={q}
      friendName={expand.friendName}
      friendId={expand.friendId}
      showViaLine={!showHeader}
      elevated={elevated}
      resolved={isResolved(q.questionId)}
      resolution={resolutions.get(q.questionId) ?? null}
      onResolved={resolve}
    />
  ));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {showHeader ? <StreakHeader item={item} /> : null}
      {/* Indent the card stack under the header so the cards read as its
          children (request: "look like they're under the Jaime heading"). */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          marginLeft: showHeader ? CARD_INDENT : 0,
        }}
      >
        {cards}
      </div>
    </div>
  );
}

// A simple outline hourglass mark, single-color so it can take the named teal.
// (The app's ActivityIcon hourglass is the fixed two-tone triangle pair; this is
// the quiet inline mark the streak header / via line want.)
function Hourglass({ color = TEAL }: { color?: string }) {
  return (
    <span style={{ display: 'inline-flex', width: 13, height: 13, flex: '0 0 auto' }} aria-hidden>
      <svg
        viewBox="0 0 24 24"
        width="13"
        height="13"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 2h12M6 22h12M6 2c0 4 4 6 6 8 2-2 6-4 6-8M6 22c0-4 4-6 6-8 2 2 6 4 6 8" />
      </svg>
    </span>
  );
}

// The streak line as a lightweight header — the friend + the rolled-up domains
// the builder already composed (e.g. "Joshua P has been on a tear through Tennis
// Fundamentals, …"). Sans (Interface voice); it stands alone above the cards
// rather than introducing a Play affordance.
function StreakHeader({ item }: { item: StreamItem }) {
  return (
    <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '6px 2px 2px' }}>
      <span style={{ marginTop: 3 }}>
        <Hourglass />
      </span>
      <p style={{ fontFamily: FF, fontSize: 14, lineHeight: 1.45, color: INK2, margin: 0 }}>
        {/* `plain` keeps the whole line in the sans face — the friend reads as a
            link (ActorLink), the domains as quiet weight, no serif run. */}
        <Line parts={item.line} plain />
      </p>
    </div>
  );
}

// The category eyebrow: a swatch in the question's category hue (from the
// existing category-color system) + the label. Color is never the sole carrier —
// the text label always sits beside the swatch.
function CategoryLabel({ category }: { category: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: 2,
          background: colorForCategory(category),
          flex: '0 0 auto',
        }}
      />
      <span
        style={{
          fontFamily: FM,
          fontSize: 10,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          fontWeight: 600,
          color: INK3,
        }}
      >
        {category}
      </span>
    </span>
  );
}

// One question in the streak. Active: the elevated card with Answer/Dismiss.
// Answered: the same card dimmed to a calm spent state with its graded result.
// Dismissed: a compact undo bar (view-state only; passing never hits the server).
function StreakQuestionCard({
  question,
  friendName,
  friendId,
  showViaLine,
  elevated,
  resolved,
  resolution,
  onResolved,
}: {
  question: StreamQuestion;
  friendName: string;
  friendId: string | null;
  showViaLine: boolean;
  elevated: boolean;
  resolved: boolean;
  resolution: StreakResolution | null;
  onResolved: (questionId: string, submitted: string, isCorrect: boolean) => void;
}) {
  // The same milestone answer/grade flow the inline list row uses; the card's
  // Answer button just opens it.
  const answer = useMilestoneAnswer(question, onResolved);
  // Dismiss is view-state only ("pass"): collapse the card to an undo bar.
  const [passed, setPassed] = useState(false);

  const category = question.domain?.trim() || null;
  const hasProvenance = questionProvenance(question) !== null;

  if (passed && !resolved) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          fontFamily: FF,
          fontSize: 13,
          color: INK3,
        }}
      >
        <span>Dismissed{category ? ` · ${category}` : ''}</span>
        <FeedActionLink size="sm" onClick={() => setPassed(false)}>
          Undo
        </FeedActionLink>
      </div>
    );
  }

  const spent = resolved;

  return (
    <>
      <div
        style={{
          background: elevated ? 'var(--feed-card-elevated)' : 'var(--warm-cream)',
          border: '1px solid var(--brand-border)',
          borderRadius: 12,
          boxShadow: 'var(--shadow-card)',
          padding: '16px 18px 14px',
          opacity: spent ? 0.72 : 1,
        }}
      >
        {showViaLine ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
            <Hourglass />
            <span style={{ fontFamily: FF, fontSize: 12.5, color: INK2 }}>
              via <ActorLink name={friendName} userId={friendId} />
              &rsquo;s streak
            </span>
          </div>
        ) : null}

        {/* Category eyebrow with the authorship marker on the SAME row (right-
            aligned) to save vertical space. D-D (canon): house/LLM authorship is
            marked PRE-answer; human shows nothing, never a generic "A friend". */}
        {category || hasProvenance ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              marginBottom: 10,
            }}
          >
            {category ? <CategoryLabel category={category} /> : <span />}
            {hasProvenance ? <QuestionProvenance q={question} style={{ margin: 0 }} /> : null}
          </div>
        ) : null}

        <p
          style={{
            fontFamily: FS,
            fontSize: 21,
            lineHeight: 1.28,
            fontWeight: 500,
            color: INK,
            margin: '0 0 14px',
          }}
        >
          &ldquo;{question.text}&rdquo;
        </p>

        {spent ? (
          <SpentResult resolution={resolution} priorResult={question.priorResult} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <FeedDismissButton onClick={() => setPassed(true)} />
            <button type="button" className="btn-primary" onClick={answer.open}>
              Answer
            </button>
          </div>
        )}
      </div>
      {spent ? null : answer.sheets}
    </>
  );
}

// The graded result on a settled card, in the existing semantic answer tokens
// (the same registers the AnsweredHistory uses): correct reads green, a miss
// reads in the calm brick red. priorResult is non-null when the server already
// had the attempt on load (no submitted text then); an in-session resolution
// carries both.
function SpentResult({
  resolution,
  priorResult,
}: {
  resolution: StreakResolution | null;
  priorResult: StreamQuestion['priorResult'];
}) {
  const isCorrect = resolution ? resolution.isCorrect : priorResult !== 'incorrect';
  return (
    <div
      style={{
        fontFamily: FF,
        fontSize: 13,
        fontWeight: 600,
        color: isCorrect ? 'var(--game-correct)' : 'var(--game-wrong)',
      }}
    >
      {isCorrect ? '✓ Correct' : 'Not this time'}
      {resolution ? ` · ${resolution.submitted}` : ''}
    </div>
  );
}
