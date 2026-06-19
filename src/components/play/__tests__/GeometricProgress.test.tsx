import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { GeometricProgress } from '@/components/play/GeometricProgress';

const noResults: Record<number, 'correct' | 'wrong' | 'expired'> = {};

describe('GeometricProgress dot track', () => {
  it('N=0: renders exactly the core dots, no separator, no label (pre-bonus track)', () => {
    const html = renderToStaticMarkup(
      <GeometricProgress coreCount={5} bonusCount={0} current={1} results={noResults} />,
    );

    // Pixel-identical to the original single aria-hidden row.
    expect(html.startsWith('<div class="flex items-center gap-1.5 justify-center" aria-hidden="true">')).toBe(true);
    // Five dots, nothing else.
    const dotCount = (html.match(/[●○]/gu) ?? []).length;
    expect(dotCount).toBe(5);
    expect(html).not.toContain('bonus from friends');
    // No separator hairline (w-px) in the N=0 case.
    expect(html).not.toContain('w-px');
  });

  it('N=2: renders 5 core + separator + 2 bonus dots and the dynamic label', () => {
    const html = renderToStaticMarkup(
      <GeometricProgress coreCount={5} bonusCount={2} current={6} results={noResults} />,
    );

    expect((html.match(/[●○]/gu) ?? []).length).toBe(7);
    // Visible separator (gap carries signal alongside the label, not color).
    expect(html).toContain('w-px');
    // Real, screen-reader-legible label with the live count.
    expect(html).toContain('+2 bonus from friends');
    // Bonus dots are distinguished for assistive tech.
    expect(html).toContain('aria-label="bonus question 1 of 2, from friends"');
    expect(html).toContain('aria-label="bonus question 2 of 2, from friends"');
  });

  it('N=1: label reads "+1 bonus from friends"', () => {
    const html = renderToStaticMarkup(
      <GeometricProgress coreCount={5} bonusCount={1} current={1} results={noResults} />,
    );
    expect(html).toContain('+1 bonus from friends');
    expect(html).toContain('aria-label="bonus question 1 of 1, from friends"');
  });

  it('reuses the state ramp for bonus dots (answered bonus reads as correct/wrong)', () => {
    const html = renderToStaticMarkup(
      <GeometricProgress
        coreCount={5}
        bonusCount={1}
        current={7}
        results={{ 6: 'correct' }}
      />,
    );
    // Position 6 is the first bonus dot; a result fills it (● not ○).
    expect(html).toContain('var(--game-correct)');
  });
});
