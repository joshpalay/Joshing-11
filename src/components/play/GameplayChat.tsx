/**
 * Gameplay message thread — single vertical conversation with visible history.
 */

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

import { SessionCloseMessage } from '@/components/play/SessionCloseMessage';
import { CANNED_REACTIONS, type ReactionKey } from '@/lib/reactions';

export type ReactionPromptData = {
  senderName: string;
  questionId: string;
  contextType: 'feed' | 'joshing_game';
  contextId: string | null;
};

export type ChatMessage =
  | { id: string; kind: 'system'; text: string }
  | {
      id: string;
      kind: 'question';
      assignmentId: string;
      questionText: string;
      creatorName: string | null;
      onDismiss?: () => void;
      dismissLabel?: string;
      subhead?: string | null;
      badges?: Array<{ label: string; tone?: 'muted' | 'warning' }>;
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
      /** Per-answer commentary quip shown below the result bubble */
      quip?: string | null;
      reactionPrompt?: ReactionPromptData | null;
      pointsAwarded?: number | null;
      pointsLabel?: string | null;
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
  subhead,
  badges = [],
  questionText,
  creatorName,
  onDismiss,
  dismissLabel = "Skip - don't show again",
}: {
  subhead?: string | null;
  badges?: Array<{ label: string; tone?: 'muted' | 'warning' }>;
  questionText: string;
  creatorName: string | null;
  onDismiss?: () => void;
  dismissLabel?: string;
}) {
  const [dismissed, setDismissed] = useState(false);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    onDismiss?.();
  }, [onDismiss]);

  return (
    <div className="flex flex-col gap-0.5">
      {subhead || badges.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 pb-1 pl-0.5">
          {subhead ? (
            <p
              style={{
                ...monoStyle,
                fontSize: '0.58rem',
                color: 'var(--text-muted)',
              }}
            >
              {subhead}
            </p>
          ) : null}
          {badges.map((badge) => (
            <span
              key={badge.label}
              style={{
                ...monoStyle,
                borderRadius: '999px',
                border: '1px solid var(--border)',
                background: badge.tone === 'warning'
                  ? 'color-mix(in srgb, #b45309 12%, var(--surface))'
                  : 'color-mix(in srgb, var(--border) 18%, var(--surface))',
                color: badge.tone === 'warning' ? '#b45309' : 'var(--text-muted)',
                fontSize: '0.52rem',
                padding: '2px 6px',
              }}
            >
              {badge.label}
            </span>
          ))}
        </div>
      ) : null}
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
            aria-label={dismissLabel === 'X' ? 'Dismiss question' : dismissLabel}
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
            {dismissLabel}
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

function BreadcrumbRow({ text }: { text: string }) {
  return (
    <div className="flex justify-start py-0.5">
      <div
        style={{
          maxWidth: '82%',
          background: 'color-mix(in srgb, var(--surface-2) 64%, transparent)',
          border: '1px solid color-mix(in srgb, var(--border) 75%, transparent)',
          borderRadius: 'var(--radius-md)',
          padding: '8px 12px',
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: '0.78rem',
            fontStyle: 'italic',
            color: 'color-mix(in srgb, var(--text-muted) 78%, var(--text))',
            lineHeight: 1.35,
          }}
        >
          {text}
        </p>
      </div>
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

function reactionEmoji(value: string): string {
  switch (value) {
    case ':exploding_head:': return '🤯';
    case ':ok_hand:': return '👌';
    case ':smirk:': return '😏';
    case ':face_palm:': return '🤦';
    case ':sunny:': return '☀️';
    case ':thought_balloon:': return '💭';
    default: return value;
  }
}

export function QuestionReactionPrompt({ prompt }: { prompt: ReactionPromptData }) {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'hidden' | 'error'>('idle');
  const [customOpen, setCustomOpen] = useState(false);
  const [customMessage, setCustomMessage] = useState('');

  useEffect(() => {
    if (status !== 'idle') return;
    const timer = window.setTimeout(() => setStatus('hidden'), 8000);
    return () => window.clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    if (status !== 'sent') return;
    const timer = window.setTimeout(() => setStatus('hidden'), 1800);
    return () => window.clearTimeout(timer);
  }, [status]);

  const sendReaction = useCallback(async (reactionType: ReactionKey) => {
    setStatus('sending');
    try {
      const response = await fetch('/api/reactions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          questionId: prompt.questionId,
          contextType: prompt.contextType,
          contextId: prompt.contextId,
          reactionType,
          customMessage: customMessage.trim() || null,
        }),
      });
      if (!response.ok) throw new Error('Could not send reaction');
      setStatus('sent');
    } catch {
      setStatus('error');
    }
  }, [customMessage, prompt.contextId, prompt.contextType, prompt.questionId]);

  if (status === 'hidden') return null;

  if (status === 'sent') {
    return (
      <p style={{ ...monoStyle, marginTop: '8px', fontSize: '0.6rem', color: 'var(--text-muted)' }}>
        Sent to {prompt.senderName} ✓
      </p>
    );
  }

  return (
    <div style={{ marginTop: '10px', maxWidth: '100%' }}>
      <p style={{ ...monoStyle, marginBottom: '6px', fontSize: '0.6rem', color: 'var(--text-muted)' }}>
        React to {prompt.senderName}?
      </p>
      {customOpen ? (
        <input
          value={customMessage}
          onChange={(event) => setCustomMessage(event.target.value)}
          placeholder="Add a short note..."
          maxLength={160}
          style={{
            marginBottom: '8px',
            width: '100%',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            padding: '8px 10px',
            fontSize: '0.82rem',
            color: 'var(--text)',
          }}
        />
      ) : null}
      <div style={{ display: 'flex', gap: '6px', maxWidth: '100%', overflowX: 'auto', paddingBottom: '3px' }}>
        {CANNED_REACTIONS.map((reaction) => (
          <button
            key={reaction.key}
            type="button"
            onClick={() => void sendReaction(reaction.key)}
            disabled={status === 'sending'}
            style={{
              flex: '0 0 auto',
              minHeight: '34px',
              borderRadius: '999px',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              padding: '0 10px',
              fontSize: '0.78rem',
              cursor: status === 'sending' ? 'default' : 'pointer',
            }}
          >
            <span aria-hidden style={{ marginRight: '5px' }}>{reactionEmoji(reaction.emoji)}</span>
            {reaction.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCustomOpen((open) => !open)}
          disabled={status === 'sending'}
          aria-label="Add a custom message"
          style={{
            flex: '0 0 auto',
            width: '34px',
            height: '34px',
            borderRadius: '999px',
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--text)',
            cursor: status === 'sending' ? 'default' : 'pointer',
          }}
        >
          +
        </button>
      </div>
      {status === 'error' ? (
        <p style={{ marginTop: '6px', fontSize: '0.72rem', color: 'var(--danger)' }}>
          Could not send that reaction.
        </p>
      ) : null}
    </div>
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

function QuipLine({ text }: { text: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setVisible(true), 150);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <p
      style={{
        fontSize: '0.875rem',
        color: 'var(--text-muted)',
        fontStyle: 'italic',
        marginTop: '4px',
        marginLeft: '8px',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.3s ease',
      }}
    >
      {text}
    </p>
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
  reactionPrompt,
  pointsAwarded,
  pointsLabel,
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
  reactionPrompt?: ReactionPromptData | null;
  pointsAwarded?: number | null;
  pointsLabel?: string | null;
}) {
  const expired = result === 'expired';
  const correct = result === 'correct';
  const copy = CORRECT_COPY[copyVariant % 4];
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
          </>
        )}
        {typeof pointsAwarded === 'number' ? (
          <p style={{ ...monoStyle, fontSize: '0.55rem', color: 'var(--text-muted)', marginTop: '10px' }}>
            +{pointsAwarded} {pointsAwarded === 1 ? 'point' : 'points'}
            {pointsLabel ? ` - ${pointsLabel}` : ''}
          </p>
        ) : null}
      </div>
      {canonicalSubcategory ? (
        <DomainExclusionAffordance canonicalSubcategory={canonicalSubcategory} />
      ) : null}
      {reactionPrompt ? <QuestionReactionPrompt prompt={reactionPrompt} /> : null}
    </div>
  );
}

function SessionCloseRow({ text }: { text: string }) {
  return (
    <div
      className="mt-4"
      style={{
        alignSelf: 'flex-start',
        maxWidth: '88%',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border)',
        background: 'var(--surface-2)',
        padding: '14px 16px',
      }}
    >
      <SessionCloseMessage closeCopy={text} />
    </div>
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
                dismissLabel={m.dismissLabel}
                subhead={m.subhead}
                badges={m.badges}
              />
            );
          case 'user':
            return <UserRow key={m.id} text={m.text} />;
          case 'result':
            return (
              <div key={m.id} className="space-y-2">
                <ResultRow
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
                  reactionPrompt={m.reactionPrompt}
                  pointsAwarded={m.pointsAwarded}
                  pointsLabel={m.pointsLabel}
                />
                {m.breadcrumb ? <BreadcrumbRow text={m.breadcrumb} /> : null}
                {m.quip ? <QuipLine text={m.quip} /> : null}
              </div>
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
