export const CANNED_REACTIONS = [
  { key: 'how_did_you_know', label: 'How did you know that?', emoji: ':exploding_head:' },
  { key: 'good_one', label: 'Good one', emoji: ':ok_hand:' },
  { key: 'too_easy', label: 'Too easy', emoji: ':smirk:' },
  { key: 'i_should_have_known', label: 'I should have known this', emoji: ':face_palm:' },
  { key: 'made_my_day', label: 'This made my day', emoji: ':sunny:' },
  { key: 'thinking_of_you', label: 'Thinking of you', emoji: ':thought_balloon:' },
] as const;

export type ReactionKey = typeof CANNED_REACTIONS[number]['key'];

export function getCannedReaction(key: string) {
  return CANNED_REACTIONS.find((reaction) => reaction.key === key) ?? null;
}

export function isReactionKey(value: string): value is ReactionKey {
  return CANNED_REACTIONS.some((reaction) => reaction.key === value);
}
