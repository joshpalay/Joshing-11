'use client';

import { GripVertical, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { QuestionBankPicker } from '@/components/QuestionBankPicker';
import { QuestionForm, type QuestionFormValues } from '@/components/QuestionForm';
import type { QuestionRecord } from '@/lib/questions-types';

type Step = 1 | 2 | 3;
type UserOption = { id: string; displayName: string };
type EntryPoint = 'bank' | 'new';

const MAX_QUESTIONS = 5;

function truncate(value: string, max = 60) {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

export default function NewGamePage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [showConfirm, setShowConfirm] = useState(false);
  const [title, setTitle] = useState('');
  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [questionsById, setQuestionsById] = useState<Record<string, QuestionRecord>>({});
  const [selectedQuestions, setSelectedQuestions] = useState<QuestionRecord[]>([]);
  const [entryPoint, setEntryPoint] = useState<EntryPoint>('bank');
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitNotice, setLimitNotice] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  useEffect(() => {
    if (currentStep !== 2 || users.length > 0 || loadingUsers) return;
    setLoadingUsers(true);
    fetch('/api/users', { cache: 'no-store', credentials: 'include' })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(body)) throw new Error(body?.message ?? 'Could not load people.');
        setUsers(body);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Could not load people.'))
      .finally(() => setLoadingUsers(false));
  }, [currentStep, loadingUsers, users.length]);

  useEffect(() => {
    fetch('/api/questions', { cache: 'no-store', credentials: 'include' })
      .then((response) => response.json())
      .then((body) => {
        const rows = Array.isArray(body?.questions) ? body.questions as QuestionRecord[] : [];
        setQuestionsById(Object.fromEntries(rows.map((question) => [question.id, question])));
      })
      .catch(() => undefined);
  }, []);

  const selectedRecipientNames = useMemo(
    () => new Set(selectedRecipients),
    [selectedRecipients],
  );

  const syncBankSelection = useCallback((ids: string[]) => {
    setLimitNotice(ids.length >= MAX_QUESTIONS);
    setSelectedQuestions((current) => {
      const currentById = new Map(current.map((question) => [question.id, question]));
      const next = ids.slice(0, MAX_QUESTIONS).flatMap((id) => {
        const question = currentById.get(id) ?? questionsById[id];
        return question ? [question] : [];
      });
      return next;
    });
  }, [questionsById]);

  const removeQuestion = useCallback((id: string) => {
    setSelectedQuestions((current) => current.filter((question) => question.id !== id));
    setLimitNotice(false);
  }, []);

  const moveDragged = useCallback((targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    setSelectedQuestions((current) => {
      const from = current.findIndex((question) => question.id === draggedId);
      const to = current.findIndex((question) => question.id === targetId);
      if (from < 0 || to < 0) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, [draggedId]);

  const saveQuestion = useCallback(async (values: QuestionFormValues) => {
    if (selectedQuestions.length >= MAX_QUESTIONS) {
      setLimitNotice(true);
      return;
    }
    const response = await fetch('/api/questions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(values),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.id) {
      throw new Error(body?.message ?? 'Could not save that question.');
    }
    const created = body as QuestionRecord;
    setQuestionsById((current) => ({ ...current, [created.id]: created }));
    setSelectedQuestions((current) => [...current, created].slice(0, MAX_QUESTIONS));
    setEntryPoint('bank');
  }, [selectedQuestions.length]);

  const sendGame = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/joshing-games', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title: title.trim(),
          recipientIds: selectedRecipients,
          questionIds: selectedQuestions.map((question) => question.id),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.id) throw new Error(body?.message ?? 'Could not send this game.');
      router.push(`/games/${body.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not send this game.');
    } finally {
      setSubmitting(false);
    }
  }, [router, selectedQuestions, selectedRecipients, title]);

  if (showConfirm) {
    const friendWord = selectedRecipients.length === 1 ? 'friend' : 'friends';
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 py-6">
        <section className="card p-5">
          <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">Ready</p>
          <h1 className="mt-2 font-serif text-3xl font-semibold">{title}</h1>
          <div className="mt-5 grid gap-3 text-sm">
            <p>{selectedRecipients.length} recipients</p>
            <p>{selectedQuestions.length} questions</p>
          </div>
          <p className="mt-6 text-lg">
            Send {title} to {selectedRecipients.length} {friendWord}.
          </p>
          {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
          <div className="mt-6 flex gap-3">
            <button className="btn-ghost" type="button" onClick={() => setShowConfirm(false)} disabled={submitting}>
              Back
            </button>
            <button className="btn-primary" type="button" onClick={() => void sendGame()} disabled={submitting}>
              {submitting ? 'Sending...' : 'Send'}
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-5">
      <header className="mb-5">
        <div className="mb-4 flex justify-center gap-2" aria-label={`Step ${currentStep} of 3`}>
          {[1, 2, 3].map((step) => (
            <span
              key={step}
              className={`size-2.5 rounded-full border ${currentStep === step ? 'bg-primary' : 'bg-transparent'}`}
            />
          ))}
        </div>
        <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">New Game</p>
        <h1 className="font-serif text-2xl font-semibold">Build a Joshing Game</h1>
      </header>

      {error ? <p className="mb-4 rounded-md border border-destructive p-3 text-sm text-destructive">{error}</p> : null}

      {currentStep === 1 ? (
        <section className="card p-5">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value.slice(0, 60))}
            placeholder="What's this one called?"
            maxLength={60}
            className="w-full rounded-md border bg-background px-4 py-3 text-lg outline-none"
          />
          <p className="mt-2 text-right text-xs text-muted-foreground">{title.length}/60</p>
          <button className="btn-primary mt-5 w-full" type="button" disabled={!title.trim()} onClick={() => setCurrentStep(2)}>
            Continue
          </button>
        </section>
      ) : null}

      {currentStep === 2 ? (
        <section className="card p-5">
          <div className="mb-4 flex items-end justify-between">
            <h2 className="font-serif text-2xl font-semibold">Who&apos;s this for?</h2>
            <span className="text-sm text-muted-foreground">{selectedRecipients.length} selected</span>
          </div>
          <div className="max-h-80 overflow-y-auto pr-1">
            {loadingUsers ? <p className="text-sm text-muted-foreground">Loading people...</p> : null}
            {users.map((user) => {
              const selected = selectedRecipientNames.has(user.id);
              return (
                <button
                  key={user.id}
                  type="button"
                  className={`mb-2 flex w-full items-center justify-between rounded-md border px-3 py-3 text-left ${selected ? 'border-primary bg-muted' : 'bg-background'}`}
                  onClick={() => setSelectedRecipients((current) => selected ? current.filter((id) => id !== user.id) : [...current, user.id])}
                >
                  <span>{user.displayName}</span>
                  <span className="text-sm text-muted-foreground">{selected ? 'Selected' : 'Select'}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-5 flex gap-3">
            <button className="btn-ghost" type="button" onClick={() => setCurrentStep(1)}>Back</button>
            <button className="btn-primary flex-1" type="button" disabled={selectedRecipients.length === 0} onClick={() => setCurrentStep(3)}>
              Continue
            </button>
          </div>
        </section>
      ) : null}

      {currentStep === 3 ? (
        <section className="space-y-4">
          <div className="card p-5">
            <div className="mb-4 flex items-end justify-between gap-3">
              <h2 className="font-serif text-2xl font-semibold">Pick your questions</h2>
              <span className="text-sm text-muted-foreground">{selectedQuestions.length} of 5</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(['bank', 'new'] as EntryPoint[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setEntryPoint(tab)}
                  className={`rounded-md border px-3 py-2 text-sm ${entryPoint === tab ? 'bg-primary text-primary-foreground' : 'bg-background'}`}
                >
                  {tab === 'bank' ? 'From my bank' : 'Write new'}
                </button>
              ))}
            </div>
            {limitNotice || selectedQuestions.length >= MAX_QUESTIONS ? (
              <p className="mt-3 text-sm text-muted-foreground">5 question limit reached</p>
            ) : null}
            <div className="mt-5">
              {entryPoint === 'bank' ? (
                <QuestionBankPicker
                  key={selectedQuestions.map((question) => question.id).join(':')}
                  onSelect={syncBankSelection}
                  onQuestionsLoaded={(rows) => {
                    setQuestionsById((current) => ({
                      ...current,
                      ...Object.fromEntries(rows.map((question) => [question.id, question])),
                    }));
                  }}
                  maxSelect={MAX_QUESTIONS}
                  preselectedIds={selectedQuestions.map((question) => question.id)}
                />
              ) : (
                <QuestionForm onSubmit={saveQuestion} submitLabel="Save question" loadingLabel="Saving..." />
              )}
            </div>
          </div>

          <div className="card p-5">
            <h3 className="mb-3 text-sm font-medium text-muted-foreground">Selected questions</h3>
            {selectedQuestions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Pick at least one question.</p>
            ) : (
              <ul className="space-y-2">
                {selectedQuestions.map((question) => (
                  <li
                    key={question.id}
                    draggable
                    onDragStart={() => setDraggedId(question.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => moveDragged(question.id)}
                    className="flex items-center gap-2 rounded-md border bg-background p-3"
                  >
                    <GripVertical className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 text-sm">{truncate(question.question_text)}</span>
                    <button type="button" onClick={() => removeQuestion(question.id)} title="Remove" className="rounded p-1 hover:bg-muted">
                      <X className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-5 flex gap-3">
              <button className="btn-ghost" type="button" onClick={() => setCurrentStep(2)}>Back</button>
              <button className="btn-primary flex-1" type="button" disabled={selectedQuestions.length === 0} onClick={() => setShowConfirm(true)}>
                Send
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
