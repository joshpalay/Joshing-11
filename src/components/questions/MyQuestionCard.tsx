'use client';

import { Lock, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { FeedCard } from '@/components/feed/FeedCard';
import { visibleFeedCategory } from '@/components/feed/category';
import type { FeedCardBaseItem } from '@/components/feed/types';
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
  onEdit,
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

  const item: FeedCardBaseItem = {
    id: question.id,
    metadata: null,
    question: question.text,
    category: question.domainDisplayName,
    viewerIsAuthor: true,
  };

  return (
    <FeedCard
      item={item}
      className={`transition duration-200 ${deleting ? 'scale-[0.98] opacity-0' : 'opacity-100'}`}
      overflow={
        <CardOverflowMenu
          inUse={inUse}
          onEdit={onEdit}
          onDelete={onDeleteRequest}
        />
      }
      headerContent={
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {visibleCategory ? (
            <span
              className="truncate text-[12px] italic leading-tight"
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
            className="rounded-full bg-[rgba(0,0,0,0.06)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
            style={{ color: 'var(--ink)', opacity: 0.7 }}
            aria-label={`LLM-rated difficulty: ${difficultyLabel}`}
          >
            {difficultyLabel}
          </span>
        </div>
      }
      footer={
        <>
          <p
            className="text-[13px] leading-snug"
            style={{ color: 'var(--ink)', opacity: 0.65 }}
          >
            {question.timesAnswered} answers · {question.correctRate}% correct · {question.usedInGamesCount} games
          </p>
          {answerersLine ? (
            <p
              className="mt-1 text-[13px] leading-snug"
              style={{ color: 'var(--ink)', opacity: 0.65 }}
            >
              {answerersLine}
            </p>
          ) : null}
          {cardError ? (
            <p className="mt-2 text-[13px] text-destructive">{cardError}</p>
          ) : null}
          <div className="mt-3 flex items-center gap-2">
            {confirming ? (
              <>
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
              </>
            ) : (
              <div className="ml-auto">
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
        </>
      }
    />
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
        className="-mr-1 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
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
              onEdit();
            }}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
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

function formatAnswerersLine(answerers: { names: string[]; total: number }): string | null {
  const { names, total } = answerers;
  if (total <= 0 || names.length === 0) return null;
  const [first, second] = names;
  if (total === 1) return `${first} answered your question`;
  if (total === 2 && second) return `${first} and ${second} answered your question`;
  const others = total - 1;
  return `${first} and ${others} ${others === 1 ? 'other' : 'others'} answered your question`;
}
