'use client';

import { Send } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { SendQuestionDrawer } from '@/components/SendQuestionDrawer';
import { AnsweredRowActions } from '@/components/questions/AnsweredRowActions';
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
  headerless = false,
  onQuestionResolved,
}: {
  item: StreamItem;
  elevated?: boolean;
  // On the streak's own page (B-FROMFRIENDS-STREAK-PAGE-01) the page header
  // already names the friend + categories, so the cards render BARE: no internal
  // streak header, no per-card "via {friend}'s streak" line, no indent.
  headerless?: boolean;
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

  // A question the viewer has already answered STAYS in the streak as a settled
  // card: correct reads "✓ Correct", a miss reads "Not this time", and either way
  // the card offers a "Send onward" affordance so the viewer can forward it to
  // someone else (request 2026-06-22). This replaces the earlier treatment that
  // dropped answered-correct questions out of the streak entirely — the viewer
  // wanted to SEE what they got right and be able to pass it on, not have it
  // vanish silently. Server-side exhaustion is unchanged: a bundle with no
  // still-answerable questions never reaches the client (build-stream keeps only
  // bundles whose remaining-unanswered count is > 0), so a fully-played streak
  // still disappears on the next load — it just no longer disappears mid-session
  // the instant its last question is answered.

  // D-C: a streak whose ORIGINAL bundle holds ≥2 questions gets the header; a
  // lone-question bundle stands alone with the compact "via {friend}'s streak"
  // line instead. Keyed on the original size so the header doesn't flip to the
  // via-line mid-session as questions resolve away.
  const showHeader = !headerless && questions.length >= 2;
  // The per-card "via {friend}'s streak" line stands in for the header on a
  // single-question bundle — but never in headerless (page) mode, where the page
  // header carries attribution for the whole streak.
  const showViaLine = !headerless && !showHeader;

  const cards = questions.map((q) => (
    <StreakQuestionCard
      key={q.questionId}
      question={q}
      friendName={expand.friendName}
      friendId={expand.friendId}
      showViaLine={showViaLine}
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

// The card's recurring "two-ends" row: a left node and a right node pushed to
// opposite edges. The card uses this shape three times — category ↔ report menu,
// graded result ↔ "Send onward", and Dismiss ↔ Answer — so the flex/space-between
// wrapper lives here once rather than being hand-rolled at each call site.
function CardRow({
  left,
  right,
  gap = 0,
  marginBottom = 0,
}: {
  left: ReactNode;
  right: ReactNode;
  gap?: number;
  marginBottom?: number;
}) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap, marginBottom }}
    >
      {left}
      {right}
    </div>
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
  // Forwarding a settled question: the "Send onward" affordance opens the same
  // SendQuestionDrawer the convergence / your-question reveals use.
  const [sendOpen, setSendOpen] = useState(false);

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

        {/* Top row: the category eyebrow (left) and the ⋯ report menu pinned to
            the upper-right corner — the entry point to flag this question as
            incorrect or inappropriate. The authorship marker no longer rides this
            row; it drops to its own second line below so the corner is free for
            the report affordance. */}
        <CardRow
          gap={8}
          marginBottom={hasProvenance ? 4 : 10}
          left={category ? <CategoryLabel category={category} /> : <span />}
          right={
            <AnsweredRowActions target={{ questionId: question.questionId }} surface="lately_result" />
          }
        />
        {/* Second level: honest authorship (D-D canon: house/LLM marked
            PRE-answer; a human author shows nothing, never a generic "A friend"). */}
        {hasProvenance ? (
          <div style={{ marginBottom: question.via ? 4 : 10 }}>
            <QuestionProvenance q={question} style={{ margin: 0 }} />
          </div>
        ) : null}

        {/* D-4 via-attribution: the relay source — who the answering friend got
            this question from ("via Josh"). Orthogonal to authorship above: an
            LLM-authored question relayed by a friend shows both. */}
        {question.via ? (
          <p style={{ margin: '0 0 10px', fontFamily: FF, fontSize: 12.5, color: INK2 }}>
            via <ActorLink name={question.via.name} userId={question.via.userId} />
          </p>
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
          // Settled: show the graded result, and offer forwarding the question
          // onward to someone else (the viewer answered it, so it's no longer
          // theirs to answer — but it's still theirs to pass on).
          <CardRow
            gap={12}
            left={<SpentResult resolution={resolution} priorResult={question.priorResult} />}
            right={
              <FeedActionLink
                size="sm"
                className="no-underline"
                onClick={() => setSendOpen(true)}
                aria-label="Send onward"
                title="Send onward"
              >
                <Send className="size-4" aria-hidden="true" />
              </FeedActionLink>
            }
          />
        ) : (
          <CardRow
            left={<FeedDismissButton onClick={() => setPassed(true)} />}
            right={
              <button type="button" className="btn-primary" onClick={answer.open}>
                Answer
              </button>
            }
          />
        )}
      </div>
      {spent ? null : answer.sheets}
      <SendQuestionDrawer
        isOpen={sendOpen}
        onClose={() => setSendOpen(false)}
        question={{ id: question.questionId, text: question.text, domain: question.domain ?? '' }}
      />
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
