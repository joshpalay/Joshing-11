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

  // B-DOMAIN-BONUS-ROTATION-01: on the daily +2 bonus surface the domain is NOT
  // yet in rotation, so the control must open on "Never" (its true state) and any
  // other tier is the explicit opt-in. The selected tier's helper hint is rendered
  // in the markup, so it doubles as a witness for the initial selection.
  it('opens on Never (opt-in) for a not-yet-adopted bonus domain', () => {
    const bonus = renderToStaticMarkup(
      <NewTerritoryUndo domain="zelda" category="The Legend of Zelda" adopted={false} />,
    );
    // Resting hint == initial selection is "Never" (apostrophe is HTML-escaped in
    // the static markup, so match the unambiguous prefix).
    expect(bonus).toContain('Stays on your map, but');
    expect(bonus).not.toContain('Stays in normal rotation.');
  });

  it('opens on Sometimes (default-add) when the domain is already adopted', () => {
    const adopted = renderToStaticMarkup(
      <NewTerritoryUndo domain="zelda" category="The Legend of Zelda" adopted />,
    );
    // Sometimes hint == initial selection is "Sometimes" (the B-1 default).
    expect(adopted).toContain('Stays in normal rotation.');
    expect(adopted).not.toContain('Stays on your map, but');
  });
});
