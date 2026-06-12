import { describe, expect, it } from 'vitest';

import { defaultShareToFeed, scopeSignpost } from '@/components/QuestionForm';

// B5 / D9 (PRD-D-5 §5.1): the authoring signpost is a feature, not a privacy
// warning. Public is the default and reads as a reward (others can play this);
// friends-only is the calm exception. Nothing is ever exposed outside Joshing.
describe('scopeSignpost (D9 authoring signpost)', () => {
  it('frames the public default as positive reach + author attribution', () => {
    const copy = scopeSignpost('public');
    expect(copy).toMatch(/play this/i);
    expect(copy).toMatch(/from you/i);
  });

  it('never reads as a cautionary or alarming warning', () => {
    for (const visibility of ['public', 'friends', 'private'] as const) {
      expect(scopeSignpost(visibility)).not.toMatch(
        /warning|careful|caution|danger|are you sure|cannot be undone/i,
      );
    }
  });

  it('never implies exposure beyond Joshing (no open web / internet / strangers)', () => {
    for (const visibility of ['public', 'friends', 'private'] as const) {
      expect(scopeSignpost(visibility)).not.toMatch(
        /internet|the web|world|stranger|public web|searchable/i,
      );
    }
  });

  it('signposts the friends-only override as the exception path', () => {
    expect(scopeSignpost('friends')).toMatch(/friends only/i);
  });

  it('keeps private author-only', () => {
    expect(scopeSignpost('private')).toMatch(/only you/i);
  });
});

describe('defaultShareToFeed (authoring destinations)', () => {
  it('does not broadcast newly created questions to friends by default', () => {
    expect(defaultShareToFeed()).toBe(false);
  });

  it('preserves explicit initial share state when editing or hydrating drafts', () => {
    expect(defaultShareToFeed({ shareToFeed: true })).toBe(true);
    expect(defaultShareToFeed({ shareToFeed: false })).toBe(false);
  });
});
