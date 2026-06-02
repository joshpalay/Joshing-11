'use client';

import Link from 'next/link';
import { type MouseEvent } from 'react';

import {
  breadthMilestoneCopy,
  deepMilestoneCopy,
  type LatelyMilestone,
} from '@/lib/lately-milestones';

import { CREAM, FM, FS, INK, INK2, INK3, PAPER, RULE } from './tokens';

type Props = {
  milestone: LatelyMilestone;
  footnoteTime: string;
};

// The click-through plays the friend's LITERAL questions: the seeded play page
// reads an explicit, comma-separated question-id list and re-derives the
// viewer's milestones to authorize it (see getSeededPlayQuestions).
function playHref(questionIds: string[]): string {
  return `/lately/play?q=${encodeURIComponent(questionIds.join(','))}`;
}

export function MilestoneRow({ milestone, footnoteTime }: Props) {
  const title =
    milestone.kind === 'milestone_deep'
      ? deepMilestoneCopy(milestone)
      : breadthMilestoneCopy(milestone);

  function stop(e: MouseEvent) {
    e.stopPropagation();
  }

  const nameLink = (
    <Link
      href={`/users/${milestone.friendId}`}
      onClick={stop}
      style={{
        color: INK,
        textDecoration: 'underline',
        textDecorationColor: INK,
        textUnderlineOffset: 4,
        textDecorationThickness: 1.5,
        cursor: 'pointer',
      }}
    >
      {milestone.friendName}
    </Link>
  );

  return (
    <div
      style={{
        background: PAPER,
        border: `1.5px solid ${RULE}`,
        padding: '14px 18px 12px',
        marginBottom: 14,
      }}
    >
      <div
        style={{
          fontSize: 9,
          fontFamily: FM,
          color: INK3,
          letterSpacing: 2.5,
          marginBottom: 8,
        }}
      >
        MILESTONE
      </div>

      <div
        style={{
          fontSize: 17,
          fontFamily: FS,
          fontWeight: 500,
          color: INK,
          lineHeight: 1.35,
          letterSpacing: -0.2,
          marginBottom: 14,
        }}
      >
        {title}
      </div>

      {/* Click-through. Deep → one button playing that domain's literal
          questions. Breadth → the player picks which domain. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {milestone.kind === 'milestone_deep' ? (
          <Link href={playHref(milestone.questionIds)} style={playButtonStyle}>
            PLAY THEIR {milestone.domain.toUpperCase()} →
          </Link>
        ) : (
          milestone.domains.map((d) => (
            <Link key={d.domain} href={playHref(d.questionIds)} style={playButtonStyle}>
              PLAY {d.domain.toUpperCase()} →
            </Link>
          ))
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 9,
          fontFamily: FM,
          color: INK3,
          letterSpacing: 2,
        }}
      >
        <span style={{ letterSpacing: 0.3 }}>{nameLink}</span>
        <span style={{ opacity: 0.5 }}>·</span>
        <span>{footnoteTime}</span>
      </div>
    </div>
  );
}

const playButtonStyle = {
  background: CREAM,
  border: `1.5px solid ${INK}`,
  color: INK,
  fontFamily: FM,
  fontSize: 10,
  letterSpacing: 2,
  padding: '8px 14px',
  cursor: 'pointer',
  boxShadow: `2px 2px 0 ${INK2}`,
  textDecoration: 'none',
} as const;
