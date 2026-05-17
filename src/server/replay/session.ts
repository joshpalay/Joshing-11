export type ReplayItem = {
  dailyQueueItemId: string;
  queueDate: string;
  slotIndex: number;
  questionId: string;
  questionText: string;
  correctAnswer: string;
  explanation: string | null;
  domain: string;
  domainDisplayName: string;
  originalSubmittedAnswer: string | null;
};

export function selectReplaySession<T extends ReplayItem>(
  items: T[],
  max = 5,
  excludeIds: string[] = [],
): T[] {
  const exclude = new Set(excludeIds);
  return [...items]
    .filter((item) => !exclude.has(item.dailyQueueItemId))
    .sort((a, b) => {
      const dateDelta = b.queueDate.localeCompare(a.queueDate);
      if (dateDelta !== 0) return dateDelta;
      const slotDelta = a.slotIndex - b.slotIndex;
      if (slotDelta !== 0) return slotDelta;
      return a.dailyQueueItemId.localeCompare(b.dailyQueueItemId);
    })
    .slice(0, max);
}

export function shouldShowReplayCard(totalWrong: number): boolean {
  return totalWrong > 0;
}
