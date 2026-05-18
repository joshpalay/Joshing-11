import { forwardRef, type CSSProperties } from 'react';

import type { MasteryTier } from '@/types/db';

type ShareCardSize = 'square' | 'portrait';

export type ShareCardBeatsPayload = {
  cycleStart: string;
  cycleEnd: string;
  beat1: { domain: string; fromTier: MasteryTier; toTier: MasteryTier }[] | null;
  beat2: {
    friendMediated: { domain: string; questionCount: number; correctCount: number }[];
    authored: { domain: string }[];
    promoted: { domain: string }[];
  } | null;
  beat3: { userId?: string; displayName: string; contributionCount: number }[] | null;
  beat4: { userId?: string; displayName: string; sharedDomains: string[] } | null;
  beat5: { totalCreatorPoints: number; topQuestion: { text: string; answeredCount: number } | null } | null;
};

export type ShareCardProps = {
  beatsPayload: ShareCardBeatsPayload;
  userName: string;
  cycleStart: string;
  cycleEnd: string;
  size?: ShareCardSize;
};

const TIER_LABEL: Record<MasteryTier, string> = {
  establishing: 'Curious',
  familiar: 'Versed',
  solid: 'Fluent',
  mastery: 'Master',
};

const TIER_POINTS: Record<MasteryTier, number> = {
  establishing: 0,
  familiar: 100,
  solid: 1000,
  mastery: 2000,
};

function formatRange(start: string, end: string): string {
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  const monthDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  return `${monthDay.format(startDate)} - ${monthDay.format(endDate)}`;
}

function estimatePoints(payload: ShareCardBeatsPayload): number {
  const masteryPoints = (payload.beat1 ?? []).reduce((sum, beat) => {
    return sum + Math.max(0, TIER_POINTS[beat.toTier] - TIER_POINTS[beat.fromTier]);
  }, 0);
  return Math.round(masteryPoints + (payload.beat5?.totalCreatorPoints ?? 0));
}

function buildHighlights(payload: ShareCardBeatsPayload): string[] {
  const highlights: string[] = [];
  const mastered = payload.beat1?.[0];
  if (mastered) {
    highlights.push(`Crossed into ${TIER_LABEL[mastered.toTier]} in ${mastered.domain}`);
  }

  const discovered = payload.beat2?.friendMediated[0] ?? payload.beat2?.authored[0] ?? payload.beat2?.promoted[0];
  if (discovered) {
    highlights.push(`Picked up ${discovered.domain}`);
  }

  if (payload.beat4) {
    highlights.push(`Closest to ${payload.beat4.displayName}`);
  }

  if (payload.beat5 && highlights.length < 3) {
    highlights.push(`Earned ${payload.beat5.totalCreatorPoints} creator points`);
  }

  if ((payload.beat3?.length ?? 0) > 0 && highlights.length < 3) {
    highlights.push(`Learned from ${payload.beat3![0]!.displayName}`);
  }

  return highlights.slice(0, 3);
}

export const ShareCard = forwardRef<HTMLDivElement, ShareCardProps>(
  function ShareCard({ beatsPayload, userName, cycleStart, cycleEnd, size = 'portrait' }, ref) {
    const points = estimatePoints(beatsPayload);
    const highlights = buildHighlights(beatsPayload);
    const dimensions = size === 'square' ? squareStyle : portraitStyle;

    return (
      <div ref={ref} style={{ ...cardStyle, ...dimensions }}>
        <div style={topStyle}>
          <div>
            <p style={kickerStyle}>JOSHING · TWO WEEKS</p>
            <p style={dateStyle}>{formatRange(cycleStart, cycleEnd)}</p>
          </div>
          <p style={nameStyle}>{userName}</p>
        </div>

        <div style={centerStyle}>
          <p style={pointsStyle}>{points}</p>
          <p style={pointsLabelStyle}>points this cycle</p>
        </div>

        <div style={highlightListStyle}>
          {highlights.length > 0 ? highlights.map((highlight, index) => (
            <div key={highlight} style={highlightRowStyle}>
              <span style={highlightIndexStyle}>{index + 1}</span>
              <p style={highlightTextStyle}>{highlight}</p>
            </div>
          )) : (
            <p style={emptyStyle}>A quiet cycle still counts.</p>
          )}
        </div>

        <div style={footerStyle}>
          <span>joshing.app</span>
          <span style={footerRuleStyle} />
        </div>
      </div>
    );
  },
);

const INK = '#1a1208';
const INK_MUTED = '#766d5f';
const CREAM = '#f5f0e8';
const PAPER = '#fffaf1';
const RULE = '#e1d7c8';
const MONO = "'Courier New', monospace";
const SERIF = "Georgia, 'Times New Roman', serif";

const cardStyle: CSSProperties = {
  background: `linear-gradient(180deg, ${PAPER} 0%, ${CREAM} 100%)`,
  border: `1.5px solid ${INK}`,
  boxShadow: `4px 4px 0 ${INK}`,
  color: INK,
  display: 'flex',
  flexDirection: 'column',
  fontFamily: MONO,
  overflow: 'hidden',
};

const portraitStyle: CSSProperties = {
  width: 360,
  minHeight: 560,
};

const squareStyle: CSSProperties = {
  width: 360,
  minHeight: 360,
};

const topStyle: CSSProperties = {
  alignItems: 'flex-start',
  borderBottom: `1px solid ${RULE}`,
  display: 'flex',
  justifyContent: 'space-between',
  gap: 18,
  padding: '20px 22px 16px',
};

const kickerStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.14em',
  margin: 0,
};

const dateStyle: CSSProperties = {
  color: INK_MUTED,
  fontSize: 11,
  letterSpacing: '0.08em',
  margin: '7px 0 0',
  textTransform: 'uppercase',
};

const nameStyle: CSSProperties = {
  color: INK_MUTED,
  fontSize: 10,
  letterSpacing: '0.12em',
  margin: 0,
  maxWidth: 110,
  overflowWrap: 'anywhere',
  textAlign: 'right',
  textTransform: 'uppercase',
};

const centerStyle: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  flex: '1 0 auto',
  flexDirection: 'column',
  justifyContent: 'center',
  padding: '28px 22px',
};

const pointsStyle: CSSProperties = {
  fontFamily: SERIF,
  fontSize: 108,
  fontWeight: 700,
  lineHeight: 0.9,
  margin: 0,
};

const pointsLabelStyle: CSSProperties = {
  color: INK_MUTED,
  fontSize: 12,
  letterSpacing: '0.14em',
  margin: '14px 0 0',
  textTransform: 'uppercase',
};

const highlightListStyle: CSSProperties = {
  borderTop: `1px solid ${RULE}`,
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
};

const highlightRowStyle: CSSProperties = {
  alignItems: 'center',
  borderBottom: `1px solid ${RULE}`,
  display: 'grid',
  gap: 14,
  gridTemplateColumns: '28px 1fr',
  padding: '16px 22px',
};

const highlightIndexStyle: CSSProperties = {
  color: INK_MUTED,
  fontSize: 12,
};

const highlightTextStyle: CSSProperties = {
  fontFamily: SERIF,
  fontSize: 18,
  fontStyle: 'italic',
  lineHeight: 1.25,
  margin: 0,
};

const emptyStyle: CSSProperties = {
  color: INK_MUTED,
  fontFamily: SERIF,
  fontSize: 18,
  fontStyle: 'italic',
  margin: 0,
  padding: '22px',
  textAlign: 'center',
};

const footerStyle: CSSProperties = {
  alignItems: 'center',
  color: INK_MUTED,
  display: 'flex',
  fontSize: 10,
  justifyContent: 'space-between',
  letterSpacing: '0.14em',
  padding: '14px 22px',
  textTransform: 'uppercase',
};

const footerRuleStyle: CSSProperties = {
  background: INK_MUTED,
  display: 'block',
  height: 1,
  opacity: 0.45,
  width: 78,
};
