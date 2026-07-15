'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { GLOSSARY, type GlossaryKey } from './glossary';

// A term of art with its definition one TAP away — the admin pages are used on
// phones, so meaning must never live only in a hover tooltip. Renders its
// children with a dotted underline; tapping toggles a small popover with the
// glossary definition (or an inline `def`). Closes on outside tap or Escape.
export function InfoTerm({
  term,
  def,
  children,
  style,
  className,
}: {
  /** Glossary key — the shared definition set in glossary.ts. */
  term?: GlossaryKey;
  /** Inline definition for one-off terms not worth a glossary entry. */
  def?: string;
  children: ReactNode;
  /** Passed to the trigger so tone (color) matches the surrounding label. */
  style?: CSSProperties;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const definition = term ? GLOSSARY[term] : def;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!definition) return <span style={style}>{children}</span>;

  return (
    <span ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={
          'cursor-help underline decoration-dotted underline-offset-2 ' + (className ?? '')
        }
        style={style}
        title={definition}
      >
        {children}
      </button>
      {open ? (
        <span
          role="note"
          className="absolute left-0 top-full z-[var(--z-modal)] mt-1 block w-max max-w-[min(18rem,80vw)] rounded-md border px-3 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal shadow-[var(--shadow-overlay)]"
          style={{
            background: 'var(--brand-card)',
            borderColor: 'var(--border)',
            color: 'var(--brand-ink-700)',
            whiteSpace: 'normal',
          }}
        >
          {definition}
        </span>
      ) : null}
    </span>
  );
}
