'use client';

import Link from 'next/link';
import { CheckCircle2, Clock, MessageCircleQuestion } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type DailyStatus = {
  questionsRemaining: number;
  questionsAnswered: number;
  isComplete: boolean;
  nextRoundAt: string;
};

const FALLBACK_STATUS: DailyStatus = {
  questionsRemaining: 5,
  questionsAnswered: 0,
  isComplete: false,
  nextRoundAt: new Date().toISOString(),
};

function formatCountdown(targetIso: string, nowMs: number): string {
  const targetMs = Date.parse(targetIso);
  if (!Number.isFinite(targetMs)) return 'any second now';

  const remainingMs = targetMs - nowMs;
  if (remainingMs < 60_000) return 'any second now';

  const totalMinutes = Math.ceil(remainingMs / 60_000);
  if (totalMinutes > 60) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes}m`;
  }

  return `${totalMinutes}m`;
}

export default function TodaysFiveCard() {
  const [status, setStatus] = useState<DailyStatus | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      try {
        const response = await fetch('/api/daily/status', {
          cache: 'no-store',
          credentials: 'include',
        });
        if (!response.ok) throw new Error('daily status unavailable');
        const body = await response.json();
        if (cancelled) return;
        setStatus({
          questionsRemaining:
            typeof body.questionsRemaining === 'number' ? body.questionsRemaining : FALLBACK_STATUS.questionsRemaining,
          questionsAnswered:
            typeof body.questionsAnswered === 'number'
              ? body.questionsAnswered
              : typeof body.answered === 'number'
                ? body.answered
                : FALLBACK_STATUS.questionsAnswered,
          isComplete:
            typeof body.isComplete === 'boolean'
              ? body.isComplete
              : typeof body.complete === 'boolean'
                ? body.complete
                : FALLBACK_STATUS.isComplete,
          nextRoundAt: typeof body.nextRoundAt === 'string' ? body.nextRoundAt : FALLBACK_STATUS.nextRoundAt,
        });
      } catch {
        if (!cancelled) setStatus(FALLBACK_STATUS);
      }
    }

    void loadStatus();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const effectiveStatus = status ?? FALLBACK_STATUS;
  const answered = Math.max(0, Math.min(effectiveStatus.questionsAnswered, 5));
  const isComplete = effectiveStatus.isComplete || effectiveStatus.questionsRemaining <= 0;
  const subtext = useMemo(() => {
    if (isComplete) {
      return `Done for today. Next round in ${formatCountdown(effectiveStatus.nextRoundAt, nowMs)}.`;
    }
    return answered > 0 ? `${answered} of 5 answered` : 'Ready when you are';
  }, [answered, effectiveStatus.nextRoundAt, isComplete, nowMs]);

  return (
    <div className="mt-6 w-full rounded-lg border bg-card p-4 text-card-foreground md:mt-0 md:max-w-xs">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-foreground">
          {isComplete ? (
            <CheckCircle2 className="size-5" aria-hidden="true" />
          ) : (
            <MessageCircleQuestion className="size-5" aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Today&apos;s Five
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{subtext}</p>
        </div>
      </div>

      {isComplete ? (
        <Link href="/daily" className="btn-ghost mt-4 min-h-11 w-full justify-center gap-2">
          <Clock className="size-4" aria-hidden="true" />
          See your recap
        </Link>
      ) : (
        <Link href="/daily" className="btn-primary mt-4 min-h-11 w-full justify-center gap-2">
          <MessageCircleQuestion className="size-4" aria-hidden="true" />
          Play now
        </Link>
      )}
    </div>
  );
}
