/**
 * Catch-up copy shared by the API and UI.
 * Restored from v10.25, adapted to v11's personal daily surface and 0.25x weight.
 */

export const CATCH_UP_HEADER_LABEL = 'Catch up';

export const CATCH_UP_HEADER_DETAIL = 'Untimed - 0.25x points';

export const CATCH_UP_INTRO_COPY = 'Take your time - untimed; for your record, not standings.';

export const CATCH_UP_POINTS_CAPTION =
  'These count for 0.25x points - the moment has passed, but the territory is still worth claiming.';

export const CATCH_UP_COMPLETION_COPY = 'Catch-up complete.';

export const CATCH_UP_EMPTY_COPY = "Nothing to catch up on. You're all clear.";

function formatOneQueueDate(queueDate: string): string | null {
  const date = new Date(`${queueDate}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatCatchUpAssignmentDatePhrase(
  firstQueueDate: string,
  lastQueueDate?: string,
): string {
  const first = formatOneQueueDate(firstQueueDate);
  if (!first) return 'earlier rounds';
  if (!lastQueueDate || lastQueueDate === firstQueueDate) return first;

  const last = formatOneQueueDate(lastQueueDate);
  if (!last) return first;

  const firstDate = new Date(`${firstQueueDate}T12:00:00.000Z`);
  const lastDate = new Date(`${lastQueueDate}T12:00:00.000Z`);
  if (Number.isNaN(firstDate.getTime()) || Number.isNaN(lastDate.getTime())) return first;
  if (sameLocalDay(firstDate, lastDate)) return first;
  return `${first} - ${last}`;
}

export function formatCatchUpSessionThreadIntro(
  answerableCount: number,
  firstQueueDate: string,
  lastQueueDate?: string,
): string {
  const dateLabel = formatCatchUpAssignmentDatePhrase(firstQueueDate, lastQueueDate);
  const questionLabel = answerableCount === 1 ? 'question' : 'questions';
  return `${answerableCount} ${questionLabel} from ${dateLabel}. ${CATCH_UP_INTRO_COPY}`;
}

export function formatCatchUpHeaderSubtitle(queueDate: string): string {
  const label = formatOneQueueDate(queueDate);
  return label ? `${CATCH_UP_HEADER_LABEL} - ${label}` : CATCH_UP_HEADER_LABEL;
}
