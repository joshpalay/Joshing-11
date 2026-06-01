// Reactions the answerer can send after a CORRECT answer.
export const CORRECT_ANSWER_REACTIONS = [
  { key: 'how_did_you_know', label: 'How did you know that?', emoji: ':exploding_head:' },
  { key: 'good_one', label: 'Good one', emoji: ':ok_hand:' },
  { key: 'too_easy', label: 'Too easy', emoji: ':smirk:' },
  { key: 'i_should_have_known', label: 'I should have known this', emoji: ':face_palm:' },
  { key: 'made_my_day', label: 'This made my day', emoji: ':sunny:' },
  { key: 'thinking_of_you', label: 'Thinking of you', emoji: ':thought_balloon:' },
] as const;

// Reactions the answerer can send after a WRONG answer (§8.10b / §8.22).
// The wrong-answer canned types are the only ones eligible to attach the
// answerer's submitted text via the include_submitted_answer opt-in.
export const WRONG_ANSWER_REACTIONS = [
  { key: 'didnt_know_tell_me', label: "Didn't know — tell me", emoji: ':thinking_face:' },
  { key: 'need_story', label: 'Need the story', emoji: ':open_book:' },
  { key: 'adding_to_list', label: 'Adding to my list', emoji: ':memo:' },
  { key: 'knew_i_wouldnt', label: "Knew I wouldn't get it", emoji: ':sweat_smile:' },
] as const;

export const CANNED_REACTIONS = [...CORRECT_ANSWER_REACTIONS, ...WRONG_ANSWER_REACTIONS] as const;

export type ReactionKey = (typeof CANNED_REACTIONS)[number]['key'];
export type WrongAnswerReactionKey = (typeof WRONG_ANSWER_REACTIONS)[number]['key'];

export function getCannedReaction(key: string) {
  return CANNED_REACTIONS.find((reaction) => reaction.key === key) ?? null;
}

export function isReactionKey(value: string): value is ReactionKey {
  return CANNED_REACTIONS.some((reaction) => reaction.key === value);
}

export function isWrongAnswerReactionKey(value: string): value is WrongAnswerReactionKey {
  return WRONG_ANSWER_REACTIONS.some((reaction) => reaction.key === value);
}
