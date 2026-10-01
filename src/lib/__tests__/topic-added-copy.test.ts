import { describe, expect, it } from 'vitest';

import { addedTopicMessage } from '@/lib/topic-added-copy';

describe('addedTopicMessage', () => {
  it('says a removed topic is back with its points (QA 2026-10-01, S6)', () => {
    expect(addedTopicMessage({ domain: 'Breaking Bad', created: false, restored: true })).toBe(
      '“Breaking Bad” is back on your map — the points you’d earned are still there.',
    );
  });

  it('confirms a brand-new topic', () => {
    expect(addedTopicMessage({ domain: 'Moby-Dick', created: true })).toBe(
      'Added “Moby-Dick” — it’ll show up in an upcoming round.',
    );
  });

  it('keeps "already in your topics" for a true no-op', () => {
    expect(addedTopicMessage({ domain: 'Bach', created: false, restored: false })).toBe(
      '“Bach” is already in your topics.',
    );
  });
});
