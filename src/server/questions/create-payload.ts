import { questionContainsAnswer } from '@/server/questions/self-answering';

function readBoolean(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== 'string') return false;

  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

function splitAlternates(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export function readCreateQuestionPayload(body: Record<string, unknown> | null) {
  const text =
    typeof body?.text === 'string'
      ? body.text.trim()
      : typeof body?.question_text === 'string'
        ? body.question_text.trim()
        : '';
  const correctAnswer =
    typeof body?.correctAnswer === 'string'
      ? body.correctAnswer.trim()
      : typeof body?.answer_text === 'string'
        ? body.answer_text.trim()
        : '';
  const alternateAnswers = splitAlternates(
    body?.alternateAnswers ?? body?.accepted_alternatives,
  ).slice(0, 5);
  const explanation =
    typeof body?.explanation === 'string' ? body.explanation.trim() || null : null;
  const creatorNote =
    typeof body?.creatorNote === 'string'
      ? body.creatorNote.trim() || null
      : typeof body?.creator_note === 'string'
        ? body.creator_note.trim() || null
        : null;
  const verified = typeof body?.verified === 'boolean' ? body.verified : null;
  const llmSuggestedAnswer =
    typeof body?.llmSuggestedAnswer === 'string' ? body.llmSuggestedAnswer.trim() || null : null;
  const critiqueIterations =
    typeof body?.critiqueIterations === 'number' ? body.critiqueIterations : Number.NaN;

  const rawSendToFriendIds = Array.isArray(body?.sendToFriendIds)
    ? (body.sendToFriendIds as unknown[])
        .filter((id): id is string => typeof id === 'string')
        .slice(0, 20)
    : [];
  const shareToFeed =
    readBoolean(body?.shareToFeed) ||
    readBoolean(body?.shareWithFriends) ||
    readBoolean(body?.share_with_friends) ||
    readBoolean(body?.share_to_feed) ||
    readBoolean(body?.sharedToFriendsFeed);

  const errors: string[] = [];
  if (!text || text.length > 300) errors.push('text');
  if (!correctAnswer || correctAnswer.length > 200) errors.push('correctAnswer');
  if (alternateAnswers.length > 5 || alternateAnswers.some((answer) => answer.length > 200))
    errors.push('alternateAnswers');
  if (explanation && explanation.length > 500) errors.push('explanation');
  if (creatorNote && creatorNote.length > 200) errors.push('creatorNote');
  if (verified === null) errors.push('verified');
  if (!Number.isInteger(critiqueIterations) || critiqueIterations < 0)
    errors.push('critiqueIterations');
  if (shareToFeed && rawSendToFriendIds.length > 0) errors.push('shareToFeed');
  if (text && correctAnswer && questionContainsAnswer(text, correctAnswer, alternateAnswers)) {
    errors.push('answerInQuestion');
  }

  return {
    value: {
      text,
      correctAnswer,
      alternateAnswers,
      explanation,
      creatorNote,
      verified: verified ?? true,
      llmSuggestedAnswer,
      critiqueIterations: Number.isInteger(critiqueIterations) ? critiqueIterations : 0,
      sendToFriendIds: rawSendToFriendIds,
      shareToFeed,
    },
    errors,
  };
}
