import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DomainCard } from '@/components/knowledge/DomainCard';

vi.mock('next/link', () => ({
  default: ({ href, children, style, ...props }: { href: string; children: React.ReactNode; style?: React.CSSProperties }) => (
    <a href={href} style={style} {...props}>
      {children}
    </a>
  ),
}));

describe('DomainCard contribution copy', () => {
  it('shows contribution dots when the user has authored questions in the domain', () => {
    const html = renderToStaticMarkup(
      <DomainCard
        domain={{
          name: 'World History',
          tier: 'solid',
          progressWithinTier: 0.4,
          masteryPoints: 24,
          declaredQuestionCount: 2,
          provenCorrectCount: 3,
          isVisibleOnProfile: true,
        }}
      />,
    );

    expect(html).toContain('Your q’s');
    expect(html).not.toContain('Add questions here to reach mastery.');
  });

  it('shows the mastery nudge when a solid domain has no authored questions', () => {
    const html = renderToStaticMarkup(
      <DomainCard
        domain={{
          name: 'Biology',
          tier: 'solid',
          progressWithinTier: 0.2,
          masteryPoints: 20,
          declaredQuestionCount: 0,
          provenCorrectCount: 4,
          isVisibleOnProfile: true,
        }}
      />,
    );

    expect(html).toContain('Add questions here to reach mastery.');
    expect(html).not.toContain('Your q’s');
  });
});
