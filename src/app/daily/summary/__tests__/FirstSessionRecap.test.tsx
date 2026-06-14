import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import type { FirstSessionRecapBeat2 } from '@/server/daily/first-session-recap';
import { Beat2, Beat3, Beat4 } from '@/app/daily/summary/FirstSessionRecap';

// PLR-15: the post-first-five recap teaches the Knowledge and Questions tabs in
// the same eyebrow → serif-headline → supporting-line grammar, then ends on the
// daily rhythm + reminder opt-in. These tests lock the tab pointers, the canon
// guardrails (no competition language, no mastery-size overstatement, no leftover
// invite beat), and the reminder opt-in form (moved here off the signup flow).

const beat2: FirstSessionRecapBeat2 = {
  touchedDomains: ['Plant Taxonomy', 'Color Theory'],
  offTheGroundDomain: 'Plant Taxonomy',
  newTerritoryDomain: 'Color Theory',
};

function html(node: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(node);
}

describe('Beat2 — Knowledge tab', () => {
  it('points the player at the Knowledge tab', () => {
    const out = html(<Beat2 beat={beat2} />);
    expect(out).toContain('Knowledge');
    expect(out).toMatch(/your full map/i);
  });

  it('does not overstate the mastery model (no "bigger = more answered")', () => {
    const out = html(<Beat2 beat={beat2} />);
    expect(out).not.toMatch(/bigger|more answered|more questions/i);
  });
});

describe('Beat3 — Questions tab', () => {
  it('points the player at the Questions tab and frames writing a question', () => {
    const out = html(<Beat3 />);
    expect(out).toContain('Questions');
    expect(out).toMatch(/ask|write/i);
  });

  it('stays anti-competition (no leaderboard / streak / challenge language)', () => {
    const out = html(<Beat3 />);
    expect(out).not.toMatch(/leaderboard|streak|challenge|beat|compete/i);
  });
});

describe('Beat4 — daily rhythm + reminder opt-in', () => {
  it('states the every-day rhythm and offers the email opt-in form', () => {
    const out = html(<Beat4 onClose={() => {}} />);
    expect(out).toMatch(/every day/i);
    expect(out).toContain('type="email"');
    expect(out).toMatch(/turn on reminders/i);
    expect(out).toMatch(/maybe later/i);
  });
});
