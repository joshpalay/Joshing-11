import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';

vi.mock('@/server/db', () => ({ pool: {} }));
vi.mock('../grade', () => ({ gradeCassianAnswer: vi.fn() }));
import { alreadySeen, publicCard } from '../review';

const candidate = {
  id: 'a'.repeat(32), domain: 'Test domain', breadth: 'niche', difficulty: 'moderate',
  question_text: 'What happened?', answer: 'A private key', acceptable_variants: [],
  explainer: 'Private explanation', fact_key: 'private-fact', model: 'private-model',
  arm: 'baseline', machine_status: 'held', checks: { quality: { drop: true } },
  run_id: 'test-run',
};

describe('Cassian card reveal boundary', () => {
  it('hides key, model, fact and gate before an answer', () => {
    const card = publicCard(candidate);
    expect(card).toEqual({
      id: candidate.id, domain: 'Test domain', breadth: 'niche',
      difficulty: 'moderate', questionText: 'What happened?',
    });
    expect(JSON.stringify(card)).not.toContain('private');
  });

  it('reveals answer after an attempt but still hides model and gate', () => {
    const card = publicCard({ ...candidate, answer_text: 'A private key',
      grade: { result: 'correct', via: 'exact_or_variant' } });
    expect(card.reveal?.answer).toBe('A private key');
    expect(JSON.stringify(card)).not.toContain('private-model');
    expect(JSON.stringify(card)).not.toContain('private-fact');
    expect(JSON.stringify(card)).not.toContain('held');
  });
});

describe('Cassian exposure checks', () => {
  it('checks uncapped prior surfaces and excludes a same-answer paraphrase', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ seen: false }] })
      .mockResolvedValueOnce({ rows: [{ answer: 'The Private Key' }] });
    const seen = await alreadySeen({ query } as unknown as PoolClient, 'admin', candidate);
    expect(seen).toBe(true);
    const firstSql = String(query.mock.calls[0][0]);
    expect(firstSql).toContain('"GeneratedQuestion"');
    expect(firstSql).toContain('"MASTERY_EVENTS"');
    expect(firstSql).toContain('"FeedItem"');
    expect(firstSql).toContain('"CassianReview"');
    expect(firstSql).not.toMatch(/\bLIMIT\b/);
  });
});
