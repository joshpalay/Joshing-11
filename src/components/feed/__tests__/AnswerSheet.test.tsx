import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { AnswerSheet } from '@/components/feed'

const baseProps = {
  question: 'What is the capital of France?',
  category: 'Geography',
  onSubmit: vi.fn(),
  onClose: vi.fn(),
}

describe('AnswerSheet notice rendering', () => {
  it('renders neither notice by default', () => {
    const html = renderToStaticMarkup(<AnswerSheet {...baseProps} />)
    expect(html).not.toContain('role="status"')
    expect(html).not.toContain('role="alert"')
  })

  it('renders statusMessage as a polite status during retries', () => {
    const html = renderToStaticMarkup(
      <AnswerSheet {...baseProps} loading statusMessage="hang tight, we're trying again (2/4)…" />,
    )
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain("hang tight, we&#x27;re trying again (2/4)…")
    // A transient retry is not a failure — no alert.
    expect(html).not.toContain('role="alert"')
  })

  it('renders errorMessage as an alert after retries are exhausted', () => {
    const html = renderToStaticMarkup(
      <AnswerSheet {...baseProps} errorMessage="Please try again later." />,
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain('Please try again later.')
  })
})
