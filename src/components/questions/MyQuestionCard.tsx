'use client';

import { Lock, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { visibleFeedCategory } from '@/components/feed/category';
import { SendQuestionAction } from '@/components/SendQuestionAction';
import { difficultyCopyFromValue } from '@/lib/questions/difficulty-copy';
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
  const difficultyLabel = difficultyCopyFromValue(question.difficulty) ?? 'Unrated';
  const visibleCategory = visibleFeedCategory(question.domainDisplayName);
  const answerersLine =
    question.isOwnAuthored && question.answerers ? formatAnswerersLine(question.answerers) : null;

  return (
    <article
      className={cn(
        'bg-card rounded-md border px-4 py-3 transition duration-200',
        deleting ? 'scale-[0.98] opacity-0' : 'opacity-100',
      )}
    >
      <div className="flex items-start gap-3 sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2 pr-2">
            {visibleCategory ? (
              <span
                className="truncate text-[12px] leading-tight italic"
                style={{
                  fontFamily: 'var(--font-literata)',
                  color: 'var(--ink)',
                  opacity: 0.7,
                }}
              >
                {visibleCategory}
              </span>
            ) : null}
            <span
              className="rounded-full bg-[rgba(0,0,0,0.06)] px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase"
              style={{ color: 'var(--ink)', opacity: 0.7 }}
              aria-label={`LLM-rated difficulty: ${difficultyLabel}`}
            >
              {difficultyLabel}
            </span>
          </div>

          <p
            className="mt-1.5 font-serif text-[18px] leading-6 font-semibold tracking-[0.02em]"
            style={{ color: 'var(--ink)' }}
          >
            {question.text}
          </p>

          <div className="mt-2 flex flex-col gap-1 text-[13px] leading-snug sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
            <p style={{ color: 'var(--ink)', opacity: 0.65 }}>
              {question.timesAnswered} answers · {question.correctRate}% correct ·{' '}
              {question.usedInGamesCount} games
            </p>
            {question.nobody_correct_flag ? (
              // "Nobody got it" review smell (B4 Phase 2): a QA signal that enough
              // players have tried with none correct — likely a bad answer, not a
              // hard question. Flagged for review, never auto-removed.
              <p
                className="inline-flex items-center gap-1 font-medium"
                style={{ color: 'var(--ink)', opacity: 0.8 }}
              >
                ⚠ Nobody&apos;s gotten this right — flagged for review
              </p>
            ) : null}
            {answerersLine ? (
              <p style={{ color: 'var(--ink)', opacity: 0.65 }}>{answerersLine}</p>
            ) : null}
          </div>

          {cardError ? <p className="text-destructive mt-2 text-[13px]">{cardError}</p> : null}

          {confirming ? (
            <DeleteConfirmation
              onConfirmDelete={onConfirmDelete}
              onCancelConfirm={onCancelConfirm}
            />
          ) : (
            <div className="mt-3 sm:hidden">
              <SendQuestionAction
                question={{
                  id: question.id,
                  text: question.text,
                  domain: question.domainDisplayName,
                }}
              />
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-start gap-2">
          {!confirming ? (
            <div className="hidden sm:block">
              <SendQuestionAction
                question={{
                  id: question.id,
                  text: question.text,
                  domain: question.domainDisplayName,
                }}
              />
            </div>
          ) : null}
          <CardOverflowMenu inUse={inUse} onEdit={onEdit} onDelete={onDeleteRequest} />
        </div>
      </div>
    </article>
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
