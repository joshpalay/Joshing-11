import { describe, expect, it } from 'vitest';

import {
  breadthMilestoneCopy,
  collectMilestoneQuestionIds,
  deriveLatelyMilestones,
  deepMilestoneCopy,
  MILESTONE_DEEP_MIN,
  type LatelyMilestone,
  type MilestoneAnswerRow,
  type MilestoneBreadth,
  type MilestoneDeep,
} from '@/lib/lately-milestones';

let seq = 0;
function row(overrides: Partial<MilestoneAnswerRow> = {}): MilestoneAnswerRow {
  seq += 1;
  return {
    friendId: 'f-robyn',
    friendName: 'Robyn Hitchcock',
    friendFirstName: 'Robyn',
    domain: 'music',
    questionId: `q-${seq}`,
    answeredAt: new Date('2026-05-20T12:00:00.000Z'),
    ...overrides,
  };
}

// Build N correct answers in one (friend, domain) group, each a distinct question.
function group(count: number, over: Partial<MilestoneAnswerRow> = {}): MilestoneAnswerRow[] {
  return Array.from({ length: count }, () => row(over));
}

const isDeep = (m: LatelyMilestone): m is MilestoneDeep => m.kind === 'milestone_deep';
const isBreadth = (m: LatelyMilestone): m is MilestoneBreadth => m.kind === 'milestone_breadth';

describe('deriveLatelyMilestones — deep cards', () => {
  it('fires a deep card at exactly the deep threshold', () => {
    const milestones = deriveLatelyMilestones(group(MILESTONE_DEEP_MIN, { domain: 'jazz' }));
    const deep = milestones.filter(isDeep);
    expect(deep).toHaveLength(1);
    expect(deep[0].domain).toBe('jazz');
    expect(deep[0].correctCount).toBe(MILESTONE_DEEP_MIN);
    expect(deep[0].questionIds).toHaveLength(MILESTONE_DEEP_MIN);
  });

  it('does not fire a deep card below the threshold', () => {
    const milestones = deriveLatelyMilestones(group(MILESTONE_DEEP_MIN - 1, { domain: 'jazz' }));
    expect(milestones.filter(isDeep)).toHaveLength(0);
  });

  it('dedupes repeated questionIds so a re-answer cannot reach the deep threshold', () => {
    const rows: MilestoneAnswerRow[] = [
      row({ domain: 'jazz', questionId: 'q-a' }),
      row({ domain: 'jazz', questionId: 'q-a' }),
      row({ domain: 'jazz', questionId: 'q-a' }),
    ];
    // 3 rows but only 1 distinct question → light, not deep → and a lone light
    // domain produces no card at all.
    expect(deriveLatelyMilestones(rows)).toHaveLength(0);
  });
});

describe('deriveLatelyMilestones — breadth cards', () => {
  it('rolls up ≥2 light domains into one breadth card', () => {
    const milestones = deriveLatelyMilestones([
      ...group(2, { domain: 'music' }),
      ...group(1, { domain: 'film & tv' }),
    ]);
    const breadth = milestones.filter(isBreadth);
    expect(breadth).toHaveLength(1);
    expect(breadth[0].domains.map((d) => d.domain).sort()).toEqual(['film & tv', 'music']);
  });

  it('renders no card for a single light domain (neither deep nor breadth)', () => {
    expect(deriveLatelyMilestones(group(2, { domain: 'music' }))).toHaveLength(0);
    expect(deriveLatelyMilestones(group(1, { domain: 'music' }))).toHaveLength(0);
  });

  it('excludes deep domains from the breadth roll-up — no answer double-counted', () => {
    const milestones = deriveLatelyMilestones([
      ...group(MILESTONE_DEEP_MIN, { domain: 'music' }), // deep
      ...group(2, { domain: 'history' }), // light
      ...group(1, { domain: 'science' }), // light
    ]);
    const deep = milestones.filter(isDeep);
    const breadth = milestones.filter(isBreadth);
    expect(deep.map((d) => d.domain)).toEqual(['music']);
    expect(breadth).toHaveLength(1);
    const breadthDomains = breadth[0].domains.map((d) => d.domain).sort();
    expect(breadthDomains).toEqual(['history', 'science']);
    expect(breadthDomains).not.toContain('music');
  });

  it('a deep domain plus one light domain yields a deep card and no breadth card', () => {
    const milestones = deriveLatelyMilestones([
      ...group(MILESTONE_DEEP_MIN, { domain: 'music' }),
      ...group(2, { domain: 'history' }),
    ]);
    expect(milestones.filter(isDeep)).toHaveLength(1);
    expect(milestones.filter(isBreadth)).toHaveLength(0);
  });

  it('orders breadth domains most-recent first', () => {
    const milestones = deriveLatelyMilestones([
      ...group(1, { domain: 'old', answeredAt: new Date('2026-05-10T00:00:00.000Z') }),
      ...group(1, { domain: 'new', answeredAt: new Date('2026-05-25T00:00:00.000Z') }),
    ]);
    const breadth = milestones.filter(isBreadth);
    expect(breadth[0].domains.map((d) => d.domain)).toEqual(['new', 'old']);
  });
});

describe('deriveLatelyMilestones — multiple friends', () => {
  it('keeps each friend independent', () => {
    const milestones = deriveLatelyMilestones([
      ...group(MILESTONE_DEEP_MIN, { friendId: 'f-a', friendFirstName: 'A', domain: 'music' }),
      ...group(2, { friendId: 'f-b', friendFirstName: 'B', domain: 'history' }),
      ...group(2, { friendId: 'f-b', friendFirstName: 'B', domain: 'science' }),
    ]);
    expect(milestones.filter(isDeep).map((d) => d.friendId)).toEqual(['f-a']);
    expect(milestones.filter(isBreadth).map((b) => b.friendId)).toEqual(['f-b']);
  });
});

describe('collectMilestoneQuestionIds', () => {
  it('unions every playable questionId across cards', () => {
    const milestones = deriveLatelyMilestones([
      row({ domain: 'music', questionId: 'q1' }),
      row({ domain: 'music', questionId: 'q2' }),
      row({ domain: 'history', questionId: 'q3' }),
    ]);
    expect([...collectMilestoneQuestionIds(milestones)].sort()).toEqual(['q1', 'q2', 'q3']);
  });
});

describe('milestone copy (placeholders)', () => {
  it('deep copy avoids "mastery" and names the domain', () => {
    const [deep] = deriveLatelyMilestones(group(MILESTONE_DEEP_MIN, { domain: 'jazz' })).filter(isDeep);
    const copy = deepMilestoneCopy(deep);
    expect(copy).toBe('Robyn went deep on jazz');
    expect(copy.toLowerCase()).not.toContain('master');
  });

  it('breadth copy lists two domains then "+N more"', () => {
    const [breadth] = deriveLatelyMilestones([
      ...group(1, { domain: 'a', answeredAt: new Date('2026-05-25T00:00:00.000Z') }),
      ...group(1, { domain: 'b', answeredAt: new Date('2026-05-24T00:00:00.000Z') }),
      ...group(1, { domain: 'c', answeredAt: new Date('2026-05-23T00:00:00.000Z') }),
    ]).filter(isBreadth);
    expect(breadthMilestoneCopy(breadth)).toBe("Robyn's been killing it — a, b, and 1 more");
  });

  it('breadth copy with exactly two domains reads "a and b"', () => {
    const [breadth] = deriveLatelyMilestones([
      ...group(1, { domain: 'a', answeredAt: new Date('2026-05-25T00:00:00.000Z') }),
      ...group(1, { domain: 'b', answeredAt: new Date('2026-05-24T00:00:00.000Z') }),
    ]).filter(isBreadth);
    expect(breadthMilestoneCopy(breadth)).toBe("Robyn's been killing it — a and b");
  });
});
