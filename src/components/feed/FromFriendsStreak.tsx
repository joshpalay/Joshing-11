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
  onQuestionReopened,
}: {
  item: StreamItem;
  elevated?: boolean;
  // On the streak's own page (B-FROMFRIENDS-STREAK-PAGE-01) the page header
  // already names the friend + categories, so the cards render BARE: no internal
  // streak header, no per-card "via {friend}'s streak" line, no indent.
  headerless?: boolean;
  // Fires after a card is CONSUMED in place — answered OR dismissed. The parent
  // bundle ticks its "N of M" progress and drops the whole card once nothing is
  // answerable; the /from-friends overflow subpage (B-HOME-OVERFLOW-02 §7) also
  // refreshes the router cache so Home recomputes its served window on return.
  onQuestionResolved?: () => void;
  // Fires when a dismiss is UNDONE, so the parent un-ticks that same progress.
  onQuestionReopened?: () => void;
}) {
  const expand = item.expand;
  const questions = expand && expand.kind === 'milestone' ? expand.questions : [];
  // The shared per-card answered/dismissed-state (Phase 2): one resolution set
  // for the whole streak, so acting on one card resolves only that card and
  // persists across the result-sheet close + re-render. Called unconditionally to
  // keep the hook order stable; the early return below guards the render.
  const { isResolved, resolve, resolutions, isDismissed, dismiss, undismiss, isConsumed } =
    useStreakResolutions(questions, onQuestionResolved, onQuestionReopened);

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

  // Unanswered-first ordering (request 2026-06-27): CONSUMED cards — answered OR
  // dismissed — sink to the bottom of the streak so the questions still to play
  // float to the top. The primary job here is acting on what's left, so the
  // actionable cards lead and the dimmed spent / dismissed cards cluster below as
  // a scannable group. A stable partition preserves the server's original order
  // WITHIN each group, so a card simply drops past the remaining ones the moment
  // it resolves rather than reshuffling. Server-consumed questions (answered or
  // dismissed on load) partition the same way, so a half-played streak opens
  // already grouped.
  const ordered = [
    ...questions.filter((q) => !isConsumed(q.questionId)),
    ...questions.filter((q) => isConsumed(q.questionId)),
  ];

  const cards = ordered.map((q) => (
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
      dismissed={isDismissed(q.questionId)}
      onDismiss={dismiss}
      onUndismiss={undismiss}
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
  dismissed,
  onDismiss,
  onUndismiss,
}: {
  question: StreamQuestion;
  friendName: string;
  friendId: string | null;
  showViaLine: boolean;
  elevated: boolean;
  resolved: boolean;
  resolution: StreakResolution | null;
  onResolved: (questionId: string, submitted: string, isCorrect: boolean) => void;
  // Dismiss-as-answered: the parent owns the dismissed set (so it can tick the
  // bundle progress and drop the card once nothing is answerable). The card
  // reports the click and persists it; the parent flips the state.
  dismissed: boolean;
  onDismiss: (questionId: string) => void;
  onUndismiss: (questionId: string) => void;
}) {
  // The same milestone answer/grade flow the inline list row uses; the card's
  // Answer button just opens it.
  const answer = useMilestoneAnswer(question, onResolved);

  // Dismiss "acts as if answered": it CONSUMES the question (ticks the bundle
  // progress, and empties → removes the whole card) and PERSISTS per-viewer so it
  // never returns on reload — but NEUTRALLY, via a dedicated route that writes no
  // mastery/points (unlike "View Answer" below, which persists a give-up miss).
  // The parent-owned `dismissed` flag drives the collapsed undo bar; the flip is
  // optimistic and reverts if the write fails.
  function handleDismiss() {
    onDismiss(question.questionId);
    void fetch('/api/lately/milestone/dismiss', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ questionId: question.questionId }),
    })
      .then((res) => {
        if (!res.ok) onUndismiss(question.questionId);
      })
      .catch(() => onUndismiss(question.questionId));
  }

  function handleUndo() {
    onUndismiss(question.questionId);
    void fetch('/api/lately/milestone/dismiss', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ questionId: question.questionId }),
    })
      .then((res) => {
        if (!res.ok) onDismiss(question.questionId);
      })
      .catch(() => onDismiss(question.questionId));
  }
  // "View Answer" — reveal the correct answer inline. Seeing it consumes the
  // question exactly like the Daily Five's "Show me the answer": it PERSISTS as a
  // give-up (a miss with no points, no catch-up second swing) via the milestone
  // answer route, so on reload the card comes back settled — never answerable
  // again. The same POST returns the answer we show inline. The card is consumed
  // only on a successful give-up; an error leaves it answerable so the viewer can
  // retry or just answer it.
  const [revealed, setRevealed] = useState<
    { status: 'loading' | 'loaded' | 'error'; answer?: string | null } | null
  >(null);
  const consumed = revealed !== null && revealed.status !== 'error';

  function revealAnswer() {
    if (revealed && revealed.status !== 'error') return;
    setRevealed({ status: 'loading' });
    void (async () => {
      try {
        const res = await fetch('/api/lately/milestone/answer', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ questionId: question.questionId, gave_up: true }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { correctAnswer?: string | null };
        setRevealed({ status: 'loaded', answer: data.correctAnswer ?? null });
      } catch {
        setRevealed({ status: 'error' });
      }
    })();
  }
  // Forwarding a settled question: the "Send onward" affordance opens the same
  // SendQuestionDrawer the convergence / your-question reveals use.
  const [sendOpen, setSendOpen] = useState(false);

  const category = question.domain?.trim() || null;
  const hasProvenance = questionProvenance(question) !== null;

  if (dismissed) {
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
        <FeedActionLink size="sm" onClick={handleUndo}>
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

        {spent ? (
          // Settled: the graded verdict LEADS the card — "✓ Correct" / "Not this
          // time" sits above the question so it's the first thing you scan down a
          // column of answered cards (request 2026-06-27). The "Send onward"
          // affordance rides the same row: the viewer answered it, so it's no
          // longer theirs to answer — but it's still theirs to pass on.
          <CardRow
            gap={12}
            marginBottom={10}
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
        ) : null}

        <p
          style={{
            fontFamily: FS,
            fontSize: 21,
            lineHeight: 1.28,
            fontWeight: 500,
            color: INK,
            // The question no longer closes a spent card — the answer read-back
            // follows it (2026-08-06) — so it keeps a trailing margin only when
            // an actions row follows. The answer blocks own their top spacing.
            margin: spent || revealed ? 0 : '0 0 14px',
          }}
        >
          &ldquo;{question.text}&rdquo;
        </p>

        {/* Answer AFTER the question, both for the settled read-back and for the
            live "View Answer" peek — reversing the 2026-07-12 layout in which
            the answer preceded the question it answered. */}
        {spent ? (
          <SettledAnswers
            resolution={resolution}
            correctAnswer={question.correctAnswer}
            isCorrect={resolution ? resolution.isCorrect : question.priorResult !== 'incorrect'}
          />
        ) : revealed ? (
          <div style={{ marginTop: 12 }}>
            <RevealedAnswer state={revealed} />
          </div>
        ) : null}

        {spent ? null : (
          <>
            <CardRow
              left={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <FeedDismissButton onClick={handleDismiss} />
                  {/* Once the answer is seen the card is consumed, so the peek
                      link drops away with the Answer button. An errored reveal
                      keeps the link so the viewer can retry. */}
                  {consumed ? null : (
                    <>
                      <span aria-hidden style={{ color: INK3, fontSize: 14 }}>
                        |
                      </span>
                      <FeedActionLink size="sm" onClick={revealAnswer}>
                        View Answer
                      </FeedActionLink>
                    </>
                  )}
                </span>
              }
              right={
                consumed ? (
                  <span />
                ) : (
                  <button type="button" className="btn-primary" onClick={answer.open}>
                    Answer
                  </button>
                )
              }
            />
          </>
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

// The inline "View Answer" reveal on an unanswered streak card — the serif,
// dimmed-ink answer line, carrying the on-demand fetch's loading/error states.
// Mirrors the feed's RevealedAnswerLine so the peek reads the same everywhere.
function RevealedAnswer({
  state,
}: {
  state: { status: 'loading' | 'loaded' | 'error'; answer?: string | null };
}) {
  if (state.status === 'loading') {
    return (
      <span style={{ fontFamily: FF, fontSize: 13, fontStyle: 'italic', color: INK3 }}>
        Revealing answer…
      </span>
    );
  }
  if (state.status === 'error') {
    return (
      <span style={{ fontFamily: FF, fontSize: 13, fontStyle: 'italic', color: INK3 }}>
        Answer unavailable
      </span>
    );
  }
  if (!state.answer) {
    return (
      <span style={{ fontFamily: FF, fontSize: 13, fontStyle: 'italic', color: INK3 }}>
        No answer available
      </span>
    );
  }
  return (
    <p
      style={{
        margin: 0,
        fontFamily: FS,
        fontSize: 15,
        fontStyle: 'italic',
        color: INK,
        opacity: 0.72,
      }}
    >
      Answer: {state.answer}
    </p>
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
      {isCorrect ? 'Answered correctly' : 'Not this time'}
    </div>
  );
}

// The settled card's answer read-back, sitting UNDER the question (2026-08-06
// request, reversing the 2026-07-12 "verdict always leads" layout): the verdict
// keeps its slot above and states only the outcome, while the answers read in
// question-then-answer order below it.
//
// Both lines are independently optional and the asymmetry is a DATA fact, not a
// style choice: `submitted` exists only for a question answered in THIS session
// (it lives in the in-memory StreakResolution), because MASTERY_EVENTS has no
// submitted-answer column — a card restored from priorResult can never show
// what the viewer typed, and no query can recover it. `correctAnswer` arrives
// on the stream payload for settled questions only. So a same-session card
// shows both lines and a prior-session card shows just the answer.
function SettledAnswers({
  resolution,
  correctAnswer,
  isCorrect,
}: {
  resolution: StreakResolution | null;
  correctAnswer: string | null | undefined;
  isCorrect: boolean;
}) {
  // Don't restate the answer twice on a correct card — the submitted string IS
  // the answer there, so the "You said" line alone carries it.
  const showCorrect = Boolean(correctAnswer) && !(isCorrect && resolution);
  if (!resolution && !showCorrect) return null;
  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {resolution ? (
        <AnswerLine
          label="You said"
          value={resolution.submitted}
          color={isCorrect ? 'var(--game-correct)' : 'var(--game-wrong)'}
        />
      ) : null}
      {showCorrect ? <AnswerLine label="Answer" value={correctAnswer!} color={INK2} /> : null}
    </div>
  );
}

function AnswerLine({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <p style={{ margin: 0 }}>
      <span
        style={{
          display: 'block',
          fontFamily: FM,
          fontSize: 10,
          letterSpacing: '0.11em',
          textTransform: 'uppercase',
          fontWeight: 600,
          color: INK3,
          marginBottom: 3,
        }}
      >
        {label}
      </span>
      <span style={{ fontFamily: FS, fontSize: 17, lineHeight: 1.3, color }}>{value}</span>
    </p>
  );
}
