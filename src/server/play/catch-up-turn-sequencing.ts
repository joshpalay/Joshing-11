export type CatchUpSequencingItem = {
  dailyQueueItemId: string;
  queueDate: string;
  wasSkipped: boolean;
};

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
  if (hasUnresolvedCatchUpPrompt(params.introducedItemIds, params.resultPostedItemIds)) return false;
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
