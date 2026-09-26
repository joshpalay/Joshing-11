import { describe, expect, it } from 'vitest'

import { firstSentence } from '@/lib/first-sentence'
import { stripInlineMarkdown } from '@/lib/plain-text'

describe('stripInlineMarkdown (QA 2026-09-25, S17)', () => {
  it('unwraps emphasis the model left in', () => {
    expect(stripInlineMarkdown('Right concept, wrong term—that’s the *tool* of linear perspective.')).toBe(
      'Right concept, wrong term—that’s the tool of linear perspective.',
    )
    expect(stripInlineMarkdown('**Bold** and _it_ and `code`')).toBe('Bold and it and code')
  })

  it('leaves lone symbols and snake_case alone', () => {
    expect(stripInlineMarkdown('5 * 3 = 15 and snake_case_name')).toBe('5 * 3 = 15 and snake_case_name')
    expect(stripInlineMarkdown('a*b*c')).toBe('a*b*c')
  })
})

describe('firstSentence abbreviations (QA 2026-09-25, S17)', () => {
  it('does not cut at a parenthesised "Op."', () => {
    expect(firstSentence('Beethoven wrote one opera, Fidelio (Op. 72), revised twice. It premiered in 1805.')).toBe(
      'Beethoven wrote one opera, Fidelio (Op. 72), revised twice.',
    )
  })

  it('strips markdown from the one-line explainer', () => {
    expect(firstSentence('The *Uffizi* was built as offices. More.')).toBe('The Uffizi was built as offices.')
  })
})
