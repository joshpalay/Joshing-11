import { describe, expect, it } from 'vitest';

import {
  CONVERGENCE_THRESHOLD,
  deriveConvergences,
  type ConvergenceCoCorrectRow,
} from '@/lib/convergence';
import {
  CONVERGENCE_SINGLE_TOPIC,
  CONVERGENCE_NO_TOPIC,
  convergenceCaptionTemplate,
} from '@/lib/lately';

const DAY = 24 * 60 * 60 * 1000;
const BASE = Date.UTC(2026, 0, 1);
const day = (n: number) => new Date(BASE + n * DAY);

function row(
  questionId: string,
  viewerDay: number,
  friendDay: number,
  friendId = 'F',
): ConvergenceCoCorrectRow {
  return {
    friendId,
    friendName: 'Robyn Friend',
    friendFirstName: 'Robyn',
    questionId,
    viewerAnsweredAt: day(viewerDay),
    friendAnsweredAt: day(friendDay),
  };
}

describe('deriveConvergences — firing threshold', () => {
  it('does not fire below 3 co-correct questions', () => {
    const rows = [row('q1', 0, 2), row('q2', 1, 3)];
    expect(deriveConvergences('V', rows)).toEqual([]);
  });

  it('fires exactly at 3 (N > 2)', () => {
    // Viewer answered each before the friend, so the friend's answer is the
    // qualifying (co-correct) moment and the viewer owns the cluster.
    const rows = [row('q1', 0, 3), row('q2', 0, 5), row('q3', 0, 7)];
    const out = deriveConvergences('V', rows);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('same_correct');
    expect(out[0].questionIds.sort()).toEqual(['q1', 'q2', 'q3']);
    // sortAt = the cluster-completing question's qualifying moment (day 7).
    expect(out[0].sortAt).toEqual(day(7));
    expect(CONVERGENCE_THRESHOLD).toBe(3);
  });

  it('does not let a duplicate question inflate toward the threshold', () => {
    const rows = [row('q1', 0, 3), row('q2', 0, 5), row('q1', 0, 6)];
    expect(deriveConvergences('V', rows)).toEqual([]);
  });
});

describe('deriveConvergences — 14-day cluster window', () => {
  it('counts 3 questions spanning exactly 14 days', () => {
    const rows = [row('q1', 0, 0), row('q2', 0, 7), row('q3', 0, 14)];
    const out = deriveConvergences('V', rows);
    expect(out).toHaveLength(1);
    expect(out[0].questionIds.sort()).toEqual(['q1', 'q2', 'q3']);
  });

  it('does NOT pad to 3 with questions outside the 14-day span', () => {
    // q1/q2 age out once q3 (>14 days later) arrives, so no cluster of 3 forms
    // even though four questions are co-correct overall.
    const rows = [
      row('q1', 0, 0),
      row('q2', 0, 1),
      row('q3', 0, 20),
      row('q4', 0, 21),
    ];
    expect(deriveConvergences('V', rows)).toEqual([]);
  });
});

describe('deriveConvergences — reset on fire / no reuse', () => {
  it('chunks 6 co-correct into two disjoint clusters, reusing no question', () => {
    const rows = [
      row('q1', 0, 1),
      row('q2', 0, 2),
      row('q3', 0, 3),
      row('q4', 0, 4),
      row('q5', 0, 5),
      row('q6', 0, 6),
    ];
    const out = deriveConvergences('V', rows);
    expect(out).toHaveLength(2);
    const a = new Set(out[0].questionIds);
    const b = new Set(out[1].questionIds);
    // No question appears in two cards.
    for (const id of a) expect(b.has(id)).toBe(false);
    // Together they cover the two fresh chunks of 3.
    const all = [...a, ...b].sort();
    expect(all).toEqual(['q1', 'q2', 'q3', 'q4', 'q5', 'q6']);
    // Each card carries exactly the threshold count.
    expect(out[0].questionIds).toHaveLength(3);
    expect(out[1].questionIds).toHaveLength(3);
  });
});

describe('deriveConvergences — single owner', () => {
  it('fires for exactly one of the pair (whoever answered the 3rd question first)', () => {
    // From V's perspective the friend F answered the cluster-completing question
    // (q3) FIRST (day 8 < day 10), so F owns it and V gets nothing.
    const rowsFromV = [
      row('q1', 1, 2),
      row('q2', 1, 4),
      row('q3', 10, 8), // viewer=day10, friend=day8 -> friend answered q3 first
    ];
    expect(deriveConvergences('V', rowsFromV)).toEqual([]);

    // From F's perspective (timestamps swapped, friend is now 'V'), F answered
    // q3 first -> F owns -> exactly one card surfaces.
    const rowsFromF: ConvergenceCoCorrectRow[] = rowsFromV.map((r) => ({
      ...r,
      friendId: 'V',
      viewerAnsweredAt: r.friendAnsweredAt,
      friendAnsweredAt: r.viewerAnsweredAt,
    }));
    expect(deriveConvergences('F', rowsFromF)).toHaveLength(1);
  });
});

describe('convergenceCaptionTemplate — deterministic, person-first, topic-aware', () => {
  it('is stable for a given moment id and drawn from the matching pool', () => {
    const id = 'converge:F:q1_q2_q3';
    // No shared topic → the topic-less pool (3b), stably.
    const noTopic = convergenceCaptionTemplate(id, null);
    expect(convergenceCaptionTemplate(id, null)).toBe(noTopic);
    expect(CONVERGENCE_NO_TOPIC).toContain(noTopic);
    // A shared topic → the single-topic pool (3a), stably, and carries {topic}.
    const single = convergenceCaptionTemplate(id, 'Jazz');
    expect(convergenceCaptionTemplate(id, 'Jazz')).toBe(single);
    expect(CONVERGENCE_SINGLE_TOPIC).toContain(single);
    expect(single).toContain('{topic}');
  });

  it('every caption is person-first via the {Name} token', () => {
    for (const caption of [...CONVERGENCE_SINGLE_TOPIC, ...CONVERGENCE_NO_TOPIC]) {
      expect(caption).toContain('{Name}');
    }
  });

  it('only the single-topic pool names a topic; the topic-less pool never does', () => {
    for (const caption of CONVERGENCE_SINGLE_TOPIC) expect(caption).toContain('{topic}');
    for (const caption of CONVERGENCE_NO_TOPIC) expect(caption).not.toContain('{topic}');
  });
});
