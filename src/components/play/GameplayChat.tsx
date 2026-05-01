/**
 * Gameplay message thread — single vertical conversation with visible history.
 */

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

export type ChatMessage =
  | { id: string; kind: 'system'; text: string }
  | {
      id: string;
      kind: 'question';
      assignmentId: string;
      questionText: string;
      creatorName: string | null;
      onDismiss?: () => void;
    }
  | { id: string; kind: 'user'; text: string }
  | {
      id: string;
      kind: 'result';
      assignmentId: string;
      questionText: string;
      result: 'correct' | 'wrong' | 'expired';
      submitted: string;
      /** Canonical answer when wrong */
      correctAnswer: string | null;
      /** Near-miss quip from LLM grader */
      consolation: string | null;
      breadcrumb: string | null;
      /** 0–3 index for rotating copy phrases */
      copyVariant: number;
      /** Creator display name — used in wrong-answer copy variant 2 */
      creatorName: string | null;
      /** B12 — short line under correct reveal; fades after 2.5s */
      relationalFeedbackLine?: string | null;
      /** Domain exclusion — canonical subcategory for "remove from rotation" affordance */
      canonicalSubcategory?: string | null;
    }
  | {
      id: string;
      kind: 'session_complete';
      pointsToday: number;
      reviewHref: string;
      ceremonyHref?: string;
      detailsHref?: string;
      roundsRemaining: number;
      nextRoundOpensAt: string | null;
    }
  | { id: string; kind: 'session_close'; text: string }
  | {
      id: string;
      kind: 'bonus_offer';
      available: number;
      onAccept: () => void;
      onDecline: () => void;
    };

const CORRECT_COPY: Array<{ headline: string; subLabel: string }> = [
  { headline: 'Nice pull.', subLabel: 'shared signal' },
  { headline: 'Right on.', subLabel: 'you both know this one' },
  { headline: 'Locked in.', subLabel: 'confirmed' },
  { headline: 'Exactly.', subLabel: 'same territory' },
];

function wrongHeadline(variant: number): string {
  switch (variant % 4) {
    case 0: return 'Not this time — here\u2019s the answer.';
    case 1: return 'You\u2019ll know this one next time.';
    case 2:
      return 'Nice try.';
    case 3: return 'Close, but not quite.';
    default: return 'Not this time — here\u2019s the answer.';
  }
}

const monoStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.65rem',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

function SystemRow({ text }: { text: string }) {
  return (
    <div className="flex justify-center py-0.5">
      <p
        style={{
          ...monoStyle,
          fontSize: '0.58rem',
          color: 'var(--text-muted)',
          textAlign: 'center',
          maxWidth: '90%',
          lineHeight: 1.45,
        }}
      >
        {text}
      </p>
    </div>
  );
}

function QuestionRow({
  questionText,
  creatorName,
  onDismiss,
}: {
  questionText: string;
  creatorName: string | null;
  onDismiss?: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    onDismiss?.();
  }, [onDismiss]);

  return (
    <div className="flex flex-col gap-0.5">
      {creatorName ? (
        <p
          style={{
            ...monoStyle,
            fontSize: '0.6rem',
            color: 'var(--text-muted)',
            paddingLeft: '2px',
          }}
        >
          {creatorName}
        </p>
      ) : null}
      <div
        style={{
          alignSelf: 'flex-start',
          maxWidth: '88%',
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          padding: '12px 16px',
          fontSize: '0.98rem',
          color: 'var(--text)',
          lineHeight: 1.45,
        }}
      >
        <p style={{ margin: 0 }}>{questionText}</p>
      </div>
      {onDismiss ? (
        dismissed ? (
          <p
            style={{
              ...monoStyle,
              fontSize: '0.58rem',
              color: 'var(--text-muted)',
              paddingLeft: '2px',
              marginTop: '2px',
            }}
          >
            Skipped
          </p>
        ) : (
          <button
            type="button"
            onClick={handleDismiss}
            style={{
              alignSelf: 'flex-start',
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.58rem',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--text-muted)',
              textDecoration: 'underline',
              textUnderlineOffset: '2px',
              opacity: 0.7,
              marginTop: '4px',
              paddingLeft: '2px',
            }}
          >
            Skip — don&apos;t show again
          </button>
        )
      ) : null}
    </div>
  );
}

function UserRow({ text }: { text: string }) {
  return (
    <div className="flex justify-end py-0">
      <div
        style={{
          maxWidth: '88%',
          background: 'var(--accent)',
          borderRadius: 'var(--radius-md) var(--radius-md) 0 var(--radius-md)',
          padding: '10px 14px',
          fontSize: '0.9rem',
          color: 'var(--accent-contrast)',
        }}
      >
        {text}
      </div>
    </div>
  );
}

function BreadcrumbLine({ text, creatorName }: { text: string; creatorName: string | null }) {
  const authorLabel = creatorName?.trim() ? `FROM [${creatorName.trim()}]` : 'FROM [Author]';
  return (
    <div
      style={{
        marginTop: '9px',
        borderLeft: '2px solid color-mix(in srgb, var(--text) 20%, transparent)',
        paddingLeft: '8px',
      }}
    >
      <p style={{ ...monoStyle, fontSize: '0.5rem', color: 'var(--text-muted)' }}>{authorLabel}</p>
      <p
        style={{
          marginTop: '2px',
          fontSize: '0.78rem',
          fontStyle: 'italic',
          color: 'color-mix(in srgb, var(--text-muted) 78%, var(--text))',
          lineHeight: 1.35,
        }}
      >
        “{text}”
      </p>
    </div>
  );
}

function RelationalFeedbackFade({ text }: { text: string }) {
  const [faded, setFaded] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setFaded(true), 2500);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <p
      style={{
        marginTop: '8px',
        fontSize: '0.78rem',
        color: 'var(--text-muted)',
        lineHeight: 1.35,
        opacity: faded ? 0 : 1,
        transition: 'opacity 0.45s ease',
      }}
    >
      {text}
    </p>
  );
}

type ExclusionState =
  | { kind: 'idle' }
  | { kind: 'confirmed' }
  | { kind: 'undone' };

function DomainExclusionAffordance({ canonicalSubcategory }: { canonicalSubcategory: string }) {
  const [state, setState] = useState<ExclusionState>({ kind: 'idle' });
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleExclude = useCallback(async () => {
    setState({ kind: 'confirmed' });
    undoTimerRef.current = setTimeout(() => {
      undoTimerRef.current = null;
    }, 5000);
    try {
      await fetch('/api/users/domain-exclusions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canonical_subcategory: canonicalSubcategory }),
      });
    } catch {
      // fire-and-forget; optimistic UI is acceptable here
    }
  }, [canonicalSubcategory]);

  const handleUndo = useCallback(async () => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setState({ kind: 'undone' });
    try {
      await fetch(`/api/users/domain-exclusions/${encodeURIComponent(canonicalSubcategory)}`, {
        method: 'DELETE',
      });
    } catch {
      // fire-and-forget
    }
  }, [canonicalSubcategory]);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  if (state.kind === 'undone') return null;

  if (state.kind === 'confirmed') {
    return (
      <div style={{ marginTop: '10px', display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
        <p style={{ ...monoStyle, fontSize: '0.6rem', color: 'var(--text-muted)' }}>
          Got it — {canonicalSubcategory} won&apos;t appear in your daily queue anymore.
        </p>
        <button
          type="button"
          onClick={handleUndo}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.6rem',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--text-muted)',
            textDecoration: 'underline',
            textUnderlineOffset: '2px',
          }}
        >
          Undo
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: '10px' }}>
      <button
        type="button"
        onClick={handleExclude}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.6rem',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--text-muted)',
          textDecoration: 'underline',
          textUnderlineOffset: '2px',
          opacity: 0.75,
        }}
      >
        Remove this topic from my rotation
      </button>
    </div>
  );
}

function ResultRow({
  result,
  questionText,
  correctAnswer,
  consolation,
  breadcrumb,
  copyVariant,
  creatorName,
  relationalFeedbackLine,
  canonicalSubcategory,
}: {
  result: 'correct' | 'wrong' | 'expired';
  submitted: string;
  questionText: string;
  correctAnswer: string | null;
  consolation: string | null;
  breadcrumb: string | null;
  copyVariant: number;
  creatorName: string | null;
  relationalFeedbackLine?: string | null;
  canonicalSubcategory?: string | null;
}) {
  const expired = result === 'expired';
  const correct = result === 'correct';
  const copy = CORRECT_COPY[copyVariant % 4];
  const normalizedQuestion = questionText.trim().replace(/\s+/g, ' ').toLowerCase();
  const normalizedBreadcrumb = breadcrumb?.trim().replace(/\s+/g, ' ').toLowerCase() || '';
  const showBreadcrumb = Boolean(
    normalizedBreadcrumb
    && normalizedBreadcrumb !== normalizedQuestion
  );
  const resultToneStyle: CSSProperties = expired
    ? {
      background: 'var(--surface-2)',
      border: '1px solid var(--border)',
    }
    : correct
      ? {
        background: 'color-mix(in srgb, var(--success) 9%, var(--surface-2))',
        border: '1px solid color-mix(in srgb, var(--success) 30%, var(--border))',
      }
      : {
        background: 'color-mix(in srgb, #b42318 7%, var(--surface-2))',
        border: '1px solid color-mix(in srgb, #b42318 24%, var(--border))',
      };

  return (
    <div className="flex flex-col gap-0 pt-0.5" style={{ alignItems: 'flex-start', maxWidth: '88%' }}>
      <div
        style={{
          ...resultToneStyle,
          borderRadius: 'var(--radius-md)',
          padding: '10px 14px',
          fontSize: '0.9rem',
          color: 'var(--text)',
          lineHeight: 1.45,
          width: '100%',
        }}
      >
        {expired ? (
          <span style={{ color: 'var(--text-muted)' }}>This one wasn&apos;t recorded in time.</span>
        ) : correct ? (
          <>
            <p style={{ fontFamily: 'var(--font-literata), ui-serif, Georgia, serif' }}>
              <span style={{ color: '#178245', marginRight: '6px' }}>✓</span>
              {copy.headline}
            </p>
            <p style={{ ...monoStyle, fontSize: '0.55rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              {copy.subLabel}
            </p>
            {relationalFeedbackLine ? <RelationalFeedbackFade text={relationalFeedbackLine} /> : null}
            {showBreadcrumb && breadcrumb ? <BreadcrumbLine text={breadcrumb} creatorName={creatorName} /> : null}
          </>
        ) : (
          <>
            <p style={{ fontFamily: 'var(--font-literata), ui-serif, Georgia, serif' }}>
              <span style={{ color: '#8b1f16', marginRight: '6px' }}>✕</span>
              {wrongHeadline(copyVariant)}
            </p>
            {consolation ? (
              <p style={{ marginTop: '6px', fontSize: '0.88rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                {consolation}
              </p>
            ) : null}
            {correctAnswer ? (
              <p style={{ marginTop: '10px', fontSize: '0.9rem', color: 'var(--text)' }}>
                {correctAnswer}
              </p>
            ) : null}
            {showBreadcrumb && breadcrumb ? <BreadcrumbLine text={breadcrumb} creatorName={creatorName} /> : null}
          </>
        )}
      </div>
      {canonicalSubcategory ? (
        <DomainExclusionAffordance canonicalSubcategory={canonicalSubcategory} />
      ) : null}
    </div>
  );
}

function SessionCloseRow({ text }: { text: string }) {
  return (
    <p
      className="mt-4"
      style={{
        fontFamily: 'var(--font-literata), ui-serif, Georgia, serif',
        fontSize: '0.95rem',
        color: 'var(--text-muted)',
        lineHeight: 1.45,
        margin: 0,
      }}
    >
      {text}
    </p>
  );
}

function SessionCompleteRow({
  pointsToday,
  reviewHref,
  ceremonyHref,
  detailsHref,
  nextRoundOpensAt,
}: {
  pointsToday: number;
  reviewHref: string;
  ceremonyHref?: string;
  detailsHref?: string;
  roundsRemaining: number;
  nextRoundOpensAt: string | null;
}) {
  return (
    <div
      className="mt-6"
      style={{
        borderRadius: 'var(--radius-lg)',
        border: '1px solid color-mix(in srgb, var(--success) 40%, var(--border))',
        background: 'color-mix(in srgb, var(--success) 8%, var(--surface))',
        padding: '1.25rem 1.25rem 1.25rem',
      }}
    >
      <p
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.6rem',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          color: 'var(--success)',
          marginBottom: '0.5rem',
        }}
      >
        Round complete
      </p>
      <p
        style={{
          fontFamily: 'var(--font-literata), ui-serif, Georgia, serif',
          fontSize: '2rem',
          fontWeight: 600,
          color: 'var(--success)',
          lineHeight: 1,
        }}
      >
        +{pointsToday}
      </p>
      {nextRoundOpensAt && (
        <p className="mt-2 text-sm text-[var(--text-muted)]" style={{ lineHeight: 1.45 }}>
          Next round opens {nextRoundOpensAt}
        </p>
      )}
      {ceremonyHref ? (
        <Link href={ceremonyHref} className="btn-primary mt-4 inline-flex">
          Continue to ceremony
        </Link>
      ) : (
        <Link href={reviewHref} className="btn-primary mt-4 inline-flex">
          See results
        </Link>
      )}
      {!ceremonyHref && detailsHref ? (
        <Link
          href={detailsHref}
          className="mt-2 inline-flex text-sm"
          style={{ color: 'var(--text-muted)', textDecoration: 'underline', textUnderlineOffset: '2px' }}
        >
          Game details
        </Link>
      ) : null}
    </div>
  );
}

function BonusOfferRow({
  available,
  onAccept,
  onDecline,
}: {
  available: number;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div
      className="mt-6"
      style={{
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)',
        background: 'color-mix(in srgb, var(--border) 15%, var(--surface))',
        padding: '1.25rem',
      }}
    >
      <p
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.6rem',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          color: 'var(--text-muted)',
          marginBottom: '0.5rem',
        }}
      >
        Keep going
      </p>
      <p
        style={{
          fontFamily: 'var(--font-literata), ui-serif, Georgia, serif',
          fontSize: '1.3rem',
          fontWeight: 600,
          color: 'var(--text)',
          lineHeight: 1.2,
        }}
      >
        {available} more {available === 1 ? 'question' : 'questions'} in the pool.
      </p>
      <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>Untimed. Counts toward your score.</p>
      <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem', flexWrap: 'wrap' }}>
        <button type="button" className="btn-primary" onClick={onAccept}>
          Keep going
        </button>
        <button type="button" className="btn-ghost" onClick={onDecline}>
          No thanks
        </button>
      </div>
    </div>
  );
}

export function GameplayChatThread({
  messages,
}: {
  messages: ChatMessage[];
}) {
  return (
    <div className="space-y-2.5">
      {messages.map((m) => {
        switch (m.kind) {
          case 'system':
            return <SystemRow key={m.id} text={m.text} />;
          case 'question':
            return (
              <QuestionRow
                key={m.id}
                questionText={m.questionText}
                creatorName={m.creatorName}
                onDismiss={m.onDismiss}
              />
            );
          case 'user':
            return <UserRow key={m.id} text={m.text} />;
          case 'result':
            return (
              <ResultRow
                key={m.id}
                result={m.result}
                submitted={m.submitted}
                questionText={m.questionText}
                correctAnswer={m.correctAnswer}
                consolation={m.consolation}
                breadcrumb={m.breadcrumb}
                copyVariant={m.copyVariant}
                creatorName={m.creatorName}
                relationalFeedbackLine={m.relationalFeedbackLine}
                canonicalSubcategory={m.canonicalSubcategory}
              />
            );
          case 'session_complete':
            return (
              <SessionCompleteRow
                key={m.id}
                pointsToday={m.pointsToday}
                reviewHref={m.reviewHref}
                ceremonyHref={m.ceremonyHref}
                detailsHref={m.detailsHref}
                roundsRemaining={m.roundsRemaining}
                nextRoundOpensAt={m.nextRoundOpensAt}
              />
            );
          case 'session_close':
            return <SessionCloseRow key={m.id} text={m.text} />;
          case 'bonus_offer':
            return (
              <BonusOfferRow
                key={m.id}
                available={m.available}
                onAccept={m.onAccept}
                onDecline={m.onDecline}
              />
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

export function newMessageId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
