/**
 * Gameplay message thread — single vertical conversation with visible history.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';

import { SessionCloseMessage } from '@/components/play/SessionCloseMessage';
import {
  CORRECT_ANSWER_REACTIONS,
  WRONG_ANSWER_REACTIONS,
  isWrongAnswerReactionKey,
  type ReactionKey,
} from '@/lib/reactions';

export type ReactionPromptData = {
  senderName: string;
  questionId: string;
  contextType: 'feed' | 'joshing_game';
  contextId: string | null;
  // §8.10b: which canned set to render. Wrong-answer reactions also enable
  // the §8.22 "include what I wrote" opt-in.
  result: 'correct' | 'wrong';
};

export type RecheckActionResult = { accepted: boolean; message: string };

export type RecheckAction = {
  onSubmit: () => Promise<RecheckActionResult>;
};

export type ChatMessage =
  | { id: string; kind: 'system'; text: string }
  | {
      id: string;
      kind: 'question';
      assignmentId: string;
      questionText: string;
      creatorName: string | null;
      isNew?: boolean;
      onDismiss?: () => void;
      dismissLabel?: string;
      /** When false, the dismiss button calls onDismiss but does not flip into the "Skipped" inline state — used when the click opens a dialog instead of completing the action. Defaults to true to preserve legacy behavior. */
      dismissImmediate?: boolean;
      subhead?: string | null;
      badges?: Array<{ label: string; tone?: 'muted' | 'warning' }>;
    }
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'typing' }
  | {
      id: string;
      kind: 'result';
      assignmentId: string;
      questionText: string;
      result: 'correct' | 'wrong' | 'expired' | 'gave_up';
      submitted: string;
      /** Canonical answer when wrong */
      correctAnswer: string | null;
      /** Near-miss quip from LLM grader */
      consolation: string | null;
      /** LLM-generated friends-only aside; only present when the viewer is the creator or an active friend. */
      insideJoke?: string | null;
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
      recheckAction?: RecheckAction | null;
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
  | { id: string; kind: 'session_close'; scoreLine: string; interpretiveLine: string | null; summaryHref?: string }
  | {
      id: string;
      kind: 'bonus_offer';
      available: number;
      onAccept: () => void;
      onDecline: () => void;
    };

const CORRECT_COPY: Array<{ headline: string; subLabel: string }> = [
  { headline: 'Nice pull.', subLabel: 'common ground' },
  { headline: 'Right on.', subLabel: 'common ground +' },
  { headline: 'Locked in.', subLabel: 'common ground ++' },
  { headline: 'Exactly.', subLabel: 'common ground +++' },
];

function wrongHeadline(variant: number): string {
  switch (variant % 3) {
    case 0: return 'Not this time — here\u2019s the answer.';
    case 1: return 'You\u2019ll know this one next time.';
    case 2: return 'Close, but not quite.';
    default: return 'Not this time — here\u2019s the answer.';
  }
}

const monoStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.65rem',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

const WRONG_NAMED_SUBLABEL: Array<(name: string) => string> = [
  (name) => `${name}’s world includes this`,
  (name) => `${name} carries this one`,
  (name) => `${name} thought you might`,
];

function firstNameFrom(creatorName: string): string {
  const trimmed = creatorName.trim();
  const space = trimmed.indexOf(' ');
  return space === -1 ? trimmed : trimmed.slice(0, space);
}

function wrongNamedSubLabel(creatorName: string | null, variant: number): string | null {
  if (!creatorName) return null;
  if (creatorName.trim().toLowerCase() === 'joshing') return null;
  const firstName = firstNameFrom(creatorName);
  if (!firstName) return null;
  return WRONG_NAMED_SUBLABEL[variant % WRONG_NAMED_SUBLABEL.length]!(firstName);
}

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
  isNew = false,
  onDismiss,
  dismissLabel = "Skip - don't show again",
  dismissImmediate = true,
}: {
  subhead?: string | null;
  badges?: Array<{ label: string; tone?: 'muted' | 'warning' }>;
  questionText: string;
  creatorName: string | null;
  isNew?: boolean;
  onDismiss?: () => void;
  dismissLabel?: string;
  dismissImmediate?: boolean;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [visible, setVisible] = useState(!isNew);

  useEffect(() => {
    if (!isNew) return;
    const t = window.setTimeout(() => setVisible(true), 30);
    return () => window.clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDismiss = useCallback(() => {
    if (dismissImmediate) setDismissed(true);
    onDismiss?.();
  }, [onDismiss, dismissImmediate]);

  return (
    <div
      className="flex flex-col gap-0.5"
      style={isNew ? { opacity: visible ? 1 : 0, transition: 'opacity 0.3s ease' } : undefined}
    >
      {subhead ? (
        <div className="flex flex-wrap items-center gap-1.5 pb-1 pl-0.5">
          <p
            style={{
              ...monoStyle,
              fontSize: '0.58rem',
              color: 'var(--text-muted)',
            }}
          >
            {subhead}
          </p>
        </div>
      ) : null}
      {creatorName ? (
        <p
          style={{
            fontFamily: 'var(--font-literata), ui-serif, Georgia, serif',
            fontSize: '0.86rem',
            color: 'var(--text)',
            paddingLeft: '2px',
            paddingBottom: '2px',
            opacity: 0.82,
            lineHeight: 1.3,
          }}
        >
          <span style={{ ...monoStyle, fontSize: '0.55rem', color: 'var(--text-muted)', marginRight: '6px' }}>
            FROM
          </span>
          <span style={{ fontWeight: 600 }}>{creatorName}</span>
          {creatorName.trim().toLowerCase() === 'joshing' ? null : (
            <span style={{ marginLeft: '6px', opacity: 0.55, fontStyle: 'italic' }}>gave you this</span>
          )}
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
      {badges.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 pt-1 pl-0.5">
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
          background: 'var(--user-bubble)',
          borderRadius: 'var(--radius-md) var(--radius-md) 0 var(--radius-md)',
          padding: '10px 14px',
          fontSize: '0.9rem',
          color: 'var(--user-bubble-foreground)',
        }}
      >
        {text}
      </div>
    </div>
  );
}

function BreadcrumbLine({ text, creatorName }: { text: string; creatorName: string | null }) {
  const author = creatorName?.trim() ?? null;
  const isBot = author?.toLowerCase() === 'joshing';
  const showAuthor = author && !isBot;
  return (
    <div
      style={{
        marginTop: '9px',
        borderLeft: '2px solid color-mix(in srgb, var(--text) 20%, transparent)',
        paddingLeft: '8px',
      }}
    >
      {showAuthor ? (
        <p
          style={{
            fontFamily: 'var(--font-literata), ui-serif, Georgia, serif',
            fontSize: '0.7rem',
            fontStyle: 'italic',
            color: 'var(--text-muted)',
          }}
        >
          From {firstNameFrom(author!)}.
        </p>
      ) : null}
      <p
        style={{
          marginTop: showAuthor ? '2px' : '0',
          fontFamily: 'var(--font-literata), ui-serif, Georgia, serif',
          fontSize: '0.92rem',
          fontStyle: 'italic',
          color: 'color-mix(in srgb, var(--text-muted) 50%, var(--text))',
          lineHeight: 1.35,
        }}
      >
        &ldquo;{text}&rdquo;
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

function reactionEmoji(value: string): string {
  switch (value) {
    case ':exploding_head:': return '🤯';
    case ':ok_hand:': return '👌';
    case ':smirk:': return '😏';
    case ':face_palm:': return '🤦';
    case ':sunny:': return '☀️';
    case ':thought_balloon:': return '💭';
    case ':thinking_face:': return '🤔';
    case ':open_book:': return '📖';
    case ':memo:': return '📝';
    case ':sweat_smile:': return '😅';
    default: return value;
  }
}

export function QuestionReactionPrompt({ prompt }: { prompt: ReactionPromptData }) {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'hidden' | 'error'>('idle');
  const [customOpen, setCustomOpen] = useState(false);
  const [customMessage, setCustomMessage] = useState('');
  // §8.22 opt-in. Only meaningful on wrong-answer reactions; the API coerces
  // it to false for any other reactionType.
  const [includeSubmittedAnswer, setIncludeSubmittedAnswer] = useState(false);

  const isWrongAnswer = prompt.result === 'wrong';
  const cannedSet = isWrongAnswer ? WRONG_ANSWER_REACTIONS : CORRECT_ANSWER_REACTIONS;

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
          includeSubmittedAnswer:
            includeSubmittedAnswer && isWrongAnswerReactionKey(reactionType),
        }),
      });
      if (!response.ok) throw new Error('Could not send reaction');
      setStatus('sent');
    } catch {
      setStatus('error');
    }
  }, [customMessage, includeSubmittedAnswer, prompt.contextId, prompt.contextType, prompt.questionId]);

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
      {isWrongAnswer ? (
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            marginBottom: '8px',
            fontSize: '0.72rem',
            color: 'var(--text-muted)',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={includeSubmittedAnswer}
            onChange={(event) => setIncludeSubmittedAnswer(event.target.checked)}
            disabled={status === 'sending'}
          />
          Include what I wrote
        </label>
      ) : null}
      <div style={{ display: 'flex', gap: '6px', maxWidth: '100%', overflowX: 'auto', paddingBottom: '3px' }}>
        {cannedSet.map((reaction) => (
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

function TypingRow() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setVisible(true), 30);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.3s ease' }}>
      <div
        style={{
          alignSelf: 'flex-start',
          display: 'inline-block',
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          padding: '10px 16px',
          fontSize: '0.9rem',
          color: 'var(--text-muted)',
          fontStyle: 'italic',
        }}
      >
        Grading...
      </div>
    </div>
  );
}

function ResultRow({
  result,
  correctAnswer,
  consolation,
  insideJoke,
  breadcrumb,
  quip,
  copyVariant,
  creatorName,
  relationalFeedbackLine,
  reactionPrompt,
  pointsAwarded,
  pointsLabel,
  recheckAction,
}: {
  result: 'correct' | 'wrong' | 'expired' | 'gave_up';
  submitted: string;
  questionText: string;
  correctAnswer: string | null;
  consolation: string | null;
  insideJoke?: string | null;
  breadcrumb: string | null;
  quip?: string | null;
  copyVariant: number;
  creatorName: string | null;
  relationalFeedbackLine?: string | null;
  canonicalSubcategory?: string | null;
  reactionPrompt?: ReactionPromptData | null;
  pointsAwarded?: number | null;
  pointsLabel?: string | null;
  recheckAction?: RecheckAction | null;
}) {
  const [recheckState, setRecheckState] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [recheckMessage, setRecheckMessage] = useState<string | null>(null);
  const [recheckAccepted, setRecheckAccepted] = useState(false);
  const expired = result === 'expired';
  const correct = result === 'correct';
  const gaveUp = result === 'gave_up';
  const copy = CORRECT_COPY[copyVariant % 4];
  const requestRecheck = useCallback(async () => {
    if (!recheckAction || recheckState === 'submitting') return;
    setRecheckState('submitting');
    setRecheckMessage(null);
    setRecheckAccepted(false);
    try {
      const outcome = await recheckAction.onSubmit();
      setRecheckState('done');
      setRecheckMessage(outcome.message);
      setRecheckAccepted(outcome.accepted);
    } catch {
      setRecheckState('error');
      setRecheckMessage('Could not recheck that answer.');
      setRecheckAccepted(false);
    }
  }, [recheckAction, recheckState]);

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
      : gaveUp
        ? {
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
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
        ) : gaveUp ? (
          <>
            <p
              style={{
                fontFamily: 'var(--font-literata), ui-serif, Georgia, serif',
                fontSize: '0.82rem',
                color: 'var(--text-muted)',
              }}
            >
              <span style={{ color: 'var(--text-muted)', marginRight: '6px' }}>—</span>
              For the record.
            </p>
            {correctAnswer ? (
              <p
                style={{
                  marginTop: '6px',
                  fontFamily: 'var(--font-literata), ui-serif, Georgia, serif',
                  fontSize: '0.95rem',
                  color: 'var(--text)',
                }}
              >
                {correctAnswer}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p style={{ fontFamily: 'var(--font-literata), ui-serif, Georgia, serif' }}>
              <span style={{ color: '#8b1f16', marginRight: '6px' }}>✕</span>
              {wrongHeadline(copyVariant)}
            </p>
            {correctAnswer ? (
              <p style={{ marginTop: '8px', fontSize: '0.9rem', color: 'var(--text)' }}>
                <span style={{ fontWeight: 600 }}>Answer:</span> {correctAnswer}
              </p>
            ) : null}
            <p style={{ ...monoStyle, fontSize: '0.55rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              Now it&rsquo;s in yours too
            </p>
            {(() => {
              const namedSubLabel = wrongNamedSubLabel(creatorName, copyVariant);
              return namedSubLabel ? (
                <p style={{ ...monoStyle, fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  {namedSubLabel}
                </p>
              ) : null;
            })()}
            {consolation ? (
              <p style={{ marginTop: '8px', fontSize: '0.88rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                {consolation}
              </p>
            ) : null}
            {recheckAction ? (
              <div style={{ marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => void requestRecheck()}
                  disabled={recheckState === 'submitting' || recheckState === 'done'}
                  style={{
                    borderRadius: '999px',
                    border: '1px solid var(--border)',
                    background: 'var(--surface)',
                    color: 'var(--text)',
                    cursor: recheckState === 'submitting' || recheckState === 'done' ? 'default' : 'pointer',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.58rem',
                    letterSpacing: '0.06em',
                    padding: '6px 10px',
                    textTransform: 'uppercase',
                  }}
                >
                  {recheckState === 'submitting' ? 'Rechecking...' : 'Recheck my answer'}
                </button>
                {recheckMessage ? (
                  recheckAccepted ? (
                    <div
                      role="status"
                      aria-live="polite"
                      style={{
                        marginTop: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid color-mix(in srgb, var(--success) 35%, var(--border))',
                        background: 'color-mix(in srgb, var(--success) 12%, var(--surface))',
                        color: '#065f46',
                        padding: '8px 12px',
                        fontSize: '0.85rem',
                        fontWeight: 500,
                        lineHeight: 1.35,
                      }}
                    >
                      <span aria-hidden style={{ fontSize: '1rem', lineHeight: 1 }}>✓</span>
                      <span>{recheckMessage}</span>
                    </div>
                  ) : (
                    <p role="status" aria-live="polite" style={{ marginTop: '6px', fontSize: '0.78rem', color: recheckState === 'error' ? 'var(--danger)' : 'var(--text-muted)', lineHeight: 1.35 }}>
                      {recheckMessage}
                    </p>
                  )
                ) : null}
              </div>
            ) : null}
          </>
        )}
        {breadcrumb ? <BreadcrumbLine text={breadcrumb} creatorName={creatorName} /> : null}
        {quip ? <QuipLine text={quip} /> : null}
        {typeof pointsAwarded === 'number' ? (
          <p style={{ ...monoStyle, fontSize: '0.55rem', color: 'var(--text-muted)', marginTop: '10px' }}>
            +{pointsAwarded} {pointsAwarded === 1 ? 'point' : 'points'}
            {pointsLabel ? ` - ${pointsLabel}` : ''}
          </p>
        ) : null}
      </div>
      {insideJoke ? (
        <div
          style={{
            marginTop: '8px',
            width: '100%',
            borderRadius: 'var(--radius-md)',
            border: '1px solid color-mix(in srgb, #b58a2b 24%, var(--border))',
            background: 'color-mix(in srgb, #f6c97a 14%, var(--surface-2))',
            padding: '10px 14px',
            color: 'var(--text)',
          }}
        >
          <p
            style={{
              ...monoStyle,
              fontSize: '0.55rem',
              color: 'color-mix(in srgb, #6b4a10 80%, var(--text-muted))',
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
            }}
          >
            Between us friends
          </p>
          <p
            style={{
              marginTop: '4px',
              fontFamily: 'var(--font-literata), ui-serif, Georgia, serif',
              fontSize: '0.92rem',
              lineHeight: 1.45,
            }}
          >
            {insideJoke}
          </p>
        </div>
      ) : null}
      {reactionPrompt ? <QuestionReactionPrompt prompt={reactionPrompt} /> : null}
    </div>
  );
}

function SessionCloseRow({
  scoreLine,
  interpretiveLine,
  summaryHref,
}: {
  scoreLine: string;
  interpretiveLine: string | null;
  summaryHref?: string;
}) {
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
      <SessionCloseMessage scoreLine={scoreLine} interpretiveLine={interpretiveLine} />
      {summaryHref ? (
        <div className="pt-3">
          <Link href={summaryHref} className="btn-primary inline-flex">
            See summary →
          </Link>
        </div>
      ) : null}
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
                isNew={m.isNew}
                onDismiss={m.onDismiss}
                dismissLabel={m.dismissLabel}
                dismissImmediate={m.dismissImmediate}
                subhead={m.subhead}
                badges={m.badges}
              />
            );
          case 'user':
            return <UserRow key={m.id} text={m.text} />;
          case 'typing':
            return <TypingRow key={m.id} />;
          case 'result':
            return (
              <ResultRow
                key={m.id}
                result={m.result}
                submitted={m.submitted}
                questionText={m.questionText}
                correctAnswer={m.correctAnswer}
                consolation={m.consolation}
                insideJoke={m.insideJoke}
                breadcrumb={m.breadcrumb}
                quip={m.quip}
                copyVariant={m.copyVariant}
                creatorName={m.creatorName}
                relationalFeedbackLine={m.relationalFeedbackLine}
                canonicalSubcategory={m.canonicalSubcategory}
                reactionPrompt={m.reactionPrompt}
                pointsAwarded={m.pointsAwarded}
                pointsLabel={m.pointsLabel}
                recheckAction={m.recheckAction}
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
            return (
              <SessionCloseRow
                key={m.id}
                scoreLine={m.scoreLine}
                interpretiveLine={m.interpretiveLine}
                summaryHref={m.summaryHref}
              />
            );
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
