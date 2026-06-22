'use client';

import { useState } from 'react';
import Link from 'next/link';

import { QuestionTriangle } from '@/components/activity/ActivityIcon';
import {
  Line,
  QuestionProvenance,
  questionProvenance,
} from '@/components/activity/stream-card-helpers';
import { useMilestoneAnswer } from '@/components/activity/use-milestone-answer';
import { FS, INK, INK3 } from '@/components/lately/tokens';
import type { StreamItem, StreamQuestion } from '@/lib/activity-stream';

import { SparkleEnvelope } from './SparkleEnvelope';
import { useStreakResolutions, type StreakResolution } from './use-streak-resolutions';

// B-FROMFRIENDS-STREAK-HEADER-01 — bundle-as-header, cards-as-children.
//
// The From Friends zone used to collapse a friend's milestone streak into ONE
// one-liner ("X of 5 questions" + a single Play that expanded inline). This
// renders the same StreamItem as a lightweight section HEADER (the friend's
// streak line, once) followed by one ANSWER/DISMISS card per question, in the
// exact `DirectSentCard` register — one card language for "answer or pass",
// whether a question was sent directly or surfaced through a friend's streak.
//
// Decisions this builds to (DECISIONS.md, do not re-litigate):
//   D-A  header + per-question cards in the DirectSentCard register.
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

  // D-C: ≥2 questions get the streak header; a lone question stands alone and
  // carries the compact "via {friend}'s streak" line on its card instead.
  const showHeader = questions.length >= 2;

  return (
    <div className="space-y-3">
      {showHeader ? <StreakHeader item={item} /> : null}
      {questions.map((q) => (
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
      ))}
    </div>
  );
}

// The streak line as a lightweight editorial header — the friend's name + the
// rolled-up domains the builder already composed (e.g. "Joshua P has been on a
// tear through Tennis Fundamentals, Early 20th Century American History and 3
// others"). It stands alone above the cards rather than introducing a Play
// affordance. The triangle answered-state is owned per-card, not here.
function StreakHeader({ item }: { item: StreamItem }) {
  return (
    <p
      style={{
        margin: 0,
        fontFamily: FS,
        fontSize: 18,
        lineHeight: 1.4,
        letterSpacing: 0.2,
        color: INK,
      }}
    >
      <Line parts={item.line} />
    </p>
  );
}

// One answerable question, rendered as a DirectSentCard-register card: the
// bordered SparkleEnvelope frame, an Answer primary button, and a Dismiss link.
// Once answered or dismissed it reads as a calm spent card (not removed).
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
  // Answer button just opens it. Hook is called unconditionally (the spent
  // branch below still mounts the component).
  const answer = useMilestoneAnswer(question, onResolved);
  // Dismiss is view-state only ("pass"): mark the card spent locally, matching
  // the directed card's Dismiss. No milestone has a server "pass" — passing is
  // simply declining to play, and the card stays as a spent (passed) tile.
  const [passed, setPassed] = useState(false);

  if (resolved || passed) {
    return (
      <SpentStreakCard
        question={question}
        resolution={resolution}
        passed={passed && !resolved}
        elevated={elevated}
      />
    );
  }

  // The per-card mark: a solid triangle leads the signal row (unplayed),
  // flipping to hollow on the spent card — preserving the solid→hollow
  // answered-state the bundle line used to carry, now once per card.
  const signal = (
    <span className="inline-flex items-center gap-2">
      <QuestionTriangle solid seed={question.questionId} />
      {showViaLine ? (
        <span>
          via{' '}
          {friendId ? (
            <Link
              href={`/users/${friendId}`}
              className="font-semibold text-[var(--brand-link)] hover:opacity-70"
            >
              {friendName}
            </Link>
          ) : (
            <span className="font-semibold text-[var(--brand-link)]">{friendName}</span>
          )}
          &rsquo;s streak
        </span>
      ) : null}
    </span>
  );

  // D-D (canon): honest provenance PRE-answer — house/LLM marked, human shows
  // nothing (the streak already attributes the answerer; authorship is a
  // separate fact and only the machine cases need a marker). Rendered above the
  // Answer action, exactly as the send-onward path does. Only passed when there
  // is a real marker, so a human-authored card never renders an empty slot — and
  // never the generic "A friend" string.
  const viaAttribution = questionProvenance(question) ? (
    <QuestionProvenance q={question} style={{ margin: 0 }} />
  ) : undefined;

  return (
    <>
      <SparkleEnvelope
        variant="bordered"
        signal={signal}
        question={question.text}
        onAnswer={answer.open}
        answerAsButton
        onDismiss={() => setPassed(true)}
        viaAttribution={viaAttribution}
        elevated={elevated}
      />
      {answer.sheets}
    </>
  );
}

// The calm spent treatment for a settled card (matching AnsweredByYouCard's
// register): the bordered frame at reduced emphasis, a hollow triangle, and a
// quiet result line — "Correct" / "Not this time" (in the semantic answer
// colors) or "Passed" for a dismissed card. The card stays in place, spent, not
// removed (Phase 2).
function SpentStreakCard({
  question,
  resolution,
  passed,
  elevated,
}: {
  question: StreamQuestion;
  resolution: StreakResolution | null;
  passed: boolean;
  elevated: boolean;
}) {
  // priorResult is non-null when the server already had this attempt on load (we
  // lack the submitted text then); an in-session resolution carries both.
  const isCorrect = resolution ? resolution.isCorrect : question.priorResult !== 'incorrect';
  const label = passed ? 'Passed' : isCorrect ? 'Correct' : 'Not this time';
  const color = passed ? INK3 : isCorrect ? 'var(--game-correct)' : 'var(--game-wrong)';

  const signal = (
    <span className="inline-flex items-center gap-2 font-semibold" style={{ color }}>
      <QuestionTriangle solid={false} seed={question.questionId} />
      <span>
        {label}
        {resolution ? ` — ${resolution.submitted}` : ''}
      </span>
    </span>
  );

  return (
    <div style={{ opacity: 0.7 }}>
      <SparkleEnvelope
        variant="bordered"
        signal={signal}
        question={question.text}
        elevated={elevated}
      />
    </div>
  );
}
