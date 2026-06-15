/**
 * Gameplay message thread — single vertical conversation with visible history.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';

import { answerHeadingStyle } from '@/components/answer-heading';
import { firstSentence } from '@/lib/first-sentence';
import { EditorialBadge } from '@/components/EditorialBadge';
import { ThreadCard } from '@/components/play/ThreadCard';
import { SessionCloseMessage } from '@/components/play/SessionCloseMessage';
import { NewTerritoryUndo } from '@/components/feed/NewTerritoryUndo';
import {
  CORRECT_ANSWER_REACTIONS,
  WRONG_ANSWER_REACTIONS,
  isWrongAnswerReactionKey,
  type ReactionKey,
} from '@/lib/reactions';
import { isLlmAttribution, INSIDE_JOKE_LABELS, type InsideJokeKind } from '@/lib/questions-types';

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
      /**
       * D-3: the named author is the non-human house/editorial author. Renders
       * the persistent `Editorial` badge and suppresses all relational copy
       * ("gave you this", "{name} carries this one"). Set explicitly by the
       * server resolver — never inferred from the name string, so a human named
       * "Joshing" is never mistaken for the house author.
       */
      creatorIsHouse?: boolean;
      /**
       * Daily Five +2 bonus slot presence attribution (D-4 §B): the followed
       * friend whose territory/activity surfaced this domain. When set, the card
       * marks the slot as a bonus drawn from that friend's knowledge —
       * "BONUS from {name}'s knowledge" ("{name} and others’ knowledge" when more
       * than one friend surfaces it). There is no literal answerer; the question
       * itself is freshly generated.
       */
      presenceSourceName?: string | null;
      presenceSourceExtraCount?: number;
      isNew?: boolean;
      /** When true the card is shown as a dimmed, non-interactive ghost — set when the question is dismissed and the inline "Dismissed · Undo" notice takes over. */
      faded?: boolean;
      subhead?: string | null;
      badges?: Array<{ label: string; tone?: 'muted' | 'warning' }>;
    }
  | { id: string; kind: 'dismiss_notice'; onUndo: () => Promise<void> }
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'typing' }
  | {
      id: string;
      kind: 'result';
      assignmentId: string;
      questionText: string;
      result: 'correct' | 'wrong' | 'expired' | 'gave_up';
      submitted: string;
      /** D-3: the named author is the non-human house author (see question variant). */
      creatorIsHouse?: boolean;
      /** Canonical answer when wrong */
      correctAnswer: string | null;
      /** Near-miss quip from LLM grader */
      consolation: string | null;
      /** LLM-generated aside; for authored questions only present when the viewer is the creator or an active friend. */
      insideJoke?: string | null;
      /** Provenance of the aside label: relational (a person authored it) vs editorial (LLM-origin). */
      insideJokeKind?: InsideJokeKind | null;
      breadcrumb: string | null;
      /** 0–3 index for rotating copy phrases */
      copyVariant: number;
      /** Creator display name — used in wrong-answer copy variant 2 */
      creatorName: string | null;
      /** Domain exclusion — canonical subcategory for "remove from rotation" affordance */
      canonicalSubcategory?: string | null;
      /** B-1 — domain newly opened in the KB by this correct answer; surfaces the "Added [Domain] — remove?" undo. */
      openedTerritoryDomain?: string | null;
      /** Author's why — commentary the question's author attached at creation, revealed on answer (correct or incorrect). */
      authorNote?: string | null;
      /** Question's stored factual explainer. Rendered as a fallback below the verdict when no breadcrumb arrives (e.g. feed-sourced catch-up items, or when /api/breadcrumb times out). */
      explanation?: string | null;
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
  | {
      id: string;
      kind: 'session_close';
      scoreLine: string;
      interpretiveLine: string | null;
      summaryHref?: string;
    }
  | {
      id: string;
      kind: 'bonus_offer';
      available: number;
      onAccept: () => void;
      onDecline: () => void;
    };

// Shared width for every left-aligned card in the play thread so the column
// reads as one coherent conversation — question, bonus, result, reflection, and
// session-close cards all share a left + right edge. Sourced from a single CSS
// token so no card type defines its own one-off width. The only intentional
// exceptions are centered system lines, the right-aligned answer bubble, and
// global/header chrome.
const THREAD_CARD_MAX_WIDTH = 'var(--play-thread-card-width)';

function wrongHeadline(variant: number): string {
  switch (variant % 3) {
    case 0:
      return 'Not this time — here\u2019s the answer.';
    case 1:
      return 'You\u2019ll know this one next time.';
    case 2:
      return 'Close, but not quite.';
    default:
      return 'Not this time — here\u2019s the answer.';
  }
}

const monoStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.65rem',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

// The quiet eyebrow label that opens a result/answer-reveal card — small, mono,
// letter-spaced (e.g. "✓ Locked in", "The answer"). Tone color is applied per
// card so the answer beneath it stays the focal point.
const verdictLabelStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.7rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
};

// The answer, repeated as a prominent serif headline on the result card —
// mirrors the feed reveal treatment ("eyebrow → answer as headline →
// explanation"). Shared via `answer-heading.ts` so every answer-reveal surface
// (this card, the feed sheet, the summary recap, the history list) stays in sync.

// Darkened triangle-gold so warning/inside-joke labels clear AA on the cream
// surface (raw --accent-gold #d9a82e is too light for small text). Mirrors the
// GOLD_INK used on the feed answer sheets.
const GOLD_INK = 'var(--accent-gold-ink)';

const WRONG_NAMED_SUBLABEL: Array<(name: string) => string> = [
  (name) => `${name}’s world includes this`,
  (name) => `${name} carries this one`,
  (name) => `${name} thought you might`,
];

// Trim an explainer to its first sentence for the live thread — the full text
// still lives in the End of Session Review. Keeps the thread moving while giving
// a one-line "why" directly under the answer.
function firstNameFrom(creatorName: string): string {
  const trimmed = creatorName.trim();
  const space = trimmed.indexOf(' ');
  return space === -1 ? trimmed : trimmed.slice(0, space);
}

function wrongNamedSubLabel(
  creatorName: string | null,
  variant: number,
  isHouse = false,
): string | null {
  if (!creatorName) return null;
  // House and LLM origins are non-relational: no "{name} carries this one".
  if (isHouse || isLlmAttribution(creatorName)) return null;
  const firstName = firstNameFrom(creatorName);
  if (!firstName) return null;
  return WRONG_NAMED_SUBLABEL[variant % WRONG_NAMED_SUBLABEL.length]!(firstName);
}

function bonusSourceLabel(sourceName: string, extraCount: number): string {
  const source = firstNameFrom(sourceName).toUpperCase();
  return extraCount > 0 ? `FROM ${source} + OTHERS’ KNOWLEDGE` : `FROM ${source}’S KNOWLEDGE`;
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

// Inline "Dismissed · Undo" line shown after a question is dropped from
// catch-up. Mirrors NewTerritoryUndo's self-contained optimistic state: the
// undo is awaited, "Undoing…" shows while in flight, and a rejection surfaces
// an inline retry hint without losing the dismissal.
function DismissNoticeRow({ onUndo }: { onUndo: () => Promise<void> }) {
  const [state, setState] = useState<'idle' | 'undoing' | 'error'>('idle');

  const handleUndo = async () => {
    if (state === 'undoing') return;
    setState('undoing');
    try {
      await onUndo();
      // On success the hook rewinds the thread and removes this row; no further
      // state change needed here.
    } catch {
      setState('error');
    }
  };

  return (
    <div className="flex flex-col items-center gap-0.5 py-0.5">
      <p
        style={{
          ...monoStyle,
          fontSize: '0.58rem',
          color: 'var(--text-muted)',
          textAlign: 'center',
        }}
      >
        <span>Dismissed</span>
        <span style={{ margin: '0 6px', opacity: 0.6 }}>·</span>
        {state === 'undoing' ? (
          <span style={{ opacity: 0.7 }}>Undoing…</span>
        ) : (
          <button
            type="button"
            onClick={() => void handleUndo()}
            style={{
              ...monoStyle,
              fontSize: '0.58rem',
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: 'var(--text-muted)',
              textDecoration: 'underline',
              textUnderlineOffset: '2px',
            }}
          >
            Undo
          </button>
        )}
      </p>
      {state === 'error' ? (
        <p
          style={{ ...monoStyle, fontSize: '0.54rem', color: 'var(--danger)', textAlign: 'center' }}
        >
          Could not undo. Try again.
        </p>
      ) : null}
    </div>
  );
}

function QuestionRow({
  subhead,
  badges = [],
  questionText,
  creatorName,
  creatorIsHouse = false,
  presenceSourceName = null,
  presenceSourceExtraCount = 0,
  isNew = false,
  faded = false,
  onGiveUp,
  giveUpDisabled = false,
  onDismiss,
  dismissDisabled = false,
  onMutePresence,
  muteDisabled = false,
}: {
  subhead?: string | null;
  badges?: Array<{ label: string; tone?: 'muted' | 'warning' }>;
  questionText: string;
  creatorName: string | null;
  creatorIsHouse?: boolean;
  presenceSourceName?: string | null;
  presenceSourceExtraCount?: number;
  isNew?: boolean;
  faded?: boolean;
  onGiveUp?: () => void;
  giveUpDisabled?: boolean;
  onDismiss?: () => void;
  dismissDisabled?: boolean;
  // Bonus slots only (D-4 §B): "This is {Name}'s bag but not mine" — rests the
  // slot's domain so the category stops surfacing, and closes this question.
  onMutePresence?: () => void;
  muteDisabled?: boolean;
}) {
  const [visible, setVisible] = useState(!isNew);
  // A bonus slot is one drawn from a followed friend's knowledge (D-4 §B). It
  // gets a distinct gold treatment so it reads as a gift, not just another card.
  const isBonus = Boolean(presenceSourceName);

  useEffect(() => {
    if (!isNew) return;
    const t = window.setTimeout(() => setVisible(true), 30);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="flex flex-col gap-0.5"
      style={
        faded
          ? { opacity: 0.35, transition: 'opacity 0.4s ease', pointerEvents: 'none' }
          : isNew
            ? { opacity: visible ? 1 : 0, transition: 'opacity 0.3s ease' }
            : undefined
      }
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
            fontFamily: 'var(--font-serif), ui-serif, Georgia, serif',
            fontSize: '0.86rem',
            color: 'var(--text)',
            paddingLeft: '2px',
            paddingBottom: '2px',
            opacity: 0.82,
            lineHeight: 1.3,
          }}
        >
          <span
            style={{
              ...monoStyle,
              fontSize: '0.55rem',
              color: 'var(--text-muted)',
              marginRight: '6px',
            }}
          >
            FROM
          </span>
          <span style={{ fontWeight: 600 }}>{creatorName}</span>
          {creatorIsHouse ? <EditorialBadge style={{ marginLeft: '6px' }} /> : null}
          {creatorIsHouse || isLlmAttribution(creatorName) ? null : (
            <span style={{ marginLeft: '6px', opacity: 0.55, fontStyle: 'italic' }}>
              gave you this
            </span>
          )}
        </p>
      ) : null}
      <div
        style={{
          alignSelf: 'flex-start',
          maxWidth: THREAD_CARD_MAX_WIDTH,
          width: '100%',
        }}
      >
        {presenceSourceName ? (
          <div
            style={{
              borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
              border: '1px solid var(--brand-navy)',
              borderBottom: 'none',
              background:
                'linear-gradient(135deg, var(--brand-navy), color-mix(in srgb, var(--brand-navy) 82%, var(--accent)))',
              boxShadow: '0 8px 20px rgba(13, 31, 58, 0.18)',
              color: 'var(--primary-foreground)',
              padding: '9px 13px 8px',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '6px 10px',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.64rem',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.16em',
                  lineHeight: 1.25,
                }}
              >
                <span
                  aria-hidden
                  style={{ color: 'var(--accent-gold)', fontSize: '0.8rem', lineHeight: 1 }}
                >
                  ✦
                </span>
                Bonus item
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.6rem',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.12em',
                  lineHeight: 1.25,
                  color: 'color-mix(in srgb, var(--accent-gold) 35%, white)',
                }}
              >
                {bonusSourceLabel(presenceSourceName, presenceSourceExtraCount)}
              </span>
            </div>
          </div>
        ) : null}
        <div
          style={{
            // Bonus questions get a navy banner plus warm card tint so the
            // gifted-from-a-friend item reads as an extra, not an ordinary prompt.
            background: isBonus
              ? 'color-mix(in srgb, var(--accent-gold) 10%, var(--game-card-question))'
              : 'var(--game-card-question)',
            border: isBonus
              ? '1px solid color-mix(in srgb, var(--brand-navy) 72%, var(--accent-gold))'
              : '1px solid var(--brand-rule)',
            borderRadius: isBonus ? '0 0 var(--radius-md) var(--radius-md)' : 'var(--radius-md)',
            // effect/card/question — soft layered drop shadow (bonus adds a gold inset rail).
            boxShadow: isBonus
              ? '0 8px 22px rgba(13, 31, 58, 0.14), 0 1px 3px rgba(40, 32, 30, 0.08), inset 4px 0 0 var(--accent-gold)'
              : '0 4px 16px rgba(40, 32, 30, 0.08), 0 1px 3px rgba(40, 32, 30, 0.06)',
            padding: '20px 22px',
            fontFamily: 'var(--font-serif)',
            fontSize: '1.4875rem',
            fontWeight: 700,
            letterSpacing: 0,
            color: 'var(--brand-ink)',
            lineHeight: 1.3,
          }}
        >
          <p style={{ margin: 0 }}>{questionText}</p>
          {badges.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '12px' }}>
              {badges.map((badge) => (
                <span
                  key={badge.label}
                  style={{
                    // Figma display/pill/sans — serif, 12px, title-case (not the
                    // mono uppercase used elsewhere).
                    fontFamily: 'var(--font-serif)',
                    fontSize: '0.675rem',
                    lineHeight: 1.1,
                    letterSpacing: '0.01em',
                    borderRadius: '999px',
                    border: '1px solid var(--border)',
                    background:
                      badge.tone === 'warning'
                        ? 'color-mix(in srgb, var(--accent-gold) 14%, var(--surface))'
                        : 'color-mix(in srgb, var(--border) 18%, var(--surface))',
                    color: badge.tone === 'warning' ? GOLD_INK : 'var(--text-muted)',
                    opacity: 0.9,
                    padding: '3px 9px',
                  }}
                >
                  {badge.label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {!faded && (onGiveUp || onDismiss || onMutePresence) ? (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '14px',
            marginTop: '4px',
            paddingLeft: '2px',
          }}
        >
          {onGiveUp ? (
            <button
              type="button"
              onClick={onGiveUp}
              disabled={giveUpDisabled}
              style={questionActionLinkStyle}
            >
              Show me the answer
            </button>
          ) : null}
          {onMutePresence && presenceSourceName ? (
            <button
              type="button"
              onClick={onMutePresence}
              disabled={muteDisabled}
              style={questionActionLinkStyle}
            >
              This is {firstNameFrom(presenceSourceName)}&rsquo;s bag but not mine
            </button>
          ) : null}
          {onDismiss ? (
            <button
              type="button"
              onClick={onDismiss}
              disabled={dismissDisabled}
              style={questionActionLinkStyle}
            >
              Dismiss
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Shared style for the muted mono action links beneath a question card
// ("Show me the answer", "Dismiss").
const questionActionLinkStyle: CSSProperties = {
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
};

function UserRow({ text }: { text: string }) {
  return (
    <div className="flex justify-end py-0">
      <div
        style={{
          maxWidth: '88%',
          background: 'var(--brand-navy)',
          borderRadius: 'var(--radius-md) var(--radius-md) 0 var(--radius-md)',
          padding: '12px 18px',
          // Figma answer bubble — Cormorant serif, not the sans body font.
          fontFamily: 'var(--font-serif)',
          fontSize: '1.495rem',
          fontWeight: 700,
          letterSpacing: '-0.01em',
          lineHeight: 1.32,
          color: 'var(--primary-foreground)',
        }}
      >
        {text}
      </div>
    </div>
  );
}

// The explainer that sits directly beneath the revealed answer. Plain, readable
// secondary text — no quote-block inset, no decorative italics — so the answer
// stays the focal point and the card reads as a thread object, not an article
// (mirrors the screenshot treatment: label → answer → plain explainer).
function ExplainerLine({ text }: { text: string }) {
  return (
    <p
      style={{
        marginTop: '8px',
        fontFamily: 'var(--font-serif), ui-serif, Georgia, serif',
        fontSize: '0.92rem',
        color: 'color-mix(in srgb, var(--text-muted) 35%, var(--text))',
        lineHeight: 1.5,
      }}
    >
      {text}
    </p>
  );
}

function reactionEmoji(value: string): string {
  switch (value) {
    case ':exploding_head:':
      return '🤯';
    case ':ok_hand:':
      return '👌';
    case ':smirk:':
      return '😏';
    case ':face_palm:':
      return '🤦';
    case ':sunny:':
      return '☀️';
    case ':thought_balloon:':
      return '💭';
    case ':thinking_face:':
      return '🤔';
    case ':open_book:':
      return '📖';
    case ':memo:':
      return '📝';
    case ':sweat_smile:':
      return '😅';
    default:
      return value;
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

  const sendReaction = useCallback(
    async (reactionType: ReactionKey) => {
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
    },
    [
      customMessage,
      includeSubmittedAnswer,
      prompt.contextId,
      prompt.contextType,
      prompt.questionId,
    ],
  );

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
      <p
        style={{
          ...monoStyle,
          marginBottom: '6px',
          fontSize: '0.6rem',
          color: 'var(--text-muted)',
        }}
      >
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
            border: '1px solid var(--accent-gold)',
            background: 'var(--brand-field)',
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
      <div
        style={{
          display: 'flex',
          gap: '6px',
          maxWidth: '100%',
          overflowX: 'auto',
          paddingBottom: '3px',
        }}
      >
        {cannedSet.map((reaction) => (
          <button
            key={reaction.key}
            type="button"
            onClick={() => void sendReaction(reaction.key)}
            disabled={status === 'sending'}
            style={{
              flex: '0 0 auto',
              display: 'inline-flex',
              alignItems: 'center',
              minHeight: '44px',
              borderRadius: '999px',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              padding: '0 14px',
              fontSize: '0.78rem',
              cursor: status === 'sending' ? 'default' : 'pointer',
            }}
          >
            <span aria-hidden style={{ marginRight: '5px' }}>
              {reactionEmoji(reaction.emoji)}
            </span>
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
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '44px',
            height: '44px',
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

function AuthorNoteCard({
  text,
  creatorName,
  creatorIsHouse = false,
}: {
  text: string;
  creatorName: string | null;
  creatorIsHouse?: boolean;
}) {
  return (
    <ThreadCard border="var(--border)" fill="var(--surface-2)" style={{ marginTop: '8px' }}>
      <p
        style={{
          ...monoStyle,
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '0.55rem',
          color: 'var(--text-muted)',
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
        }}
      >
        {/* House notes are editorial, never relational — no "Why {name} asked". */}
        {creatorIsHouse ? (
          <>
            <span>Editor&rsquo;s note</span>
            <EditorialBadge />
          </>
        ) : (
          <span>{creatorName ? `Why ${creatorName} asked` : 'Why they asked'}</span>
        )}
      </p>
      <p
        style={{
          marginTop: '4px',
          fontFamily: 'var(--font-serif), ui-serif, Georgia, serif',
          // Reflection/creator-note body bumped ~14% for readability (D-5);
          // the eyebrow label above stays small and secondary.
          fontSize: '1.05rem',
          lineHeight: 1.5,
        }}
      >
        {text}
      </p>
    </ThreadCard>
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
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          padding: '10px 16px',
          fontSize: '0.9rem',
          color: 'var(--text-muted)',
          fontStyle: 'italic',
        }}
        aria-live="polite"
      >
        <span>Grading</span>
        <span aria-hidden="true" style={{ display: 'inline-flex', gap: '3px' }}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="grading-dot"
              style={{
                width: '4px',
                height: '4px',
                borderRadius: '50%',
                background: 'currentColor',
                animationDelay: `${i * 0.16}s`,
              }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

function ResultRow({
  result,
  correctAnswer,
  consolation,
  insideJoke,
  insideJokeKind,
  authorNote,
  explanation,
  copyVariant,
  creatorName,
  creatorIsHouse = false,
  reactionPrompt,
  pointsAwarded,
  pointsLabel,
  recheckAction,
  canonicalSubcategory,
  openedTerritoryDomain,
}: {
  result: 'correct' | 'wrong' | 'expired' | 'gave_up';
  submitted: string;
  questionText: string;
  correctAnswer: string | null;
  consolation: string | null;
  insideJoke?: string | null;
  insideJokeKind?: InsideJokeKind | null;
  breadcrumb: string | null;
  authorNote?: string | null;
  explanation?: string | null;
  copyVariant: number;
  creatorName: string | null;
  creatorIsHouse?: boolean;
  canonicalSubcategory?: string | null;
  reactionPrompt?: ReactionPromptData | null;
  pointsAwarded?: number | null;
  pointsLabel?: string | null;
  recheckAction?: RecheckAction | null;
  openedTerritoryDomain?: string | null;
}) {
  const [recheckState, setRecheckState] = useState<'idle' | 'submitting' | 'done' | 'error'>(
    'idle',
  );
  const [recheckMessage, setRecheckMessage] = useState<string | null>(null);
  const [recheckAccepted, setRecheckAccepted] = useState(false);
  const expired = result === 'expired';
  const correct = result === 'correct';
  const gaveUp = result === 'gave_up';
  // Every reveal shows a one-sentence explainer directly under the answer; the
  // full text always remains in the End of Session Review, so nothing is lost.
  // Sourced from the stored explainer that arrives with the answer response —
  // not the async breadcrumb — so the line is shown once and never swaps in
  // longer/replacement content after the fact.
  const explainerSentence = explanation ? firstSentence(explanation) : null;
  // Correct keeps its explainer inline within the verdict block (before the
  // "common ground" beat); the other reveals render it after the discovery copy.
  const showDiscoveryExplainer = !correct && Boolean(explainerSentence);
  // One reflection beneath the verdict: the lighter "Between us!" wink is
  // preferred over the creator note, which otherwise falls back in on correct
  // answers. The wink renders as an inset panel INSIDE the result card (one
  // item, not a second card); the fuller creator note lives in the review.
  const showJokeCard = Boolean(insideJoke);
  const showNoteCard = correct && !insideJoke && Boolean(authorNote);
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

  // Verdict tone as accent only — the shared ThreadCard shell supplies the
  // radius/padding/border family; the result card varies by a color-coded left
  // rail (green "nailed it", terracotta "not quite") and a faint matching tint.
  const tone = expired
    ? { rail: 'var(--border)', border: 'var(--border)', fill: 'var(--surface-2)' }
    : correct
      ? {
          rail: 'var(--game-correct)',
          border: 'color-mix(in srgb, var(--game-correct) 26%, var(--border))',
          fill: 'color-mix(in srgb, var(--game-correct) 6%, var(--surface))',
        }
      : gaveUp
        ? {
            rail: 'color-mix(in srgb, var(--brand-ink) 35%, transparent)',
            border: 'var(--border)',
            fill: 'var(--surface-2)',
          }
        : {
            rail: 'var(--game-wrong-strong)',
            border: 'color-mix(in srgb, var(--game-wrong) 30%, var(--border))',
            fill: 'color-mix(in srgb, var(--game-wrong) 12%, var(--surface))',
          };

  return (
    <div
      className="result-reveal flex flex-col gap-0 pt-0.5"
      style={{ alignItems: 'flex-start', maxWidth: THREAD_CARD_MAX_WIDTH }}
    >
      <ThreadCard
        rail={tone.rail}
        border={tone.border}
        fill={tone.fill}
        style={{ fontSize: '0.81rem', lineHeight: 1.36 }}
      >
        {expired ? (
          <span style={{ color: 'var(--text-muted)' }}>This one wasn&apos;t recorded in time.</span>
        ) : correct ? (
          <>
            {/* Compact, calm success moment: quiet verdict label, the correct
                answer repeated immediately (even on a right answer) as the focal
                point, then the light "common ground" beat. The fuller
                explanation lives in the End of Session Review. */}
            <p style={{ ...verdictLabelStyle, color: 'var(--game-correct)' }}>
              <span aria-hidden>✓</span>
              Locked in.
            </p>
            {correctAnswer ? (
              <p
                style={{
                  ...answerHeadingStyle,
                  marginTop: '8px',
                  fontSize: '1.85rem',
                  color: 'var(--game-correct)',
                }}
              >
                {correctAnswer}
              </p>
            ) : null}
            {explainerSentence ? <ExplainerLine text={explainerSentence} /> : null}
            <p
              style={{
                marginTop: '8px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.62rem',
                letterSpacing: '0.04em',
                color: 'color-mix(in srgb, var(--game-correct) 70%, var(--text-muted))',
              }}
            >
              common ground ++
            </p>
          </>
        ) : gaveUp ? (
          <>
            {/* Answer-reveal after "show me the answer": quiet label, the answer
                as the focal point, then a plain explainer below (no quote-block,
                no editorial italics). */}
            <p style={{ ...verdictLabelStyle, color: 'var(--text-muted)' }}>The answer</p>
            {correctAnswer ? (
              <p
                style={{
                  ...answerHeadingStyle,
                  marginTop: '8px',
                  fontSize: '1.85rem',
                  color: 'var(--brand-ink)',
                }}
              >
                {correctAnswer}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p
              style={{
                fontFamily: 'var(--font-serif), ui-serif, Georgia, serif',
                color: 'var(--game-wrong-strong)',
                fontWeight: 600,
              }}
            >
              <span aria-hidden style={{ marginRight: '6px' }}>
                ✕
              </span>
              {wrongHeadline(copyVariant)}
            </p>
            {correctAnswer ? (
              <p
                style={{
                  ...answerHeadingStyle,
                  marginTop: '8px',
                  // Figma question/game/answer — Cormorant Bold, scaled to match
                  // question text; bumped ~12% so the repeated answer reads clearly.
                  fontSize: '1.85rem',
                  color: 'var(--brand-ink)',
                }}
              >
                {correctAnswer}
              </p>
            ) : null}
            <p
              style={{
                ...monoStyle,
                fontSize: '0.55rem',
                color: 'var(--text-muted)',
                marginTop: '4px',
              }}
            >
              Now it&rsquo;s in yours too
            </p>
            {(() => {
              const namedSubLabel = wrongNamedSubLabel(creatorName, copyVariant, creatorIsHouse);
              return namedSubLabel ? (
                <p
                  style={{
                    ...monoStyle,
                    fontSize: '0.6rem',
                    color: 'var(--text-muted)',
                    marginTop: '4px',
                  }}
                >
                  {namedSubLabel}
                </p>
              ) : null;
            })()}
            {consolation ? (
              <p
                style={{
                  marginTop: '8px',
                  fontSize: '0.88rem',
                  color: 'var(--text-muted)',
                  fontStyle: 'italic',
                }}
              >
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
                    cursor:
                      recheckState === 'submitting' || recheckState === 'done'
                        ? 'default'
                        : 'pointer',
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
                        border:
                          '1px solid color-mix(in srgb, var(--game-correct) 35%, var(--border))',
                        background: 'color-mix(in srgb, var(--game-correct) 12%, var(--surface))',
                        color: 'var(--game-correct)',
                        padding: '8px 12px',
                        fontSize: '0.85rem',
                        fontWeight: 500,
                        lineHeight: 1.35,
                      }}
                    >
                      <span aria-hidden style={{ fontSize: '1rem', lineHeight: 1 }}>
                        ✓
                      </span>
                      <span>{recheckMessage}</span>
                    </div>
                  ) : (
                    <p
                      role="status"
                      aria-live="polite"
                      style={{
                        marginTop: '6px',
                        fontSize: '0.78rem',
                        color: recheckState === 'error' ? 'var(--danger)' : 'var(--text-muted)',
                        lineHeight: 1.35,
                      }}
                    >
                      {recheckMessage}
                    </p>
                  )
                ) : null}
              </div>
            ) : null}
          </>
        )}
        {showDiscoveryExplainer && explainerSentence ? (
          <ExplainerLine text={explainerSentence} />
        ) : null}
        {showJokeCard && insideJoke ? (
          <div
            style={{
              marginTop: '12px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid color-mix(in srgb, var(--brand-link) 22%, var(--border))',
              background: 'var(--editorial-slate)',
              padding: '10px 12px',
            }}
          >
            <p
              style={{
                ...monoStyle,
                fontSize: '0.55rem',
                color: GOLD_INK,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
              }}
            >
              {INSIDE_JOKE_LABELS[insideJokeKind ?? 'relational']}
            </p>
            <p
              style={{
                marginTop: '4px',
                fontFamily: 'var(--font-serif), ui-serif, Georgia, serif',
                // Reflection body bumped ~14% for readability (D-5); the small,
                // letter-spaced label above stays secondary.
                fontSize: '1.05rem',
                lineHeight: 1.5,
              }}
            >
              {insideJoke}
            </p>
          </div>
        ) : null}
        {typeof pointsAwarded === 'number' ? (
          <p
            style={{
              ...monoStyle,
              fontSize: '0.55rem',
              color: 'var(--text-muted)',
              marginTop: '10px',
            }}
          >
            +{pointsAwarded} {pointsAwarded === 1 ? 'point' : 'points'}
            {pointsLabel ? ` - ${pointsLabel}` : ''}
          </p>
        ) : null}
      </ThreadCard>
      {showNoteCard && authorNote ? (
        <AuthorNoteCard
          text={authorNote}
          creatorName={creatorName}
          creatorIsHouse={creatorIsHouse}
        />
      ) : null}
      {correct && openedTerritoryDomain ? (
        <NewTerritoryUndo domain={openedTerritoryDomain} category={canonicalSubcategory} />
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
    <ThreadCard
      className="mt-4"
      border="var(--border)"
      fill="var(--surface-2)"
      style={{ maxWidth: THREAD_CARD_MAX_WIDTH }}
    >
      <SessionCloseMessage scoreLine={scoreLine} interpretiveLine={interpretiveLine} />
      {summaryHref ? (
        <div className="pt-3">
          <Link href={summaryHref} className="btn-primary inline-flex">
            See summary →
          </Link>
        </div>
      ) : null}
    </ThreadCard>
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
        border: '1px solid color-mix(in srgb, var(--game-correct) 40%, var(--border))',
        background: 'color-mix(in srgb, var(--game-correct) 8%, var(--surface))',
        padding: '1.25rem 1.25rem 1.25rem',
      }}
    >
      <p
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.6rem',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          color: 'var(--game-correct)',
          marginBottom: '0.5rem',
        }}
      >
        Round complete
      </p>
      <p
        style={{
          fontFamily: 'var(--font-serif), ui-serif, Georgia, serif',
          fontSize: '2rem',
          fontWeight: 600,
          color: 'var(--game-correct)',
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
          style={{
            color: 'var(--text-muted)',
            textDecoration: 'underline',
            textUnderlineOffset: '2px',
          }}
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
          fontFamily: 'var(--font-serif), ui-serif, Georgia, serif',
          fontSize: '1.3rem',
          fontWeight: 600,
          color: 'var(--text)',
          lineHeight: 1.2,
        }}
      >
        {available} more {available === 1 ? 'question' : 'questions'} in the pool.
      </p>
      <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
        Untimed. Counts toward your score.
      </p>
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
  onGiveUp,
  giveUpDisabled,
  onDismiss,
  dismissDisabled,
  onMutePresence,
  muteDisabled,
}: {
  messages: ChatMessage[];
  onGiveUp?: () => void;
  giveUpDisabled?: boolean;
  onDismiss?: () => void;
  dismissDisabled?: boolean;
  // Bonus-slot opt-out (D-4 §B). Wired only to the active bonus question.
  onMutePresence?: () => void;
  muteDisabled?: boolean;
}) {
  // "Show me the answer" and "Dismiss" belong only under the active (still-
  // unanswered) question — the last question message with no result after it.
  // Without this gate the thread would attach them to every historical row.
  const lastQuestionIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].kind === 'question') return i;
    }
    return -1;
  })();
  const activeQuestionId =
    lastQuestionIndex >= 0 &&
    !messages.slice(lastQuestionIndex + 1).some((m) => m.kind === 'result')
      ? messages[lastQuestionIndex].id
      : null;

  return (
    <div className="space-y-2.5">
      {messages.map((m) => {
        switch (m.kind) {
          case 'system':
            return <SystemRow key={m.id} text={m.text} />;
          case 'dismiss_notice':
            return <DismissNoticeRow key={m.id} onUndo={m.onUndo} />;
          case 'question':
            return (
              <QuestionRow
                key={m.id}
                questionText={m.questionText}
                creatorName={m.creatorName}
                creatorIsHouse={m.creatorIsHouse}
                presenceSourceName={m.presenceSourceName}
                presenceSourceExtraCount={m.presenceSourceExtraCount}
                isNew={m.isNew}
                faded={m.faded}
                subhead={m.subhead}
                badges={m.badges}
                onGiveUp={onGiveUp && m.id === activeQuestionId ? onGiveUp : undefined}
                giveUpDisabled={giveUpDisabled}
                onDismiss={onDismiss && m.id === activeQuestionId ? onDismiss : undefined}
                dismissDisabled={dismissDisabled}
                onMutePresence={
                  onMutePresence && m.id === activeQuestionId && m.presenceSourceName
                    ? onMutePresence
                    : undefined
                }
                muteDisabled={muteDisabled}
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
                insideJokeKind={m.insideJokeKind}
                breadcrumb={m.breadcrumb}
                authorNote={m.authorNote}
                explanation={m.explanation}
                copyVariant={m.copyVariant}
                creatorName={m.creatorName}
                creatorIsHouse={m.creatorIsHouse}
                canonicalSubcategory={m.canonicalSubcategory}
                reactionPrompt={m.reactionPrompt}
                pointsAwarded={m.pointsAwarded}
                pointsLabel={m.pointsLabel}
                recheckAction={m.recheckAction}
                openedTerritoryDomain={m.openedTerritoryDomain}
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
