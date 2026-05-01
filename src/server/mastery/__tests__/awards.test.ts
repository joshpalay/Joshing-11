import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DifficultyEstimate } from '@/types/db';
import {
  awardAuthorCreditIfEligible,
  awardMasteryPoints,
  creatorMasteryAwardForNthCorrect,
  creatorEarningsFromEmpiricalRate,
  getBasePoints,
  getDifficultyPoints,
} from '@/server/mastery/awards';

describe('mastery awards', () => {
  const question: {
    id: string;
    canonical_subcategory: string;
    broad_category: string;
    llm_difficulty: DifficultyEstimate;
    calibrated_difficulty: DifficultyEstimate;
    correct_count: number;
    asked_count: number;
  } = {
    id: 'q1',
    canonical_subcategory: 'Biology',
    broad_category: 'Science',
    llm_difficulty: 'accessible',
    calibrated_difficulty: 'accessible',
    correct_count: 8,
    asked_count: 10,
  };

  const events: Array<{
    source_type: string;
    answer_id?: string;
    base_points: number;
    weight: number;
    awarded_points: number;
    answer_state: string | null;
  }> = [];
  const masteryBySubcategory = new Map<
    string,
    { total_points: number; tier: 'establishing' | 'familiar' | 'solid' | 'mastery' }
  >();

  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'q1' }]),
    question: {
      findUnique: vi.fn(),
      count: vi.fn().mockResolvedValue(3),
    },
    answer: {
      count: vi.fn(),
    },
    masteryEvent: {
      create: vi.fn().mockImplementation(
        async ({
          data,
        }: {
          data: {
            source_type: string;
            answer_id?: string;
            base_points: number;
            weight: number;
            awarded_points: number;
            answer_state: string | null;
          };
        }) => {
          events.push(data);
          return null;
        }
      ),
      aggregate: vi.fn().mockResolvedValue({ _sum: { awarded_points: 0 } }),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
    },
    playerMastery: {
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { user_id_canonical_subcategory: { canonical_subcategory: string } } }) => {
        const subcategory = where.user_id_canonical_subcategory.canonical_subcategory;
        return masteryBySubcategory.get(subcategory) ?? null;
      }),
      upsert: vi.fn().mockImplementation(
        async ({
          where,
          update,
          create,
        }: {
          where: { user_id_canonical_subcategory: { canonical_subcategory: string } };
          update: { total_points: { increment: number }; tier: 'establishing' | 'familiar' | 'solid' | 'mastery' };
          create: { total_points: number; tier: 'establishing' | 'familiar' | 'solid' | 'mastery' };
        }) => {
          const subcategory = where.user_id_canonical_subcategory.canonical_subcategory;
          const current = masteryBySubcategory.get(subcategory);

          if (current) {
            masteryBySubcategory.set(subcategory, {
              total_points: current.total_points + update.total_points.increment,
              tier: update.tier,
            });
          } else {
            masteryBySubcategory.set(subcategory, {
              total_points: create.total_points,
              tier: create.tier,
            });
          }

          return null;
        }
      ),
    },
  } as const;

  const db = {
    masteryEvent: tx.masteryEvent,
    $transaction: vi.fn().mockImplementation(async (cb: (arg: typeof tx) => Promise<unknown>) => cb(tx)),
  } as never;

  beforeEach(() => {
    events.length = 0;
    masteryBySubcategory.clear();
    question.calibrated_difficulty = 'accessible';
    question.correct_count = 8;
    question.asked_count = 10;
    vi.clearAllMocks();
    tx.question.findUnique.mockImplementation(async () => ({ ...question }));
    tx.$queryRaw.mockResolvedValue([{ id: 'q1' }]);
    tx.answer.count.mockImplementation(async ({ where }: { where: { result?: 'correct' } }) =>
      where.result === 'correct' ? question.correct_count : question.asked_count
    );
    tx.masteryEvent.findFirst.mockResolvedValue(null);
    tx.masteryEvent.aggregate.mockResolvedValue({ _sum: { awarded_points: 0 } });
    tx.masteryEvent.count.mockResolvedValue(0);
    tx.masteryEvent.groupBy.mockResolvedValue([]);
  });

  it('maps portrait difficulty weights for accessible/moderate/specialist', () => {
    expect(getDifficultyPoints('accessible')).toBe(1);
    expect(getDifficultyPoints('moderate')).toBe(2);
    expect(getDifficultyPoints('specialist')).toBe(3);
  });

  it('getBasePoints follows §8.32 tables', () => {
    expect(getBasePoints('moderate', 'first_correct')).toBe(50);
    expect(getBasePoints('moderate', 'first_correct_after_wrong')).toBe(13);
    expect(getBasePoints('moderate', 'repeat_correct')).toBe(0);
  });

  it('creator earnings use empirical buckets with medium default', () => {
    expect(creatorEarningsFromEmpiricalRate(8, 10)).toBe(25);
    expect(creatorEarningsFromEmpiricalRate(5, 10)).toBe(50);
    expect(creatorEarningsFromEmpiricalRate(2, 10)).toBe(100);
    expect(creatorEarningsFromEmpiricalRate(0, 0)).toBe(50);
  });

  it('creator mastery diminishing returns + cap uses easy/medium/hard windows', () => {
    expect(creatorMasteryAwardForNthCorrect(8, 10, 1)).toMatchObject({ basePoints: 25, weight: 1, awardedPoints: 25 });
    expect(creatorMasteryAwardForNthCorrect(8, 10, 2)).toMatchObject({ basePoints: 25, weight: 1, awardedPoints: 25 });
    expect(creatorMasteryAwardForNthCorrect(8, 10, 3)).toMatchObject({ basePoints: 25, weight: 0.5, awardedPoints: 13 });
    expect(creatorMasteryAwardForNthCorrect(8, 10, 4)).toMatchObject({ basePoints: 25, weight: 0.5, awardedPoints: 13 });
    expect(creatorMasteryAwardForNthCorrect(8, 10, 5)).toMatchObject({ basePoints: 25, weight: 0, awardedPoints: 0 });

    expect(creatorMasteryAwardForNthCorrect(5, 10, 3)).toMatchObject({ basePoints: 50, weight: 1, awardedPoints: 50 });
    expect(creatorMasteryAwardForNthCorrect(5, 10, 6)).toMatchObject({ basePoints: 50, weight: 0.5, awardedPoints: 25 });
    expect(creatorMasteryAwardForNthCorrect(5, 10, 7)).toMatchObject({ basePoints: 50, weight: 0, awardedPoints: 0 });

    expect(creatorMasteryAwardForNthCorrect(2, 10, 5)).toMatchObject({ basePoints: 100, weight: 1, awardedPoints: 100 });
    expect(creatorMasteryAwardForNthCorrect(2, 10, 10)).toMatchObject({ basePoints: 100, weight: 0.5, awardedPoints: 50 });
    expect(creatorMasteryAwardForNthCorrect(2, 10, 11)).toMatchObject({ basePoints: 100, weight: 0, awardedPoints: 0 });
  });

  it('writes authored event with first_correct-equivalent base and weight 1', async () => {
    await awardMasteryPoints(db, {
      userId: 'u1',
      questionId: 'q1',
      sourceType: 'authored',
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source_type: 'authored',
      base_points: 10,
      weight: 1,
      awarded_points: 10,
      answer_state: null,
    });
  });

  it('writes live_correct with full base and weight 1', async () => {
    await awardMasteryPoints(db, {
      userId: 'u1',
      questionId: 'q1',
      sourceType: 'live_correct',
      answerState: 'first_correct',
      answerId: 'answer-live',
    });

    expect(events[0]).toMatchObject({
      source_type: 'live_correct',
      answer_id: 'answer-live',
      base_points: 10,
      weight: 1,
      awarded_points: 10,
      answer_state: 'first_correct',
    });
  });

  it('writes catchup_correct with weight 0.25 and rounded points', async () => {
    question.calibrated_difficulty = 'moderate';
    await awardMasteryPoints(db, {
      userId: 'u1',
      questionId: 'q1',
      sourceType: 'catchup_correct',
      answerState: 'first_correct',
    });

    expect(events[0]).toMatchObject({
      source_type: 'catchup_correct',
      base_points: 50,
      weight: 0.25,
      awarded_points: 13,
      answer_state: 'first_correct',
    });
  });

  it('awards author_credit exactly once per question/answerer and excludes ineligible cases', async () => {
    tx.question.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === 'q-accessible' ? { ...question, id: 'q-accessible' } : { ...question }
    );
    tx.masteryEvent.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'existing' })
      .mockResolvedValue(null);
    tx.masteryEvent.groupBy.mockResolvedValue([{ question_id: 'q1' }]);

    const first = await awardAuthorCreditIfEligible(db, {
      questionId: 'q1',
      questionAuthorId: 'author-1',
      answeredByUserId: 'answerer-1',
      answerResult: 'correct',
      isCatchUp: false,
      difficulty: 'moderate',
    });
    expect(first.awarded).toBe(true);

    const duplicate = await awardAuthorCreditIfEligible(db, {
      questionId: 'q1',
      questionAuthorId: 'author-1',
      answeredByUserId: 'answerer-1',
      answerResult: 'correct',
      isCatchUp: false,
      difficulty: 'moderate',
    });
    expect(duplicate).toMatchObject({ awarded: false, reason: 'duplicate' });

    const accessibleOk = await awardAuthorCreditIfEligible(db, {
      questionId: 'q-accessible',
      questionAuthorId: 'author-1',
      answeredByUserId: 'answerer-access',
      answerResult: 'correct',
      isCatchUp: false,
      difficulty: 'accessible',
    });
    expect(accessibleOk.awarded).toBe(true);

    await expect(
      awardAuthorCreditIfEligible(db, {
        questionId: 'q1',
        questionAuthorId: 'author-1',
        answeredByUserId: 'answerer-1',
        answerResult: 'correct',
        isCatchUp: true,
        difficulty: 'specialist',
      })
    ).resolves.toMatchObject({ awarded: false, reason: 'catch_up' });

    await expect(
      awardAuthorCreditIfEligible(db, {
        questionId: 'q1',
        questionAuthorId: 'author-1',
        answeredByUserId: 'author-1',
        answerResult: 'correct',
        isCatchUp: false,
        difficulty: 'specialist',
      })
    ).resolves.toMatchObject({ awarded: false, reason: 'self_answer' });

    const authorCreditEvents = events.filter((event) => event.source_type === 'author_credit');
    expect(authorCreditEvents).toHaveLength(2);
    for (const event of authorCreditEvents) {
      expect(event.answer_id).toBeUndefined();
    }
  });

  it('caps author_credit mastery after max counted correct answers while allowing analytics elsewhere', async () => {
    question.correct_count = 8;
    question.asked_count = 10;
    tx.masteryEvent.count.mockResolvedValue(4);

    const result = await awardAuthorCreditIfEligible(db, {
      questionId: 'q1',
      questionAuthorId: 'author-1',
      answeredByUserId: 'answerer-over-cap',
      answerResult: 'correct',
      isCatchUp: false,
      difficulty: 'moderate',
    });

    expect(result).toMatchObject({ awarded: false });
    expect(events.filter((event) => event.source_type === 'author_credit')).toHaveLength(0);
    expect(tx.$queryRaw).toHaveBeenCalled();
  });

  it('uses reduced 50% creator mastery credit inside the reduced window', async () => {
    question.correct_count = 8;
    question.asked_count = 10;
    tx.masteryEvent.count.mockResolvedValue(2); // next counted correct is #3 (easy => half credit)

    const result = await awardAuthorCreditIfEligible(db, {
      questionId: 'q1',
      questionAuthorId: 'author-1',
      answeredByUserId: 'answerer-3',
      answerResult: 'correct',
      isCatchUp: false,
      difficulty: 'moderate',
    });

    expect(result).toMatchObject({ awarded: true });
    const authorCreditEvents = events.filter((event) => event.source_type === 'author_credit');
    expect(authorCreditEvents).toHaveLength(1);
    expect(authorCreditEvents[0]).toMatchObject({
      base_points: 25,
      weight: 0.5,
      awarded_points: 13,
    });
  });

  it('uses live in-tx answer aggregates at the 0.7 boundary (not stale Question snapshot)', async () => {
    question.correct_count = 8;
    question.asked_count = 10; // stale snapshot would imply > 0.7 and 25-base
    tx.answer.count
      .mockResolvedValueOnce(10) // askedCount
      .mockResolvedValueOnce(7); // correctCount => exactly 0.7 => 50-base bucket

    const result = await awardAuthorCreditIfEligible(db, {
      questionId: 'q1',
      questionAuthorId: 'author-1',
      answeredByUserId: 'answerer-threshold-07',
      answerResult: 'correct',
      isCatchUp: false,
      difficulty: 'moderate',
    });

    expect(result).toMatchObject({ awarded: true });
    const authorCreditEvents = events.filter((event) => event.source_type === 'author_credit');
    expect(authorCreditEvents).toHaveLength(1);
    expect(authorCreditEvents[0]).toMatchObject({
      base_points: 50,
      weight: 1,
      awarded_points: 50,
    });
  });

  it('uses live in-tx answer aggregates at the 0.4 boundary (deterministic post-answer behavior)', async () => {
    question.correct_count = 2;
    question.asked_count = 10; // stale snapshot would imply < 0.4 and 100-base
    tx.answer.count
      .mockResolvedValueOnce(10) // askedCount
      .mockResolvedValueOnce(4); // correctCount => exactly 0.4 => 50-base bucket

    const result = await awardAuthorCreditIfEligible(db, {
      questionId: 'q1',
      questionAuthorId: 'author-1',
      answeredByUserId: 'answerer-threshold-04',
      answerResult: 'correct',
      isCatchUp: false,
      difficulty: 'moderate',
    });

    expect(result).toMatchObject({ awarded: true });
    const authorCreditEvents = events.filter((event) => event.source_type === 'author_credit');
    expect(authorCreditEvents).toHaveLength(1);
    expect(authorCreditEvents[0]).toMatchObject({
      base_points: 50,
      weight: 1,
      awarded_points: 50,
    });
  });
});
