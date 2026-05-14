import { describe, expect, it } from 'vitest';

import { parseAnswerRecheck } from '@/server/llm/recheck';

describe('answer recheck parser', () => {
  it('parses accepted appeals and normalizes accepted alternative text', () => {
    expect(parseAnswerRecheck('{"decision":"accept","confidence":0.91,"reason":"That is an equivalent title.","accepted_alternative":"Eroica"}')).toEqual({
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
});
