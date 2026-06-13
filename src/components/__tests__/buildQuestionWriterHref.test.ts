import { describe, expect, it } from 'vitest'

import { buildQuestionWriterHref } from '@/components/FeedList'

describe('buildQuestionWriterHref', () => {
  it('routes to the writer with no text when the idea is empty', () => {
    expect(buildQuestionWriterHref('')).toBe('/questions?create=1&intent=bank')
  })

  it('treats a whitespace-only idea as empty', () => {
    expect(buildQuestionWriterHref('   ')).toBe('/questions?create=1&intent=bank')
  })

  it('carries a trimmed, encoded idea through as ?text= and requests auto-submit', () => {
    expect(buildQuestionWriterHref('  Which Broadway musical opened in 1957?  ')).toBe(
      '/questions?create=1&intent=bank&text=Which%20Broadway%20musical%20opened%20in%201957%3F&submit=1'
    )
  })
})
