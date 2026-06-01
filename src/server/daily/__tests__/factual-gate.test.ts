import { beforeAll, describe, expect, it } from 'vitest';

// generate-questions.ts imports @/server/db, which throws at module load
// without a connection string. The parser under test never touches the DB;
// a dummy URL plus dynamic import (the repo convention) keeps the unit pure.
let parseFactualGateResponse: typeof import('@/server/daily/generate-questions').parseFactualGateResponse;

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  ({ parseFactualGateResponse } = await import('@/server/daily/generate-questions'));
});

describe('parseFactualGateResponse', () => {
  it('collects in-range drop indices and their reasons', () => {
    const result = parseFactualGateResponse(
      '{"drop_indices":[1],"reasons":{"1":"Rubyfruit Jungle was written by Rita Mae Brown, not Roberta Achtenberg."}}',
      3,
    );
    expect([...result.toDrop]).toEqual([1]);
    expect(result.reasons[1]).toContain('Rita Mae Brown');
  });

  it('ignores out-of-range, non-integer, and negative indices', () => {
    const result = parseFactualGateResponse('{"drop_indices":[5,-1,1.5,0]}', 3);
    expect([...result.toDrop].sort()).toEqual([0]);
  });

  it('drops reasons whose index was not flagged', () => {
    const result = parseFactualGateResponse(
      '{"drop_indices":[0],"reasons":{"0":"wrong","2":"orphan reason"}}',
      3,
    );
    expect(result.reasons).toEqual({ 0: 'wrong' });
  });

  it('returns an empty result for malformed or non-object output', () => {
    for (const raw of ['not json', '[]', '{}', '{"drop_indices":"nope"}']) {
      const result = parseFactualGateResponse(raw, 3);
      expect(result.toDrop.size).toBe(0);
      expect(result.reasons).toEqual({});
    }
  });

  it('truncates very long reason strings', () => {
    const long = 'x'.repeat(500);
    const result = parseFactualGateResponse(`{"drop_indices":[0],"reasons":{"0":"${long}"}}`, 1);
    expect(result.reasons[0].length).toBe(200);
  });
});
