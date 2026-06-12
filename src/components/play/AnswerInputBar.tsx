'use client';

import { useRef, type FormEvent, type Ref } from 'react';

type AnswerInputBarProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  submitting: boolean;
  disabled?: boolean;
  fixed?: boolean;
  inputRef?: Ref<HTMLInputElement>;
};

const DRAG_CANCEL_THRESHOLD_PX = 8;

export function AnswerInputBar({
  value,
  onChange,
  onSubmit,
  submitting,
  disabled = false,
  fixed = true,
  inputRef,
}: AnswerInputBarProps) {
  const pointerStartRef = useRef<{ x: number; y: number; dragged: boolean } | null>(null);
  const interactionDisabled = disabled || submitting;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (interactionDisabled || !value.trim()) return;
    void onSubmit();
  }

  return (
    <form
      className={
        fixed
          ? 'fixed inset-x-0 bottom-0 z-40 mx-auto max-w-lg border-t px-4 py-3'
          : 'border-t px-4 py-3'
      }
      aria-label="Submit your answer"
      style={{
        borderColor: 'var(--border)',
        background: 'color-mix(in srgb, var(--surface) 94%, transparent)',
        backdropFilter: 'blur(8px)',
        paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))',
      }}
      onSubmit={handleSubmit}
    >
      <div className="flex gap-2">
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={interactionDisabled}
          placeholder="Your answer..."
          aria-label="Your answer"
          enterKeyHint="send"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="min-h-11 min-w-0 flex-1 rounded-[var(--radius-md)] border bg-[var(--bg)] px-4 text-base text-[var(--text)] outline-none disabled:cursor-not-allowed disabled:opacity-60"
          style={{ borderColor: 'var(--border)' }}
        />
        <button
          type="submit"
          className="btn-primary shrink-0 disabled:cursor-not-allowed disabled:opacity-70"
          aria-label="Submit answer"
          disabled={interactionDisabled || !value.trim()}
          onPointerDown={(event) => {
            pointerStartRef.current = { x: event.clientX, y: event.clientY, dragged: false };
          }}
          onPointerMove={(event) => {
            const start = pointerStartRef.current;
            if (!start) return;
            const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
            if (distance > DRAG_CANCEL_THRESHOLD_PX) {
              start.dragged = true;
            }
          }}
          onPointerUp={() => {
            window.setTimeout(() => {
              pointerStartRef.current = null;
            }, 0);
          }}
          onClick={(event) => {
            if (pointerStartRef.current?.dragged) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        >
          {submitting ? 'Grading…' : 'Answer'}
        </button>
      </div>
    </form>
  );
}
