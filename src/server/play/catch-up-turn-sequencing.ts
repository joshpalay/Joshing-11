export type CatchUpSequencingItem = {
  dailyQueueItemId: string;
  queueDate: string;
  wasSkipped: boolean;
};

export type CatchUpDuplicateItem = CatchUpSequencingItem & {
  questionId?: string | null;
  questionText: string;
  correctAnswer: string;
  domain: string;
};

function normalizeCatchUpDuplicateValue(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Catch-up can span several daily queues, so a repeated generated question or a
 * near-identical regenerated prompt can otherwise appear multiple times in one
 * missed-question session. Keep the first item from the already-sorted list and
 * suppress later repeats that share the same source question, prompt text, or
 * canonical answer within a domain.
 */
export function dedupeCatchUpItems<T extends CatchUpDuplicateItem>(items: T[]): T[] {
  const seenQuestionIds = new Set<string>();
  const seenQuestionTexts = new Set<string>();
  const seenDomainAnswers = new Set<string>();
  const uniqueItems: T[] = [];

  for (const item of items) {
    const questionId = item.questionId?.trim() ?? '';
    const questionText = normalizeCatchUpDuplicateValue(item.questionText);
    const domainAnswer = [
      normalizeCatchUpDuplicateValue(item.domain),
      normalizeCatchUpDuplicateValue(item.correctAnswer),
    ].join('::');

    if (questionId && seenQuestionIds.has(questionId)) continue;
    if (questionText && seenQuestionTexts.has(questionText)) continue;
    if (domainAnswer !== '::' && seenDomainAnswers.has(domainAnswer)) continue;

    if (questionId) seenQuestionIds.add(questionId);
    if (questionText) seenQuestionTexts.add(questionText);
    if (domainAnswer !== '::') seenDomainAnswers.add(domainAnswer);
    uniqueItems.push(item);
  }

  return uniqueItems;
}

export function hasUnresolvedCatchUpPrompt(
  introducedItemIds: Set<string>,
  resultPostedItemIds: Set<string>,
): boolean {
  for (const itemId of introducedItemIds) {
    if (!resultPostedItemIds.has(itemId)) return true;
  }
  return false;
}

export function shouldIntroduceCatchUpQuestion(params: {
  currentCatchUpItemId: string | null;
  loading: boolean;
  isResolvingTurn: boolean;
  introducedItemIds: Set<string>;
  resultPostedItemIds: Set<string>;
}): boolean {
  if (!params.currentCatchUpItemId || params.loading) return false;
  if (params.isResolvingTurn) return false;
  if (hasUnresolvedCatchUpPrompt(params.introducedItemIds, params.resultPostedItemIds))
    return false;
  return !params.introducedItemIds.has(params.currentCatchUpItemId);
}

export function orderCatchUpItems<T extends CatchUpSequencingItem>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.wasSkipped !== b.wasSkipped) return a.wasSkipped ? -1 : 1;
    const dateDelta = a.queueDate.localeCompare(b.queueDate);
    if (dateDelta !== 0) return dateDelta;
    return a.dailyQueueItemId.localeCompare(b.dailyQueueItemId);
  });
}
