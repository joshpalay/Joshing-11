'use client';

import { ChevronUp, Lock, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { SendQuestionAction } from '@/components/SendQuestionAction';
import { cn } from '@/lib/utils';
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
  onEdit,
  onDeleteRequest,
  onConfirmDelete,
  onCancelConfirm,
}: MyQuestionCardProps) {
  const inUse = question.usedInGamesCount > 0;
  const hasAnswers = question.timesAnswered > 0;
  const answerersLine =
    question.isOwnAuthored && question.answerers ? formatAnswerersLine(question.answerers) : null;

  return (
    <article
      className={cn(
        'bg-card relative rounded-md border px-3 py-2 transition duration-200',
        deleting ? 'scale-[0.98] opacity-0' : 'opacity-100',
      )}
    >
      {/* Overflow menu is associated with the whole card — pinned top-right, visually quiet. */}
      <div className="absolute top-1.5 right-1.5">
        <CardOverflowMenu inUse={inUse} onEdit={onEdit} onDelete={onDeleteRequest} />
      </div>

      <div className="min-w-0">
        <p
          className="pr-8 font-serif text-lg leading-6 font-semibold tracking-[0.02em]"
          style={{ color: 'var(--ink)' }}
        >
          {question.text}
        </p>

        {answerersLine ? (
          <p
            className="mt-1 inline-flex items-center gap-1 text-xs leading-tight"
            style={{ color: 'var(--ink)', opacity: 0.65 }}
          >
            <ChevronUp className="size-3 shrink-0" />
            {answerersLine}
          </p>
        ) : null}

        {question.reportState ? <ReportStateNotice state={question.reportState} /> : null}

        {cardError ? <p className="text-destructive mt-1.5 text-[13px]">{cardError}</p> : null}

        {confirming ? (
          <DeleteConfirmation onConfirmDelete={onConfirmDelete} onCancelConfirm={onCancelConfirm} />
        ) : (
          // Single compact analytics row: metrics align in columns across cards (tabular-nums
          // + a fixed-width Answers segment) so creators can scan answer/correct rates
          // vertically. Metrics are omitted entirely when nobody has answered yet; the send
          // icon stays (subdued) so the question is still shareable.
          <div className="mt-1.5 flex items-center text-[13px] leading-snug">
            {hasAnswers ? (
              <div
                className="flex items-center gap-x-6"
                style={{ color: 'var(--ink)', opacity: 0.65 }}
              >
                <span className="inline-flex min-w-[5.5rem] items-center gap-1.5">
                  <span>Answers</span>
                  <span className="font-medium tabular-nums">{question.timesAnswered}</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span>Correct</span>
                  <span className="font-medium tabular-nums">{question.correctRate}%</span>
                </span>
              </div>
            ) : null}
            <div className="ml-auto">
              <SendQuestionAction
                question={{
                  id: question.id,
                  text: question.text,
                  domain: question.domainDisplayName,
                }}
                label=""
                className={cn(
                  'hover:bg-muted -mr-1 inline-flex size-8 items-center justify-center rounded-md transition',
                  hasAnswers ? 'text-[color:var(--brand-navy)]' : 'text-muted-foreground',
                )}
              />
            </div>
          </div>
        )}
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

function DeleteConfirmation({
  onConfirmDelete,
  onCancelConfirm,
}: {
  onConfirmDelete: () => void;
  onCancelConfirm: () => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="mr-auto text-[13px] font-medium" style={{ color: 'var(--ink)' }}>
        Delete this question?
      </span>
      <button
        className="border-destructive text-destructive rounded-md border px-3 py-2 text-sm"
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
  );
}

function CardOverflowMenu({
  inUse,
  onEdit,
  onDelete,
}: {
  inUse: boolean;
  onEdit: () => void;
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

  const lockedTitle = 'Used in a game — cannot be edited';

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
        className="text-muted-foreground hover:bg-muted hover:text-foreground -mr-1 inline-flex size-8 items-center justify-center rounded-md transition"
      >
        <MoreHorizontal className="size-4" />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          className="bg-background absolute top-full right-0 z-30 mt-1 w-44 rounded-md border p-1 shadow-md"
        >
          <button
            type="button"
            role="menuitem"
            disabled={inUse}
            title={inUse ? lockedTitle : undefined}
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
            className="hover:bg-muted flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {inUse ? <Lock className="size-4" /> : <Pencil className="size-4" />}
            Edit
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={inUse}
            title={inUse ? lockedTitle : undefined}
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className="text-destructive hover:bg-muted flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {inUse ? <Lock className="size-4" /> : <Trash2 className="size-4" />}
            Delete
          </button>
        </div>
      ) : null}
    </div>
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
