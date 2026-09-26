import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { KnowledgeCard, type KnowledgeCardProps } from '@/components/knowledge/KnowledgeCard'

const baseProps: KnowledgeCardProps = {
  playerDisplayName: 'Duo Prova',
  portraitStatement: 'Duo Prova is building around Jazz.',
  domains: [],
  overflowCount: 0,
  tierSignature: '10 knowledge points across 1 territories',
  rarestTerritory: null,
  rarestTerritorySolo: false,
  shareText: '',
  shareCardToken: '',
  shareCardExpiresAt: '',
  readOnly: true,
}

describe('KnowledgeCard heading (QA 2026-09-25, S13)', () => {
  it('reads "Your" on your own portrait', () => {
    const html = renderToStaticMarkup(<KnowledgeCard {...baseProps} />)
    expect(html).toContain('Your Knowledge Portrait')
  })

  it("names the owner on someone else's portrait", () => {
    const html = renderToStaticMarkup(<KnowledgeCard {...baseProps} ownerView={false} />)
    expect(html).toContain('Duo’s Knowledge Portrait')
    expect(html).not.toContain('Your Knowledge Portrait')
  })
})
