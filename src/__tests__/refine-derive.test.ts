import { describe, expect, it } from 'vitest';

import type { QueueSlot } from '@/server/daily/types';
import {
  deriveDifficultyEscalation,
  deriveFriendExpansion,
  deriveStrugglePruning,
  type MissStreak,
} from '@/server/refine/derive';
import { selectRefineCandidates } from '@/server/refine/select';
import { openText, resolvedText, subdomainLabel } from '@/server/refine/copy';
import { pruningThreshold, refineItemKey, type RefineCandidate } from '@/server/refine/types';

function slot(overrides: Partial<QueueSlot>): QueueSlot {
  return {
    slot_index: 0,
    source: 'bot',
    domain: 'general',
    question_text: 'q',
    answered: true,
    ...overrides,
  };
}

describe('deriveFriendExpansion', () => {
  it('fires for a correct answer on an un-owned friend bonus slot', () => {
    const slots = [
      slot({
        slot_index: 5,
        presence_source_id: 'friend-1',
        presence_source_name: 'Robyn',
        domain: 'subprime_mortgage',
        answer_state: 'correct',
      }),
    ];
    const out = deriveFriendExpansion(slots, new Set());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: 'friend_expansion',
      subdomainId: 'subprime_mortgage',
      subdomainLabel: 'subprime mortgage',
      friendId: 'friend-1',
      friendName: 'Robyn',
    });
  });

  it('does not fire when the player already owns the subdomain', () => {
    const slots = [slot({ presence_source_id: 'f1', domain: 'Jazz', answer_state: 'correct' })];
    expect(deriveFriendExpansion(slots, new Set(['jazz']))).toHaveLength(0);
  });

  it('does not fire on an incorrect answer or a non-bonus slot', () => {
    const incorrectBonus = slot({
      presence_source_id: 'f1',
      domain: 'Jazz',
      answer_state: 'incorrect',
    });
    const nonBonusCorrect = slot({ domain: 'Jazz', answer_state: 'correct' });
    expect(deriveFriendExpansion([incorrectBonus, nonBonusCorrect], new Set())).toHaveLength(0);
  });

  it('dedupes to one candidate per (subdomain, friend)', () => {
    const slots = [
      slot({ slot_index: 1, presence_source_id: 'f1', domain: 'Jazz', answer_state: 'correct' }),
      slot({ slot_index: 2, presence_source_id: 'f1', domain: 'Jazz', answer_state: 'correct' }),
    ];
    expect(deriveFriendExpansion(slots, new Set())).toHaveLength(1);
  });
});

describe('deriveDifficultyEscalation', () => {
  it('fires once per domain that stepped up this daily', () => {
    const slots = [
      slot({ slot_index: 1, domain: 'derivatives', difficulty_stepped_up: true }),
      slot({ slot_index: 2, domain: 'derivatives', difficulty_stepped_up: true }),
      slot({ slot_index: 3, domain: 'opera', difficulty_stepped_up: false }),
    ];
    const out = deriveDifficultyEscalation(slots);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'difficulty_escalation', subdomainId: 'derivatives' });
  });
});

describe('pruningThreshold + deriveStrugglePruning', () => {
  it('uses tiered thresholds 2/3/4', () => {
    expect(pruningThreshold('accessible')).toBe(2);
    expect(pruningThreshold('moderate')).toBe(3);
    expect(pruningThreshold('specialist')).toBe(4);
  });

  it('fires only when the run reaches the latest-miss tier threshold', () => {
    const streaks: MissStreak[] = [
      { subdomainId: 'a', subdomainLabel: 'a', count: 2, latestMissTier: 'accessible' }, // 2 >= 2 → fire
      { subdomainId: 'b', subdomainLabel: 'b', count: 2, latestMissTier: 'moderate' }, // 2 < 3 → no
      { subdomainId: 'c', subdomainLabel: 'c', count: 4, latestMissTier: 'specialist' }, // 4 >= 4 → fire
      { subdomainId: 'd', subdomainLabel: 'd', count: 3, latestMissTier: 'specialist' }, // 3 < 4 → no
    ];
    const fired = deriveStrugglePruning(streaks).map((c) => c.subdomainId);
    expect(fired).toEqual(['a', 'c']);
  });

  it('carries the miss count for evidence copy', () => {
    const out = deriveStrugglePruning([
      { subdomainId: 'x', subdomainLabel: 'x', count: 4, latestMissTier: 'moderate' },
    ]);
    expect(out[0].missCount).toBe(4);
  });
});

describe('selectRefineCandidates', () => {
  const friend: RefineCandidate = {
    type: 'friend_expansion',
    subdomainId: 'a',
    subdomainLabel: 'a',
    friendId: 'f1',
  };
  const escalation: RefineCandidate = {
    type: 'difficulty_escalation',
    subdomainId: 'b',
    subdomainLabel: 'b',
  };
  const pruning: RefineCandidate = {
    type: 'struggle_pruning',
    subdomainId: 'c',
    subdomainLabel: 'c',
  };

  it('orders by priority friend → escalation → pruning', () => {
    const out = selectRefineCandidates([pruning, escalation, friend], new Set());
    expect(out.map((c) => c.type)).toEqual([
      'friend_expansion',
      'difficulty_escalation',
      'struggle_pruning',
    ]);
  });

  it('drops candidates whose key is in cooldown', () => {
    const cooldowns = new Set([refineItemKey('friend_expansion', 'a', 'f1')]);
    const out = selectRefineCandidates([friend, escalation], cooldowns);
    expect(out.map((c) => c.type)).toEqual(['difficulty_escalation']);
  });

  it('keeps at most three, filling by priority', () => {
    const extras: RefineCandidate[] = [
      { type: 'struggle_pruning', subdomainId: 'p1', subdomainLabel: 'p1' },
      { type: 'struggle_pruning', subdomainId: 'p2', subdomainLabel: 'p2' },
    ];
    const out = selectRefineCandidates([friend, escalation, pruning, ...extras], new Set());
    expect(out).toHaveLength(3);
    // pruning items are lowest priority — the last slot is a pruning item, the
    // two pruning extras are sliced off.
    expect(out.map((c) => c.type)).toEqual([
      'friend_expansion',
      'difficulty_escalation',
      'struggle_pruning',
    ]);
  });

  it('keeps both candidates when one subdomain qualifies for two types', () => {
    const dualEscalation: RefineCandidate = {
      type: 'difficulty_escalation',
      subdomainId: 'dual',
      subdomainLabel: 'dual',
    };
    const dualPruning: RefineCandidate = {
      type: 'struggle_pruning',
      subdomainId: 'dual',
      subdomainLabel: 'dual',
    };
    const out = selectRefineCandidates([dualPruning, dualEscalation], new Set());
    expect(out.map((c) => c.type)).toEqual(['difficulty_escalation', 'struggle_pruning']);
  });
});

describe('copy', () => {
  it('formats the subdomain label without changing casing', () => {
    expect(subdomainLabel('subprime_mortgage')).toBe('subprime mortgage');
    expect(subdomainLabel('Sondheim')).toBe('Sondheim');
  });

  it('produces the spec evidence + resolved copy', () => {
    const pruning: RefineCandidate = {
      type: 'struggle_pruning',
      subdomainId: 'subprime_mortgage',
      subdomainLabel: 'subprime mortgage',
      missCount: 4,
    };
    expect(openText(pruning)).toBe(
      "You've missed the last 4 subprime mortgage questions. Rest them for now?",
    );
    expect(resolvedText(pruning)).toBe(
      "Moving subprime mortgage to Never for now — it won't be asked.",
    );

    const escalation: RefineCandidate = {
      type: 'difficulty_escalation',
      subdomainId: 'finance_derivatives',
      subdomainLabel: 'finance derivatives',
    };
    expect(resolvedText(escalation)).toBe(
      "We'll keep finance derivatives at this level for the next month.",
    );
  });
});
