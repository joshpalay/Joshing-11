'use client';

import { useEffect, useRef } from 'react';

/**
 * A textarea that grows to fit its content (and keeps growing as you type),
 * so a long question or explanation is never trapped behind a 2-row scroll —
 * "I can't see the full answer" (2026-07-03). DOM-measured because iOS Safari
 * doesn't support CSS field-sizing yet; direct style mutation, no state.
 */
export function AutoGrowTextarea({
  value,
  minRows = 2,
  className,
  ...props
}: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows'> & {
  value: string;
  minRows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    // +2 covers the border so the last line never clips into a scrollbar.
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      rows={minRows}
      className={`${className ?? ''} resize-none overflow-hidden`}
      {...props}
    />
  );
}
