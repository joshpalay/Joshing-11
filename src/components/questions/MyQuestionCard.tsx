'use client';

import { Lock, MoreHorizontal, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { visibleFeedCategory } from '@/components/feed/category';
import { Chip } from '@/components/ui/Chip';
import { SendQuestionAction } from '@/components/SendQuestionAction';
import { difficultyCopyFromValue } from '@/lib/questions/difficulty-copy';
import type { QuestionView } from '@/server/db/queries/questions';

type MyQuestionCardProps = {
  question: QuestionView;
  confirming: boolean;
  cardError?: string;
  deleting: boolean;
  onEdit: () => void;
  onDeleteRequest: () => void;
  onConfirmDelete: () => void;
  onCancelConfirm: () => void;
};

export function MyQuestionCard({
  question,
  confirming,
  cardError,
  deleting,
  onDeleteRequest,
  onConfirmDelete,
  onCancelConfirm,
}: MyQuestionCardProps) {
  const inUse = question.usedInGamesCount > 0;
  const difficultyLabel = difficultyCopyFromValue(question.difficulty) ?? 'Unrated';
  const visibleCategory = visibleFeedCategory(question.domainDisplayName);
  const answerersLine = question.isOwnAuthored && question.answerers
    ? formatAnswerersLine(question.answerers)
    : null;

  return (
    <article
      className={`flex items-start gap-3 py-4 transition duration-200 ${deleting ? 'scale-[0.98] opacity-0' : 'opacity-100'}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {visibleCategory ? (
            <span
              className="truncate text-[10px] uppercase tracking-[0.1em] leading-tight"
              style={{
                // Category label is metadata — System voice (mono) with the
                // caps + tracking label signature, per STYLE-GUIDE-TYPE §2/§5.
                fontFamily: 'var(--font-mono)',
                color: 'var(--ink)',
                opacity: 0.7,
              }}
            >
              {visibleCategory}
            </span>
          ) : null}
          <Chip
            size="sm"
            uppercase
            className="bg-[rgba(0,0,0,0.06)] tracking-wide"
            style={{ color: 'var(--ink)', opacity: 0.7 }}
            aria-label={`LLM-rated difficulty: ${difficultyLabel}`}
          >
            {difficultyLabel}
          </Chip>
        </div>

        <p className="mt-2 font-serif text-[20px] font-semibold leading-[28px] tracking-[0.04em] text-[var(--brand-ink)]">
          <span aria-hidden className="opacity-60">
            &ldquo;
          </span>
          {question.text}
          <span aria-hidden className="opacity-60">
            &rdquo;
          </span>
        </p>

        {answerersLine ? (
          <p
            className="mt-2 text-[13px] leading-snug"
            style={{ color: 'var(--ink)', opacity: 0.65 }}
          >
            {answerersLine}
          </p>
        ) : null}
        <p className={`${answerersLine ? 'mt-1' : 'mt-2'} text-[13px] leading-snug`}>
          <Stat value={`${question.timesAnswered}`} label="answers" />
          <StatSeparator />
          <Stat value={`${question.correctRate}%`} label="correct" />
          <StatSeparator />
          <Stat value={`${question.usedInGamesCount}`} label="games" />
        </p>
        {question.reportState ? <ReportStateNotice state={question.reportState} /> : null}
        {cardError ? (
          <p className="mt-2 text-[13px] text-destructive">{cardError}</p>
        ) : null}
        {confirming ? (
          <div className="mt-3 flex items-center gap-2">
            <span
              className="mr-auto text-[13px] font-medium"
              style={{ color: 'var(--ink)' }}
            >
              Delete this question?
            </span>
            <button
              className="rounded-md border border-destructive px-3 py-2 text-sm text-destructive"
              type="button"
              onClick={onConfirmDelete}
            >
              Confirm
            </button>
            <button
              className="rounded-md border px-3 py-2 text-sm"
              type="button"
              onClick={onCancelConfirm}
            >
              Cancel
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-1">
        <CardOverflowMenu inUse={inUse} onDelete={onDeleteRequest} />
        <SendQuestionAction
          question={{
            id: question.id,
            text: question.text,
            domain: question.domainDisplayName,
          }}
          label=""
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
        />
      </div>
    </article>
  );
}

// B-Report-4: the quiet author-facing report state. Deliberately muted — no red,
// no badge, no reporter identity. "needs attention" carries the correction so the
// author can fix it; "removed" is the read-only upheld-inappropriate terminal state.
function ReportStateNotice({ state }: { state: NonNullable<QuestionView['reportState']> }) {
  if (state.kind === 'removed') {
    return (
      <div
        className="mt-2 rounded-md border px-2.5 py-2 text-[13px] leading-snug"
        style={{ borderColor: 'var(--border)', color: 'var(--ink)', opacity: 0.8 }}
      >
        <p className="font-medium">This question was removed.</p>
        <p className="mt-0.5" style={{ opacity: 0.75 }}>
          It was found inappropriate after review.
        </p>
      </div>
    );
  }

  const concern =
    state.incorrectKind === 'answer_key'
      ? 'A reader thinks the answer key is wrong.'
      : state.incorrectKind === 'premise'
        ? 'A reader thinks the question itself is off.'
        : 'A reader raised a concern about this one.';

  return (
    <div
      className="mt-2 rounded-md border px-2.5 py-2 text-[13px] leading-snug"
      style={{
        borderColor: 'var(--border)',
        background: 'color-mix(in srgb, var(--ink) 3%, transparent)',
        color: 'var(--ink)',
      }}
    >
      <p className="font-medium" style={{ opacity: 0.85 }}>
        Needs a second look
      </p>
      <p className="mt-0.5" style={{ opacity: 0.7 }}>
        {concern}
      </p>
      <p className="mt-0.5 italic" style={{ opacity: 0.7 }}>
        &ldquo;{state.note}&rdquo;
      </p>
      {state.suggestedAnswer ? (
        <p className="mt-0.5" style={{ opacity: 0.7 }}>
          They suggested: {state.suggestedAnswer}
        </p>
      ) : null}
      <p className="mt-1" style={{ opacity: 0.6 }}>
        Update the answer key to clear this.
      </p>
    </div>
  );
}

function CardOverflowMenu({
  inUse,
  onDelete,
}: {
  inUse: boolean;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const lockedTitle = 'Used in a game — cannot be deleted';

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <MoreHorizontal className="size-4" />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-44 rounded-md border bg-background p-1 shadow-md"
        >
          <button
            type="button"
            role="menuitem"
            disabled={inUse}
            title={inUse ? lockedTitle : undefined}
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {inUse ? <Lock className="size-4" /> : <Trash2 className="size-4" />}
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}

// The metric value stays at full ink while its unit label sits back, so the eye
// lands on the number (e.g. "5 answers", "80% correct") rather than the noun.
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <span>
      <span style={{ color: 'var(--ink)' }}>{value}</span>
      <span style={{ color: 'var(--ink)', opacity: 0.45 }}> {label}</span>
    </span>
  );
}

function StatSeparator() {
  return (
    <span style={{ color: 'var(--ink)', opacity: 0.45 }}> · </span>
  );
}

function formatAnswerersLine(answerers: { names: string[]; total: number }): string | null {
  const { names, total } = answerers;
  if (total <= 0 || names.length === 0) return null;
  const [first, second] = names;
  if (total === 1) return `${first} answered your question`;
  if (total === 2 && second) return `${first} and ${second} answered your question`;
  const others = total - 1;
  return `${first} and ${others} ${others === 1 ? 'other' : 'others'} answered your question`;
}
