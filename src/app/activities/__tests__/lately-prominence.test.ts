import { describe, expect, it } from 'vitest';

import { filterUtilityActivities } from '@/app/activities/filter-utility-activities';
import {
  LATELY_TIER,
  latelyTierForMomentDir,
  sortByProminence,
} from '@/lib/lately';
import type { LatelyMilestone } from '@/lib/lately-milestones';
import type { ActivityItemView } from '@/server/db/queries/activity';
import type { LatelyMoment } from '@/server/db/queries/lately';

// --- Builders -------------------------------------------------------------

function theyGotYouMoment(questionId: string, answeredAt: string): LatelyMoment {
  return {
    momentId: `tgyou-${questionId}`,
    dir: 'they_got_you',
    friendId: 'friend-1',
    friendName: 'Robyn',
    friendFirstName: 'Robyn',
    questionId,
    questionText: 'q?',
    category: 'music',
    gameTitle: 'asterisk',
    answeredAt: new Date(answeredAt),
  };
}

function youGotThemMoment(questionId: string, answeredAt: string): LatelyMoment {
  return { ...theyGotYouMoment(questionId, answeredAt), momentId: `ygt-${questionId}`, dir: 'you_got_them' };
}

function friendAnsweredYourQuestion(
  id: string,
  questionId: string,
  result: 'correct' | 'incorrect',
): ActivityItemView {
  return {
    id,
    userId: 'viewer-1',
    type: 'friend_answered_your_question',
    actorUserId: 'friend-1',
    referenceId: questionId,
    referenceType: 'question',
    read: false,
    createdAt: new Date('2026-05-24T12:00:00.000Z'),
    actor: { displayName: 'Robyn' },
    reference: { friendAnsweredQuestion: { domain: 'music', questionText: null, result } },
  };
}

function nicheMatchActivity(id: string, createdAt: string): ActivityItemView {
  return {
    id,
    userId: 'viewer-1',
    type: 'niche_match_answered_your_question',
    actorUserId: 'stranger-1',
    referenceId: 'qnm',
    referenceType: 'question',
    read: false,
    createdAt: new Date(createdAt),
    actor: { displayName: 'A stranger' },
    reference: { nicheMatch: { domain: 'jazz', questionText: 'q' } },
  };
}

function deepMilestone(id: string, sortAt: string): LatelyMilestone {
  return {
    kind: 'milestone_deep',
    id,
    friendId: 'friend-2',
    friendName: 'Sam',
    friendFirstName: 'Sam',
    domain: 'jazz',
    questionIds: ['q1', 'q2', 'q3'],
    correctCount: 3,
    sortAt: new Date(sortAt),
  };
}

// --- Feed assembler (mirrors src/app/activities/page.tsx tiering) ----------

type TestFeedItem = {
  kind: 'moment' | 'milestone' | 'utility';
  id: string;
  sortAt: Date;
  tier: number;
  questionId?: string;
};

function tierForActivity(type: ActivityItemView['type']): number {
  return type === 'niche_match_answered_your_question' || type === 'niche_match_you_answered'
    ? LATELY_TIER.NICHE_MATCH
    : LATELY_TIER.OTHER;
}

function buildFeed(input: {
  activities: ActivityItemView[];
  moments: LatelyMoment[];
  milestones: LatelyMilestone[];
}): TestFeedItem[] {
  const utility: TestFeedItem[] = filterUtilityActivities(input.activities, input.moments).map((a) => ({
    kind: 'utility',
    id: a.id,
    sortAt: a.createdAt,
    tier: tierForActivity(a.type),
    questionId: a.referenceId ?? undefined,
  }));
  const moments: TestFeedItem[] = input.moments.map((m) => ({
    kind: 'moment',
    id: m.momentId,
    sortAt: m.answeredAt,
    tier: latelyTierForMomentDir(m.dir),
    questionId: m.questionId,
  }));
  const milestones: TestFeedItem[] = input.milestones.map((m) => ({
    kind: 'milestone',
    id: m.id,
    sortAt: m.sortAt,
    tier: LATELY_TIER.MILESTONE,
  }));
  return sortByProminence([...moments, ...milestones, ...utility]);
}

// --- Tests ----------------------------------------------------------------

describe('Lately prominence tiers (D-4 §C)', () => {
  it('a flood of more-recent milestones never buries a they_got_you moment or niche-match', () => {
    const moment = theyGotYouMoment('q-authored', '2026-05-24T08:00:00.000Z'); // earlier in the day
    const niche = nicheMatchActivity('nm-1', '2026-05-24T09:00:00.000Z');
    // 20 milestones, all MORE recent than the moment/niche.
    const milestones = Array.from({ length: 20 }, (_, i) =>
      deepMilestone(`ms-${i}`, `2026-05-24T1${i % 10}:00:00.000Z`),
    );

    const feed = buildFeed({ activities: [niche], moments: [moment], milestones });

    expect(feed[0].id).toBe(moment.momentId); // they_got_you on top
    const firstMilestoneIdx = feed.findIndex((i) => i.kind === 'milestone');
    const nicheIdx = feed.findIndex((i) => i.id === 'nm-1');
    expect(nicheIdx).toBeLessThan(firstMilestoneIdx); // niche above all milestones
    expect(feed.findIndex((i) => i.id === moment.momentId)).toBeLessThan(nicheIdx);
  });

  it('orders strictly ANSWERED_YOU > NICHE_MATCH > MILESTONE > OTHER', () => {
    const feed = buildFeed({
      activities: [nicheMatchActivity('nm-1', '2026-05-24T09:00:00.000Z')],
      moments: [
        theyGotYouMoment('q-a', '2026-05-24T08:00:00.000Z'),
        youGotThemMoment('q-b', '2026-05-24T23:00:00.000Z'), // newest, but "other"
      ],
      milestones: [deepMilestone('ms-1', '2026-05-24T22:00:00.000Z')],
    });
    expect(feed.map((i) => i.tier)).toEqual([
      LATELY_TIER.ANSWERED_YOU,
      LATELY_TIER.NICHE_MATCH,
      LATELY_TIER.MILESTONE,
      LATELY_TIER.OTHER,
    ]);
  });
});

describe('Lately "answered your question" guarantee (D-4 §C, load-bearing)', () => {
  it('a friend answering my authored question correctly surfaces as a visible they_got_you moment', () => {
    const activity = friendAnsweredYourQuestion('faq-1', 'q-authored', 'correct');
    const moment = theyGotYouMoment('q-authored', '2026-05-24T08:00:00.000Z');

    const feed = buildFeed({ activities: [activity], moments: [moment], milestones: [] });

    const represented = feed.find((i) => i.questionId === 'q-authored');
    expect(represented).toBeTruthy();
    expect(represented?.kind).toBe('moment'); // surfaced via the covering moment
    expect(represented?.tier).toBe(LATELY_TIER.ANSWERED_YOU);
  });

  it('the covering moment is load-bearing: drop it and "answered your question" silently vanishes', () => {
    // filterUtilityActivities dedupes a correct friend_answered_your_question
    // UNCONDITIONALLY — the moment is the only surface that keeps it visible.
    const activity = friendAnsweredYourQuestion('faq-1', 'q-authored', 'correct');

    // Sanity: the activity is deduped whether or not the moment is present.
    expect(filterUtilityActivities([activity], [theyGotYouMoment('q-authored', '2026-05-24T08:00:00.000Z')])).toHaveLength(0);
    expect(filterUtilityActivities([activity], [])).toHaveLength(0);

    // So with the moment dropped, nothing in the feed represents the question —
    // proving the moment must never be removed from getLatelyMoments.
    const feedWithoutMoment = buildFeed({ activities: [activity], moments: [], milestones: [] });
    expect(feedWithoutMoment.find((i) => i.questionId === 'q-authored')).toBeFalsy();
  });
});
