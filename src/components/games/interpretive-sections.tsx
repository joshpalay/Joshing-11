'use client';

import { type CSSProperties, type ReactNode, useState, useEffect } from 'react';
import Link from 'next/link';
import { KnowledgeCircle, getDomainColor } from '@/components/knowledge/CategoryCircles';

const monoStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.62rem',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

const titleStyle: CSSProperties = {
  fontFamily: 'var(--font-neutral), system-ui, sans-serif',
  fontSize: '1.05rem',
  fontWeight: 600,
  color: 'var(--warm-ink)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

export type GrowthRow = {
  domain: string;
  domainSlug: string;
  masteryPoints: number;
  yourQuestionsCount: number;
  hasAnsweredInDomain?: boolean;
};

const G_INK = 'var(--warm-ink)';
const G_INK3 = 'var(--brand-ink-400)';
const G_FM = "'Courier New', monospace";
const G_FF = "'Georgia', serif";
const G_RULE = 'var(--warm-border)';

function GrowthCircleRow({
  row,
  index,
  maxPoints,
  isLast,
}: {
  row: GrowthRow;
  index: number;
  maxPoints: number;
  isLast: boolean;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), index * 200);
    return () => clearTimeout(t);
  }, [index]);

  const color = getDomainColor(row.domainSlug);
  const isNewTerritory = row.masteryPoints === 0;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        padding: '14px 0',
        borderBottom: isLast ? 'none' : `1px solid ${G_RULE}`,
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(8px)',
        transition: 'opacity 0.4s ease, transform 0.4s ease',
      }}
    >
      <KnowledgeCircle
        broadCategory={row.domainSlug}
        pointsAfter={row.masteryPoints}
        maxPoints={maxPoints}
        animate={visible}
        size={54}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        {isNewTerritory && (
          <div
            style={{
              fontSize: 8,
              fontFamily: G_FM,
              letterSpacing: '0.18em',
              color,
              textTransform: 'uppercase',
              marginBottom: 3,
            }}
          >
            New territory
          </div>
        )}
        <div
          style={{
            fontSize: 14,
            fontFamily: G_FF,
            fontWeight: 'bold',
            color: G_INK,
            lineHeight: 1.25,
          }}
        >
          {row.domain}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 17, fontFamily: G_FM, color: G_INK, fontWeight: 'bold', lineHeight: 1 }}>
          +{row.masteryPoints}
        </div>
        <div
          style={{
            fontSize: 8,
            fontFamily: G_FM,
            color: G_INK3,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            marginTop: 2,
          }}
        >
          pts
        </div>
      </div>
    </div>
  );
}

export function GrowthSection({
  rows,
  emptyCopy,
  knowledgeHref,
  variant = 'active',
}: {
  rows: GrowthRow[];
  emptyCopy: string;
  knowledgeHref?: string;
  variant?: 'active' | 'completed';
}) {
  const maxPoints = rows.length > 0 ? Math.max(...rows.map((r) => r.masteryPoints), 1) : 1;
  const title = variant === 'completed' ? 'Your Growth Recap' : 'Your Growth';

  return (
    <section className="card px-5 py-4">
      <h2 style={titleStyle}>{title}</h2>
      {knowledgeHref ? (
        <Link
          href={knowledgeHref}
          style={{
            ...monoStyle,
            display: 'inline-block',
            marginTop: '8px',
            color: 'var(--text-muted)',
            textDecoration: 'underline',
            textUnderlineOffset: '3px',
          }}
        >
          See how this shaped your knowledge →
        </Link>
      ) : null}
      {rows.length === 0 ? (
        <p style={{ marginTop: '10px', fontSize: '0.9rem', color: 'var(--text-muted)' }}>{emptyCopy}</p>
      ) : (
        <div style={{ margin: '12px 0 0' }}>
          {rows.map((row, i) => (
            <GrowthCircleRow
              key={row.domain}
              row={row}
              index={i}
              maxPoints={maxPoints}
              isLast={i === rows.length - 1}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export type ImpactSummary = {
  questionsThatLanded: number;
  bestQuestion?: {
    questionText: string;
    category: string;
    correctCount: number;
  } | null;
  starsEarned: number;
  engagedNames: string[];
};

export function ImpactSection({
  summary,
  emptyCopy,
  variant = 'active',
}: {
  summary: ImpactSummary | null;
  emptyCopy: string;
  variant?: 'active' | 'completed';
}) {
  const title = variant === 'completed' ? 'Your Impact Recap' : 'Your Impact';
  if (!summary) {
    return (
      <section className="card px-5 py-4">
        <h2 style={titleStyle}>{title}</h2>
        <p style={{ marginTop: '10px', fontSize: '0.9rem', color: 'var(--text-muted)' }}>{emptyCopy}</p>
      </section>
    );
  }

  const landedCopy = summary.questionsThatLanded === 0
    ? 'None of your questions were answered correctly this season.'
    : `${summary.questionsThatLanded} of your questions were answered correctly this season.`;
  const engagedCopy = summary.engagedNames.length === 0
    ? null
    : summary.engagedNames.length === 1
      ? `${summary.engagedNames[0]} knew your territory.`
      : `${summary.engagedNames[0]} and ${summary.engagedNames[1]} knew your territory.`;

  return (
    <section className="card px-5 py-4">
      <h2 style={titleStyle}>{title}</h2>
      <div style={{ marginTop: '12px', display: 'grid', gap: '10px' }}>
        <p style={{ fontSize: '0.92rem', color: 'var(--text)', lineHeight: 1.45 }}>{landedCopy}</p>
        {summary.bestQuestion ? (
          <article style={{ border: '1px solid var(--border)', borderRadius: '12px', padding: '0.85rem 0.95rem' }}>
            <p style={{ ...monoStyle, color: 'var(--text-muted)', fontSize: '0.58rem' }}>{summary.bestQuestion.category}</p>
            <p style={{ marginTop: '6px', fontSize: '0.92rem', color: 'var(--text)', lineHeight: 1.45 }}>&ldquo;{summary.bestQuestion.questionText}&rdquo;</p>
            <p style={{ marginTop: '6px', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Asked by you · {summary.bestQuestion.correctCount} {summary.bestQuestion.correctCount === 1 ? 'player' : 'players'} got it right
            </p>
          </article>
        ) : null}
        {summary.starsEarned > 0 ? (
          <p style={{ fontSize: '0.92rem', color: 'var(--text)', lineHeight: 1.45 }}>
            Your questions earned {summary.starsEarned} {summary.starsEarned === 1 ? 'star' : 'stars'} this season.
          </p>
        ) : null}
        {engagedCopy ? (
          <p style={{ fontSize: '0.92rem', color: 'var(--text)', lineHeight: 1.45 }}>{engagedCopy}</p>
        ) : null}
      </div>
    </section>
  );
}

export type DiscoveryRow = {
  id: string;
  questionText: string;
  answerText: string;
  factualExplanation?: string | null;
  creatorName?: string | null;
  creatorNote?: string | null;
};

export function DiscoverySection({ rows, emptyCopy }: { rows: DiscoveryRow[]; emptyCopy: string }) {
  return (
    <section className="card px-5 py-4">
      <h2 style={titleStyle}>What You Discovered</h2>
      <p style={{ marginTop: '8px', fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Missed and expired prompts become context you can carry into the next conversation.
      </p>
      {rows.length === 0 ? (
        <p style={{ marginTop: '10px', fontSize: '0.9rem', color: 'var(--text-muted)' }}>{emptyCopy}</p>
      ) : (
        <div style={{ marginTop: '12px', display: 'grid', gap: '12px' }}>
          {rows.map((row) => (
            <article key={row.id} style={{ borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
              <p style={{ fontSize: '0.92rem', color: 'var(--text)', lineHeight: 1.45 }}>{row.questionText}</p>
              <p style={{ ...monoStyle, color: 'var(--text-muted)', marginTop: '6px' }}>Answer: {row.answerText}</p>
              {row.factualExplanation ? (
                <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)', marginTop: '7px', lineHeight: 1.45 }}>{row.factualExplanation}</p>
              ) : null}
              {row.creatorNote ? (
                <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)', marginTop: '7px', fontStyle: 'italic', lineHeight: 1.45 }}>
                  {row.creatorName ? `${row.creatorName}: ` : ''}{row.creatorNote}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function QuestionRecordSection({
  titleSuffix,
  children,
  variant = 'active',
}: {
  titleSuffix?: string;
  children: ReactNode;
  variant?: 'active' | 'completed';
}) {
  return (
    <section>
      <div style={{ marginBottom: '12px' }}>
        <h2 style={titleStyle}>Question Record{titleSuffix ? ` ${titleSuffix}` : ''}</h2>
        <p style={{ ...monoStyle, color: 'var(--text-muted)', marginTop: '6px' }}>
          {variant === 'completed'
            ? 'Full archive with post-game review context.'
            : 'Full archive after the interpretive summary.'}
        </p>
      </div>
      {children}
    </section>
  );
}
