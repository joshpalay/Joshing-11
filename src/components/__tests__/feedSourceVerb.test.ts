import { describe, expect, it } from 'vitest'

import { feedSourceVerb } from '@/components/FeedList'

describe('feedSourceVerb (B-6 authored-vs-curated provenance)', () => {
  it('uses the human-authorship verb for a directly-sent authored question', () => {
    expect(feedSourceVerb('direct_sent', 'authored')).toBe('wrote you this')
  })

  it('uses the curated verb for a directly-sent curated LLM question', () => {
    expect(feedSourceVerb('direct_sent', 'curated_sent')).toBe('sent you this')
  })

  it('defaults a directly-sent question with missing provenance to the curated verb', () => {
    // B-5: a curated/LLM send must never imply a human wrote it, so anything that
    // is not an explicit 'authored' source falls back to "sent you this".
    expect(feedSourceVerb('direct_sent', null)).toBe('sent you this')
    expect(feedSourceVerb('direct_sent', undefined)).toBe('sent you this')
    expect(feedSourceVerb('direct_sent', 'daily_generated')).toBe('sent you this')
  })

  it('two direct sends of different provenance are distinguishable', () => {
    expect(feedSourceVerb('direct_sent', 'authored')).not.toBe(
      feedSourceVerb('direct_sent', 'curated_sent'),
    )
  })

  it('leaves the non-direct-send verbs unchanged', () => {
    expect(feedSourceVerb('authored_shared', null)).toBe('wrote this')
    expect(feedSourceVerb('thumbs_upped', null)).toBe('liked this')
    expect(feedSourceVerb('answered_by_you', null)).toBe('answered this')
  })
})
