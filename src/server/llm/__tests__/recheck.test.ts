import { describe, expect, it } from 'vitest';

import { parseAnswerRecheck } from '@/server/llm/recheck';

describe('answer recheck parser', () => {
  it('parses accepted appeals and normalizes accepted alternative text', () => {
    expect(
      parseAnswerRecheck(
        '{"decision":"accept","confidence":0.91,"reason":"That is an equivalent title.","accepted_alternative":"Eroica"}',
      ),
    ).toEqual({
      decision: 'accept',
      confidence: 0.91,
      reason: 'That is an equivalent title.',
      acceptedAlternative: 'Eroica',
    });
  });

  it('falls back to human review on malformed output', () => {
    expect(parseAnswerRecheck('not json')).toEqual({
      decision: 'needs_human',
      confidence: 0,
      reason: 'The recheck service could not confidently review this answer.',
      acceptedAlternative: null,
    });
  });

  it('parses a canonical_disputed verdict and never carries an accepted alternative', () => {
    expect(
      parseAnswerRecheck(
        '{"decision":"canonical_disputed","confidence":0.88,"reason":"Rubyfruit Jungle was written by Rita Mae Brown, not the canonical answer.","accepted_alternative":"Rita Mae Brown"}',
      ),
    ).toEqual({
      decision: 'canonical_disputed',
      confidence: 0.88,
      reason: 'Rubyfruit Jungle was written by Rita Mae Brown, not the canonical answer.',
      // accepted_alternative is only honoured for an accept; a disputed key
      // must not silently add the submitted text as an alternative.
      acceptedAlternative: null,
    });
  });
});
