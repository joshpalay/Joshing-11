'use client';

import { MoreHorizontal, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { ReportReasonSheet, type ReportReasonTarget } from '@/components/report/ReportReasonSheet';

// B-Report-2: the per-row ⋯ menu on the Answered list. Mirrors the daily-summary
// recap card — open the menu, pick "This is incorrect" / "This is inappropriate",
// then land in the shared ReportReasonSheet. The target is the row's reportTarget;
// rows with no reportable row (synthetic daily slots) don't render this menu at all.
// `surface` defaults to 'answered_list' but is overridable so the same control can
// sit on the round-recap and archive surfaces (round_recap / answered_list).
export function AnsweredRowActions({
  target,
  surface = 'answered_list',
  onReportSubmitted,
}: {
  target: ReportReasonTarget;
  surface?: 'round_recap' | 'lately_result' | 'answered_list' | 'catchup_thread';
  // Optional: fires once on a successful report so a surface can react (e.g. the
  // round-recap hides a card reported as inappropriate, matching daily-summary).
  // The answered-list caller omits it and the menu just closes, as before.
  onReportSubmitted?: (category: 'incorrect' | 'inappropriate') => void;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [reportCategory, setReportCategory] = useState<'incorrect' | 'inappropriate' | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMenuOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setIsMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [isMenuOpen]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        onClick={() => setIsMenuOpen((current) => !current)}
        className="inline-flex size-9 items-center justify-center rounded-md border text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <MoreHorizontal className="size-4" />
      </button>

      {isMenuOpen ? (
        <div className="fixed inset-0 z-[55] flex items-end justify-center bg-[color-mix(in_srgb,var(--brand-ink)_20%,transparent)] px-3 pt-16 pb-3 sm:absolute sm:inset-auto sm:right-0 sm:mt-2 sm:block sm:bg-transparent sm:p-0">
          <button
            type="button"
            className="absolute inset-0 cursor-default sm:hidden"
            aria-label="Close menu"
            onClick={() => setIsMenuOpen(false)}
          />
          <div
            role="menu"
            aria-label="More actions"
            className="bg-background relative w-full max-w-md rounded-3xl border p-2 shadow-2xl sm:w-64 sm:rounded-2xl sm:shadow-xl"
          >
            <div className="flex items-center justify-between px-3 py-2 sm:hidden">
              <p className="text-foreground text-sm font-medium">More actions</p>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setIsMenuOpen(false)}
                className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex size-11 items-center justify-center rounded-full"
              >
                <X className="size-4" />
              </button>
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsMenuOpen(false);
                setReportCategory('incorrect');
              }}
              className="text-muted-foreground hover:bg-muted hover:text-foreground flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm transition"
            >
              This is incorrect
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsMenuOpen(false);
                setReportCategory('inappropriate');
              }}
              className="text-muted-foreground hover:bg-muted hover:text-foreground flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm transition"
            >
              This is inappropriate
            </button>
          </div>
        </div>
      ) : null}

      {reportCategory ? (
        <ReportReasonSheet
          category={reportCategory}
          target={target}
          surface={surface}
          onClose={() => setReportCategory(null)}
          onSubmitted={(category) => {
            setReportCategory(null);
            onReportSubmitted?.(category);
          }}
        />
      ) : null}
    </div>
  );
}
