import { useState } from 'react';

import type { StreamQuestion } from '@/lib/activity-stream';

// One in-session answer to a streak question: what the viewer typed and whether
// it was scored correct. Drives the per-card spent treatment's result line.
export type StreakResolution = { submitted: string; isCorrect: boolean };

export type StreakResolutions = {
  /** Settled (answered right OR wrong) — no longer answerable this session. */
  isResolved: (questionId: string) => boolean;
  /** Record an in-session answer; locks the question and ticks the count. */
  resolve: (questionId: string, submitted: string, isCorrect: boolean) => void;
  /** Per-question submitted answer + correctness, for the spent card's read-back. */
  resolutions: Map<string, StreakResolution>;
  /** How many of the streak's questions are settled (server-prior + in-session). */
  answeredCount: number;
  /**
   * Dismissed (dismiss-as-answered) — the viewer waved the question off. It is
   * CONSUMED like an answer (see isConsumed) but NEUTRAL: it is not a wrong
   * answer and drives the quiet "Dismissed" undo bar, not the spent result card.
   */
  isDismissed: (questionId: string) => boolean;
  /** Record an in-session dismiss; consumes the question and ticks the count. */
  dismiss: (questionId: string) => void;
  /** Undo a dismiss; reopens the question and un-ticks the count. */
  undismiss: (questionId: string) => void;
  /** Answered OR dismissed — anything that removes the card from the answerable set. */
  isConsumed: (questionId: string) => boolean;
};

// The per-card answered-state for a From Friends streak
// (B-FROMFRIENDS-STREAK-HEADER-01, Phase 2). Lifted from the milestone bundle
// logic that ActivityStreamItem owned, so all the cards in one streak share a
// single resolution set: answering one card resolves only that card, persists
// across the result-sheet close + re-render (the useState(Set/Map) seed pattern),
// and does not collapse the others.
//
// A question with ANY prior result (correct OR incorrect) is seeded as resolved
// at mount — a single attempt is the viewer's only swing in the feed, so any
// prior result locks the card the same way an in-session answer does.
export function useStreakResolutions(
  questions: StreamQuestion[],
  // Fires when a question is CONSUMED in-session — answered OR dismissed — so the
  // parent bundle can tick its "N of M" progress and remove the card once empty.
  onConsumed?: () => void,
  // Fires when a dismiss is UNDONE, so the parent can un-tick that same progress.
  onReopened?: () => void,
): StreakResolutions {
  const [serverAnswered] = useState<Set<string>>(
    () => new Set(questions.filter((q) => q.priorResult !== null).map((q) => q.questionId)),
  );
  const [resolutions, setResolutions] = useState<Map<string, StreakResolution>>(() => new Map());
  // Dismissed questions: seeded from the server flag (persisted per-viewer in
  // MilestoneDismissed) so a dismiss survives a reload, then mutated in-session.
  const [dismissed, setDismissed] = useState<Set<string>>(
    () => new Set(questions.filter((q) => q.dismissed).map((q) => q.questionId)),
  );

  function isResolved(questionId: string): boolean {
    return serverAnswered.has(questionId) || resolutions.has(questionId);
  }

  function isDismissed(questionId: string): boolean {
    return dismissed.has(questionId);
  }

  function isConsumed(questionId: string): boolean {
    return isResolved(questionId) || isDismissed(questionId);
  }

  function resolve(questionId: string, submitted: string, isCorrect: boolean) {
    setResolutions((prev) => {
      const next = new Map(prev);
      next.set(questionId, { submitted, isCorrect });
      return next;
    });
    onConsumed?.();
  }

  function dismiss(questionId: string) {
    setDismissed((prev) => {
      if (prev.has(questionId)) return prev;
      const next = new Set(prev);
      next.add(questionId);
      return next;
    });
    onConsumed?.();
  }

  function undismiss(questionId: string) {
    setDismissed((prev) => {
      if (!prev.has(questionId)) return prev;
      const next = new Set(prev);
      next.delete(questionId);
      return next;
    });
    onReopened?.();
  }

  const answeredCount = questions.filter((q) => isResolved(q.questionId)).length;

  return {
    isResolved,
    resolve,
    resolutions,
    answeredCount,
    isDismissed,
    dismiss,
    undismiss,
    isConsumed,
  };
}
