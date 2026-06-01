'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type SessionCloseMessageProps = {
  /** PRD §8.1.13 Layer 1 — score-based line, always present. */
  scoreLine: string;
  /** PRD §8.1.13 Layer 2 — interpretive line, appears ~300ms after Layer 1. */
  interpretiveLine?: string | null;
  reviewLink?: string;
  knowledgeLink?: string;
};

export function SessionCloseMessage({
  scoreLine,
  interpretiveLine,
  reviewLink,
  knowledgeLink,
}: SessionCloseMessageProps) {
  const [showInterpretive, setShowInterpretive] = useState(false);

  useEffect(() => {
    if (!interpretiveLine) return;
    const timer = window.setTimeout(() => setShowInterpretive(true), 300);
    return () => window.clearTimeout(timer);
  }, [interpretiveLine]);

  return (
    <>
      <p className="text-[1.22rem] leading-relaxed text-[var(--text)]">{scoreLine}</p>
      {interpretiveLine ? (
        <p
          className="mt-1 text-[1.05rem] leading-relaxed text-[var(--text-muted)]"
          style={{ opacity: showInterpretive ? 1 : 0, transition: 'opacity 0.25s ease' }}
        >
          {interpretiveLine}
        </p>
      ) : null}
      {reviewLink ? (
        <div className="pt-2">
          <Link href={reviewLink} className="btn-primary inline-flex">
            Review today&apos;s answers
          </Link>
        </div>
      ) : null}
      {knowledgeLink ? (
        <p className="text-sm text-[var(--text-muted)]">
          <Link href={knowledgeLink} className="underline underline-offset-4">
            See your Knowledge page -&gt;
          </Link>
        </p>
      ) : null}
    </>
  );
}
