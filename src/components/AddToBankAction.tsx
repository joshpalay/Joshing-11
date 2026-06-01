'use client';

import { Bookmark } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';

import { cn } from '@/lib/utils';

type AddToBankActionProps = {
  questionId: string;
  initialInBank?: boolean;
  contextType?: 'feed' | 'joshing_game' | 'manual';
  contextId?: string;
  label?: string;
  className?: string;
  onChange?: (inBank: boolean) => void;
};

export function AddToBankAction({
  questionId,
  initialInBank = false,
  contextType,
  contextId,
  label = 'Add to bank',
  className,
  onChange,
}: AddToBankActionProps) {
  const [inBank, setInBank] = useState(initialInBank);
  const [toast, setToast] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Re-sync local state when the prop changes, without an effect (react-hooks's
  // set-state-in-effect flags synchronous setState in effects). Adjusting during
  // render via a stored previous value is the React-docs pattern for this.
  const [prevInitialInBank, setPrevInitialInBank] = useState(initialInBank);
  if (initialInBank !== prevInitialInBank) {
    setPrevInitialInBank(initialInBank);
    setInBank(initialInBank);
  }

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const toggle = () => {
    const next = !inBank;
    setInBank(next);
    onChange?.(next);
    setToast(next ? 'Saved to your bank' : 'Removed from bank');

    startTransition(async () => {
      const response = await fetch('/api/bank', {
        method: next ? 'POST' : 'DELETE',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(next ? { questionId, contextType, contextId } : { questionId }),
      });
      if (!response.ok) {
        setInBank(!next);
        onChange?.(!next);
        setToast('Could not update your bank');
      }
    });
  };

  return (
    <>
      <button
        type="button"
        aria-pressed={inBank}
        aria-label={inBank ? 'Remove from bank' : 'Add to bank'}
        title={inBank ? 'Remove from bank' : 'Add to bank'}
        disabled={isPending}
        onClick={toggle}
        className={cn(
          'text-muted-foreground hover:bg-muted hover:text-foreground inline-flex min-h-9 items-center justify-center gap-2 rounded-md border px-3 text-sm transition disabled:opacity-60',
          inBank ? 'border-amber-300 bg-amber-50 text-amber-700' : '',
          className,
        )}
      >
        <Bookmark
          className={cn('size-4 transition-transform', inBank ? 'scale-110 fill-current' : '')}
        />
        {label ? <span>{label}</span> : null}
      </button>
      {toast ? (
        <div className="bg-foreground text-background fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-sm shadow-lg md:bottom-8">
          {toast}
        </div>
      ) : null}
    </>
  );
}
