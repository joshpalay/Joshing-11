import { describe, expect, it } from 'vitest';

import {
  CANNED_REACTIONS,
  CORRECT_ANSWER_REACTIONS,
  WRONG_ANSWER_REACTIONS,
  isReactionKey,
  isWrongAnswerReactionKey,
} from '@/lib/reactions';

describe('reaction canned-list classification', () => {
  it('exposes the four wrong-answer canned types from §8.10b', () => {
    const keys = WRONG_ANSWER_REACTIONS.map((reaction) => reaction.key);
    expect(keys).toEqual(['didnt_know_tell_me', 'need_story', 'adding_to_list', 'knew_i_wouldnt']);
  });

  it('keeps the correct-answer and wrong-answer sets disjoint', () => {
    const correctKeys = new Set(CORRECT_ANSWER_REACTIONS.map((reaction) => reaction.key));
    for (const reaction of WRONG_ANSWER_REACTIONS) {
      expect(correctKeys.has(reaction.key)).toBe(false);
    }
  });

  it('treats every wrong-answer key as a valid reaction key', () => {
    for (const reaction of WRONG_ANSWER_REACTIONS) {
      expect(isReactionKey(reaction.key)).toBe(true);
      expect(isWrongAnswerReactionKey(reaction.key)).toBe(true);
    }
  });

  it('does not classify correct-answer keys as wrong-answer keys', () => {
    for (const reaction of CORRECT_ANSWER_REACTIONS) {
      expect(isReactionKey(reaction.key)).toBe(true);
      expect(isWrongAnswerReactionKey(reaction.key)).toBe(false);
    }
  });

  it('rejects unknown keys from both classifiers', () => {
    expect(isReactionKey('not_a_real_reaction')).toBe(false);
    expect(isWrongAnswerReactionKey('not_a_real_reaction')).toBe(false);
    // The §8.22 opt-in gate hinges on this: a misspelled or attacker-supplied
    // key must not be allowed to attach submitted text.
    expect(isWrongAnswerReactionKey('good_one')).toBe(false);
  });

  it('aggregates both subsets into the canonical CANNED_REACTIONS list', () => {
    const all = new Set(CANNED_REACTIONS.map((reaction) => reaction.key));
    for (const reaction of [...CORRECT_ANSWER_REACTIONS, ...WRONG_ANSWER_REACTIONS]) {
      expect(all.has(reaction.key)).toBe(true);
    }
    expect(CANNED_REACTIONS).toHaveLength(
      CORRECT_ANSWER_REACTIONS.length + WRONG_ANSWER_REACTIONS.length,
    );
  });
});
