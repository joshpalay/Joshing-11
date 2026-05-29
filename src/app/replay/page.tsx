'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';

import { GameplayChatThread, newMessageId, type ChatMessage } from '@/components/play/GameplayChat';
import { ReplaySummary, type ReplaySessionResult } from '@/components/replay/ReplaySummary';
import type { ReplayItem } from '@/server/replay/session';

type ReplayResponse = {
  items: ReplayItem[];
  session: ReplayItem[];
  total_wrong: number;
};

type GradeResponse = {
  result: 'correct' | 'wrong';
  isCorrect: boolean;
  correctAnswer: string;
  explanation?: string | null;
  consolation?: string | null;
  breadcrumb?: string | null;
};

function questionMessage(item: ReplayItem): ChatMessage {
  return {
    id: `replay-q-${item.dailyQueueItemId}`,
    kind: 'question',
    assignmentId: item.dailyQueueItemId,
    questionText: item.questionText,
    creatorName: null,
    subhead: `FROM ${item.queueDate}`,
    badges: [{ label: 'practice', tone: 'muted' }],
  };
}

export default function ReplayPage() {
  const [totalRemaining, setTotalRemaining] = useState(0);
  const [sessionItems, setSessionItems] = useState<ReplayItem[]>([]);
  const [practicedIds, setPracticedIds] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sessionResults, setSessionResults] = useState<ReplaySessionResult[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(true);
  const [started, setStarted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadingNext, setLoadingNext] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const currentItem = started ? sessionItems[currentIndex] ?? null : null;
  const sessionDone = started && sessionItems.length > 0 && currentIndex >= sessionItems.length;

  const loadBatch = useCallback(async (excludeIds: string[]) => {
    const url = excludeIds.length > 0
      ? `/api/replay/missed?exclude=${encodeURIComponent(excludeIds.join(','))}`
      : '/api/replay/missed';
    const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
    const body = await response.json().catch(() => null) as ReplayResponse | null;
    if (!response.ok || !body) throw new Error('Could not load replay questions.');
    return body;
  }, []);

  const initialLoad = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const body = await loadBatch([]);
      setSessionItems(body.session ?? []);
      setTotalRemaining(body.total_wrong ?? 0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load replay questions.');
    } finally {
      setLoading(false);
    }
  }, [loadBatch]);

  useEffect(() => {
    void initialLoad();
  }, [initialLoad]);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages]);

  const previewItems = useMemo(() => sessionItems.slice(0, 5), [sessionItems]);

  function startSession() {
    if (sessionItems.length === 0) return;
    setMessages([questionMessage(sessionItems[0])]);
    setSessionResults([]);
    setCurrentIndex(0);
    setStarted(true);
  }

  const untouchedRemaining = Math.max(0, totalRemaining - sessionItems.length);

  async function playNextBatch() {
    setLoadingNext(true);
    setError(null);
    try {
      const nextExcluded = [...practicedIds, ...sessionItems.map((item) => item.dailyQueueItemId)];
      const body = await loadBatch(nextExcluded);
      setPracticedIds(nextExcluded);
      setSessionItems(body.session ?? []);
      setTotalRemaining(body.total_wrong ?? 0);
      setSessionResults([]);
      setMessages((body.session ?? []).length > 0 ? [questionMessage((body.session ?? [])[0])] : []);
      setCurrentIndex(0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load next batch.');
    } finally {
      setLoadingNext(false);
    }
  }

  async function submitAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentItem || submitting || !answer.trim()) return;
    const submittedAnswer = answer.trim();
    setAnswer('');
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/replay/grade', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ dailyQueueItemId: currentItem.dailyQueueItemId, submittedAnswer }),
      });
      const body = await response.json().catch(() => null) as GradeResponse | null;
      if (!response.ok || !body) throw new Error('Could not score replay answer.');

      const nextIndex = currentIndex + 1;
      const resolvedAnswer = body.isCorrect ? currentItem.correctAnswer : body.correctAnswer;
      setSessionResults((existing) => [
        ...existing,
        {
          item: currentItem,
          submitted: submittedAnswer,
          isCorrect: body.isCorrect,
          correctAnswer: resolvedAnswer,
          explanation: body.explanation ?? currentItem.explanation ?? null,
        },
      ]);
      setMessages((existing) => [
        ...existing,
        { id: newMessageId(), kind: 'user', text: submittedAnswer },
        {
          id: newMessageId(),
          kind: 'result',
          assignmentId: currentItem.dailyQueueItemId,
          questionText: currentItem.questionText,
          result: body.isCorrect ? 'correct' : 'wrong',
          submitted: submittedAnswer,
          correctAnswer: body.isCorrect ? null : body.correctAnswer,
          consolation: body.consolation ?? null,
          breadcrumb: body.breadcrumb ?? null,
          copyVariant: currentIndex,
          creatorName: 'Joshing',
          canonicalSubcategory: currentItem.domain,
          pointsAwarded: 0,
          pointsLabel: 'Replay - practice only',
        },
        ...(nextIndex < sessionItems.length ? [questionMessage(sessionItems[nextIndex])] : []),
      ]);
      setCurrentIndex(nextIndex);
    } catch (caught) {
      setAnswer(submittedAnswer);
      setError(caught instanceof Error ? caught.message : 'Could not score replay answer.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col px-4 py-6 pb-24">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">Replay</p>
      <h1 className="mt-2 font-serif text-3xl font-semibold text-[var(--text)]">Contain more multitudes.</h1>
      <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
        Practice questions you previously missed. Nothing here changes your score.
      </p>

      {loading ? <p className="mt-5 text-sm text-[var(--text-muted)]">Loading replay...</p> : null}
      {error ? <p className="mt-5 text-sm text-[var(--danger)]">{error}</p> : null}

      {!loading && !error && totalRemaining === 0 && !started ? (
        <div className="mt-5 rounded-[var(--radius-md)] border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
          <p className="text-[var(--text)]">Nothing left to practice right now.</p>
          <Link href="/" className="btn-primary mt-4 inline-flex">Back home</Link>
        </div>
      ) : null}

      {!loading && !error && !started && previewItems.length > 0 ? (
        <div className="mt-5 rounded-[var(--radius-md)] border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
          <p className="text-sm text-[var(--text-muted)]">
            {totalRemaining} wrong {totalRemaining === 1 ? 'answer' : 'answers'} ready for practice · playing {previewItems.length} this round
          </p>
          <ul className="mt-3 space-y-3">
            {previewItems.map((item) => (
              <li key={item.dailyQueueItemId} className="border-b pb-3 last:border-b-0 last:pb-0" style={{ borderColor: 'var(--border)' }}>
                <p className="text-[0.6rem] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]">{item.domainDisplayName}</p>
                <p className="mt-1 text-sm leading-6 text-[var(--text)]">{item.questionText}</p>
              </li>
            ))}
          </ul>
          <button type="button" className="btn-primary mt-4" onClick={startSession}>Start practice</button>
        </div>
      ) : null}

      {started ? (
        <div ref={threadRef} className="mt-5 flex-1 overflow-y-auto">
          <GameplayChatThread messages={messages} />
          {sessionDone ? (
            <ReplaySummary
              results={sessionResults}
              hasMore={untouchedRemaining > 0}
              onPlayNext={() => void playNextBatch()}
              loadingNext={loadingNext}
            />
          ) : null}
        </div>
      ) : null}

      {currentItem && !sessionDone ? (
        <form className="fixed inset-x-0 bottom-16 z-30 mx-auto max-w-lg border-t px-4 py-3 md:bottom-0" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }} onSubmit={(event) => void submitAnswer(event)}>
          <div className="flex gap-2">
            <input
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              disabled={submitting}
              placeholder="Your answer..."
              className="min-h-11 min-w-0 flex-1 rounded-[var(--radius-md)] border bg-[var(--bg)] px-4 text-base text-[var(--text)] outline-none"
              style={{ borderColor: 'var(--border)' }}
            />
            <button type="submit" className="btn-primary shrink-0" disabled={submitting || !answer.trim()}>
              {submitting ? '...' : 'Answer'}
            </button>
          </div>
        </form>
      ) : null}
    </main>
  );
}
