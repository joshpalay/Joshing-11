import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ReformulationOption, scopeSignpost } from '@/components/QuestionForm';

// B5 / D9 (PRD-D-5 §5.1): the authoring signpost is a feature, not a privacy
// warning. Public is the default and reads as a reward (others can play this);
// friends-only is the calm exception. Nothing is ever exposed outside Joshing.
describe('scopeSignpost (D9 authoring signpost)', () => {
  it('frames the public default as positive reach + author attribution', () => {
    const copy = scopeSignpost('public');
    expect(copy).toMatch(/play this/i);
    expect(copy).toMatch(/from you/i);
  });

  it('never reads as a cautionary or alarming warning', () => {
    for (const visibility of ['public', 'friends', 'private'] as const) {
      expect(scopeSignpost(visibility)).not.toMatch(
        /warning|careful|caution|danger|are you sure|cannot be undone/i,
      );
    }
  });

  it('never implies exposure beyond Joshing (no open web / internet / strangers)', () => {
    for (const visibility of ['public', 'friends', 'private'] as const) {
      expect(scopeSignpost(visibility)).not.toMatch(
        /internet|the web|world|stranger|public web|searchable/i,
      );
    }
  });

  it('signposts the friends-only override as the exception path', () => {
    expect(scopeSignpost('friends')).toMatch(/friends only/i);
  });

  it('keeps private author-only', () => {
    expect(scopeSignpost('private')).toMatch(/only you/i);
  });
});

// B-COMPOSER-SUGGESTION-ARTIFACT-01: the "Use this" affordance label must never
// concatenate with the reformulation value into a single run-on string
// ("Use this Which American city…"). The label and value are discrete elements;
// the value owns its own node and is never a bare sibling text node of the label.
describe('ReformulationOption (B-COMPOSER-SUGGESTION-ARTIFACT-01)', () => {
  const value = 'Which American city is the capital of New York State?';

  it('renders the reformulation value intact alongside the "Use this" label', () => {
    const html = renderToStaticMarkup(<ReformulationOption text={value} onUse={() => {}} />);
    expect(html).toContain('Use this');
    expect(html).toContain(value);
  });

  it('wraps the value in its own element so the label can never run into it', () => {
    const html = renderToStaticMarkup(<ReformulationOption text={value} onUse={() => {}} />);
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // The value must begin a fresh element's content (e.g. `<span ...>Which…`),
    // never trail the label as a bare text node (`Use this</span> Which…`).
    expect(html).toMatch(new RegExp(`<[a-z]+[^>]*>${escaped}`));
    // And the two must never collapse into one literal run-on string.
    expect(html).not.toContain(`Use this ${value}`);
    expect(html).not.toContain(`Use this${value}`);
  });
});
