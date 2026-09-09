import type * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { NewTerritoryUndo } from '@/components/feed/NewTerritoryUndo';

vi.mock('lucide-react', () => ({
  Sparkles: () => <span aria-hidden="true" />,
}));

function html() {
  return renderToStaticMarkup(
    <NewTerritoryUndo domain="plant_taxonomy" category="Plant Taxonomy & Classification" />,
  );
}

describe('NewTerritoryUndo (knowledge-preference thread card)', () => {
  it('reads as a thread card with a clear primary message, secondary prompt, and the frequency options', () => {
    const rendered = html();
    // Quiet label, dominant message, secondary prompt, tertiary helper.
    expect(rendered).toContain('Knowledge updated');
    expect(rendered).toContain('Added Plant Taxonomy');
    expect(rendered).toContain('to your knowledge base.');
    expect(rendered).toContain('How often should this show up?');
    // Preserves all four frequency options.
    expect(rendered).toContain('Often');
    expect(rendered).toContain('Sometimes');
    expect(rendered).toContain('Blue Moon');
    expect(rendered).toContain('Never');
  });

  it('shares the play-thread card shell rather than its own settings-widget width', () => {
    const rendered = html();
    expect(rendered).toContain('border-radius:var(--radius-md)');
    // No longer the old rounded-2xl settings-style shell.
    expect(rendered).not.toContain('rounded-2xl');
  });

  it('opens on Sometimes (default-add) when the domain is already adopted', () => {
    const adopted = renderToStaticMarkup(
      <NewTerritoryUndo domain="zelda" category="The Legend of Zelda" adopted />,
    );
    // Sometimes hint == initial selection is "Sometimes" (the B-1 default).
    expect(adopted).toContain('Stays in normal rotation.');
    expect(adopted).not.toContain('Stays on your map, but');
  });

  // B-DOMAIN-BONUS-ROTATION-01 / ask-before-add: on the daily +2 bonus surface
  // nothing is on the player's map yet, so this asks permission FIRST instead
  // of announcing an already-done add.
  it('asks before adding on the not-yet-adopted bonus surface, instead of announcing an already-done add', () => {
    const bonus = renderToStaticMarkup(
      <NewTerritoryUndo domain="zelda" category="The Legend of Zelda" adopted={false} />,
    );
    expect(bonus).toContain('Add');
    expect(bonus).toContain('The Legend of Zelda');
    expect(bonus).toContain('to your topics?');
    expect(bonus).toContain('Yes, sometimes');
    expect(bonus).toContain('Yes, often');
    expect(bonus).toContain('Not now');
    // No past-tense "already added" framing on first render.
    expect(bonus).not.toContain('Added');
    expect(bonus).not.toContain('Knowledge updated');
  });

  it('presents Not now as the default action on the bonus prompt', () => {
    const bonus = renderToStaticMarkup(
      <NewTerritoryUndo domain="zelda" category="The Legend of Zelda" adopted={false} />,
    );
    const sometimesButton = bonus.match(/<button[^>]*>Yes, sometimes<\/button>/)?.[0];
    const notNowButton = bonus.match(/<button[^>]*>Not now<\/button>/)?.[0];

    expect(sometimesButton).toBeDefined();
    expect(notNowButton).toBeDefined();
    expect(sometimesButton).not.toContain('background-color');
    expect(notNowButton).toContain(
      'background-color:color-mix(in srgb, var(--accent-gold) 20%, var(--brand-card))',
    );
  });
});
