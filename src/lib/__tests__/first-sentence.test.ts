import { describe, expect, it } from 'vitest'

import { firstSentence } from '@/lib/first-sentence'

describe('firstSentence', () => {
  it('returns the leading sentence', () => {
    expect(firstSentence('First. Second. Third.')).toBe('First.')
  })

  it('handles ! and ? terminators', () => {
    expect(firstSentence('Wow! More text here.')).toBe('Wow!')
    expect(firstSentence('Really? Yes indeed.')).toBe('Really?')
  })

  it('does not break on the "St." abbreviation (the regression case)', () => {
    expect(
      firstSentence(
        'The opening chorus of the St. Matthew Passion sets the tone. The rest is detail.',
      ),
    ).toBe('The opening chorus of the St. Matthew Passion sets the tone.')
  })

  it('does not break on common title abbreviations', () => {
    expect(firstSentence('Composed by Dr. Bach for the service. More here.')).toBe(
      'Composed by Dr. Bach for the service.',
    )
    expect(firstSentence('Written by Mr. and Mrs. Smith. Then they left.')).toBe(
      'Written by Mr. and Mrs. Smith.',
    )
  })

  it('does not break on single-letter initials', () => {
    expect(firstSentence('A theme by J. S. Bach, reworked later. And so on.')).toBe(
      'A theme by J. S. Bach, reworked later.',
    )
  })

  it('returns the whole string when there is no terminator', () => {
    expect(firstSentence('no terminator here')).toBe('no terminator here')
  })

  it('trims surrounding whitespace', () => {
    expect(firstSentence('  Padded sentence. Next.  ')).toBe('Padded sentence.')
  })
})
