export type Surface = 'daily' | 'feed' | 'joshing_game';
export type FriendResult = 'correct' | 'incorrect' | null;

const DAILY_CORRECT = [
  "That's your ground.",
  'Knew it.',
  'Of course you did.',
  'Solid.',
  'There it is.',
] as const;

const DAILY_WRONG = [
  'Now you know.',
  "Close. It'll come.",
  'Good question.',
  "That one's yours now.",
] as const;

const FEED_BOTH_CORRECT = [
  'Same wavelength.',
  'You both had it.',
  'Common ground.',
] as const;

const FEED_YOU_CORRECT_FRIEND_WRONG = [
  "You had it. {name} didn't.",
  'You carried that one.',
] as const;

const FEED_YOU_WRONG_FRIEND_CORRECT = [
  "{name} had it. You'll get there.",
  "{name}'s ground. Now it's yours too.",
] as const;

const FEED_BOTH_WRONG = [
  'Neither of you. Good question.',
  'That one got you both.',
  'Tough one.',
] as const;

function randomFrom<T>(options: readonly T[], seed?: number): T {
  const index = seed !== undefined
    ? Math.floor(seed * options.length) % options.length
    : Math.floor(Math.random() * options.length);
  return options[index];
}

function sub(template: string, name: string): string {
  return template.replace(/\{name\}/g, name);
}

export function selectQuip(params: {
  isCorrect: boolean;
  surface: Surface;
  friendResult: FriendResult;
  friendName?: string;
  seed?: number;
}): string | null {
  const { isCorrect, surface, friendResult, friendName = 'them', seed } = params;

  if (surface === 'daily') {
    return isCorrect ? randomFrom(DAILY_CORRECT, seed) : randomFrom(DAILY_WRONG, seed);
  }

  if (surface === 'feed' || surface === 'joshing_game') {
    if (friendResult === null) {
      return isCorrect ? randomFrom(DAILY_CORRECT, seed) : randomFrom(DAILY_WRONG, seed);
    }
    if (isCorrect && friendResult === 'correct') return randomFrom(FEED_BOTH_CORRECT, seed);
    if (isCorrect && friendResult === 'incorrect') return sub(randomFrom(FEED_YOU_CORRECT_FRIEND_WRONG, seed), friendName);
    if (!isCorrect && friendResult === 'correct') return sub(randomFrom(FEED_YOU_WRONG_FRIEND_CORRECT, seed), friendName);
    return randomFrom(FEED_BOTH_WRONG, seed);
  }

  throw new Error(`selectQuip: unknown surface "${surface as string}"`);
}

export { DAILY_CORRECT, DAILY_WRONG, FEED_BOTH_CORRECT, FEED_YOU_CORRECT_FRIEND_WRONG, FEED_YOU_WRONG_FRIEND_CORRECT, FEED_BOTH_WRONG };
