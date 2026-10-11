import { describe, expect, it, vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({ default: class MockAnthropic {} }));

import { parseJsonObject } from './llm';

describe('parseJsonObject', () => {
  it.each([
    `The player was 6'5" tall. Verdict: `,
    'An unmatched "quote precedes the verdict: ',
    'Introductory prose ends with a backslash\\',
  ])('extracts a verdict after prose: %s', (prefix) => {
    expect(parseJsonObject(`${prefix}{"drop_indices":[],"reasons":{}}`))
      .toEqual({ drop_indices: [], reasons: {} });
  });

  it('ignores braces and escaped quotes inside JSON strings', () => {
    const verdict = { drop_indices: [0], reasons: { '0': 'Quoted "{clue}" and \\ path' } };
    expect(parseJsonObject(`Verdict: ${JSON.stringify(verdict)} trailing prose`)).toEqual(verdict);
  });

  it('preserves direct and fenced object parsing', () => {
    const json = '{"result":"correct","confidence":0.9}';
    expect(parseJsonObject(json)).toEqual({ result: 'correct', confidence: 0.9 });
    expect(parseJsonObject(`A 6'5" player.\n\`\`\`json\n${json}\n\`\`\``))
      .toEqual({ result: 'correct', confidence: 0.9 });
  });

  it('does not salvage an inner object from truncated or malformed output', () => {
    expect(parseJsonObject('Verdict: {"drop_indices":[0],"reasons":{"0":"why"}')).toBeNull();
    expect(parseJsonObject('Verdict: {"reasons":{"0":"why"}, broken}')).toBeNull();
    expect(parseJsonObject('No JSON at all, just a 6\'5" player.')).toBeNull();
  });

  it('preserves selection of the first balanced object', () => {
    expect(parseJsonObject('First {"result":"wrong"}, then {"result":"correct"}'))
      .toEqual({ result: 'wrong' });
    expect(parseJsonObject('First {invalid}, then {"result":"correct"}')).toBeNull();
  });
});
