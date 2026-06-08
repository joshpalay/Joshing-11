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
});
