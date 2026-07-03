import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { isVerifiedAnswer, ReformulationOption, scopeSignpost } from '@/components/QuestionForm';

// The screenshot bug: the LLM auto-filled a wrong answer ("Keanu Reeves"), which
// the "verified" check then matched against itself, self-certifying a wrong answer
// as broadcast-eligible. "verified" must mean the AUTHOR independently corroborated
// the suggestion — not that they passively accepted the machine's guess.
describe('isVerifiedAnswer (anti self-certification)', () => {
  const suggestion = 'Keanu Reeves';

  it('verifies when the author independently typed a matching answer', () => {
    expect(isVerifiedAnswer({ suggestedAnswer: suggestion, userAnswer: 'Keanu Reeves', answerSource: 'author' })).toBe(true);
  });

  it('does NOT verify when the author merely accepted the suggestion (no independent corroboration)', () => {
    expect(isVerifiedAnswer({ suggestedAnswer: suggestion, userAnswer: 'Keanu Reeves', answerSource: 'suggestion' })).toBe(false);
  });

  it('does NOT verify before the author has supplied any answer', () => {
    expect(isVerifiedAnswer({ suggestedAnswer: suggestion, userAnswer: '', answerSource: null })).toBe(false);
  });

  it('does NOT verify when the author typed a different answer than the suggestion', () => {
    expect(isVerifiedAnswer({ suggestedAnswer: suggestion, userAnswer: 'Balthazar Getty', answerSource: 'author' })).toBe(false);
  });

  it('matches case- and whitespace-insensitively for an author-supplied answer', () => {
    expect(isVerifiedAnswer({ suggestedAnswer: suggestion, userAnswer: '  keanu reeves ', answerSource: 'author' })).toBe(true);
  });

  it('falls back to verified when there is no suggestion to cross-check against', () => {
    expect(isVerifiedAnswer({ suggestedAnswer: null, userAnswer: 'anything', answerSource: 'author' })).toBe(true);
  });
});

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

// B-COMPOSER-SUGGESTION-ARTIFACT-01: the per-option "Use this" label is no
// longer rendered (the shared "Try one of these instead:" header carries the
// intent). The reformulation value still owns its own element node so it can
// never run together with surrounding text into a single run-on string.
describe('ReformulationOption (B-COMPOSER-SUGGESTION-ARTIFACT-01)', () => {
  const value = 'Which American city is the capital of New York State?';

  it('renders the reformulation value without a redundant per-option label', () => {
    const html = renderToStaticMarkup(<ReformulationOption text={value} onUse={() => {}} />);
    expect(html).toContain(value);
    expect(html).not.toContain('Use this');
  });

  it('wraps the value in its own element so it never runs into surrounding text', () => {
    const html = renderToStaticMarkup(<ReformulationOption text={value} onUse={() => {}} />);
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // The value must begin a fresh element's content (e.g. `<span ...>Which…`).
    expect(html).toMatch(new RegExp(`<[a-z]+[^>]*>${escaped}`));
  });
});
