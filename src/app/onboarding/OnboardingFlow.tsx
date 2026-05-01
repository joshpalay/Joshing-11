'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type Interest = {
  label: string;
  description?: string | null;
  broadCategory?: string | null;
};

type OnboardingFlowProps = {
  preSeededInterests: Interest[];
};

const WARMUP_QUESTIONS = [
  "What's a book you've read more than once?",
  'Who is a musician or composer you keep coming back to?',
  'A topic you could talk about for an hour without preparation?',
  'Something you studied formally, even briefly?',
  'A film, TV show, or director that means something to you?',
  "Anything else you'd want us to know?",
];

function normalizeInterest(interest: Interest): Interest | null {
  const label = interest.label.trim().replace(/\s+/g, ' ');
  if (!label) return null;

  return {
    label,
    description: interest.description?.trim() || null,
    broadCategory: interest.broadCategory?.trim() || null,
  };
}

function isSameInterest(a: Interest, b: Interest) {
  return a.label.trim().toLowerCase() === b.label.trim().toLowerCase();
}

export default function OnboardingFlow({ preSeededInterests }: OnboardingFlowProps) {
  const router = useRouter();
  const hasPreSeeded = preSeededInterests.length > 0;
  const [step, setStep] = useState<1 | 2 | 3>(hasPreSeeded ? 1 : 2);
  const [selected, setSelected] = useState<Interest[]>([]);
  const [warmupAnswers, setWarmupAnswers] = useState(() => WARMUP_QUESTIONS.map(() => ''));
  const [proposals, setProposals] = useState<Interest[]>([]);
  const [customLabel, setCustomLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answeredCount = useMemo(
    () => warmupAnswers.filter((answer) => answer.trim().length > 0).length,
    [warmupAnswers],
  );
  const remainingSlots = 5 - selected.length;

  function setSeededInterests(interests: Interest[]) {
    setSelected(interests.flatMap((interest) => {
      const normalized = normalizeInterest(interest);
      return normalized ? [normalized] : [];
    }).slice(0, 5));
    setStep(2);
  }

  function toggleInterest(interest: Interest) {
    const normalized = normalizeInterest(interest);
    if (!normalized) return;

    setSelected((current) => {
      if (current.some((item) => isSameInterest(item, normalized))) {
        return current.filter((item) => !isSameInterest(item, normalized));
      }

      if (current.length >= 5) return current;
      return [...current, normalized];
    });
  }

  function updateSelected(index: number, label: string) {
    setSelected((current) => current.map((interest, itemIndex) => (
      itemIndex === index ? { ...interest, label } : interest
    )));
  }

  function addCustomInterest() {
    const normalized = normalizeInterest({ label: customLabel });
    if (!normalized || selected.length >= 5) return;
    if (selected.some((interest) => isSameInterest(interest, normalized))) return;

    setSelected((current) => [...current, normalized]);
    setCustomLabel('');
  }

  async function generateProposals() {
    setError(null);
    if (answeredCount < 4) {
      setError('Answer at least four warm-up questions.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/onboarding/propose-interests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warmupAnswers }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !Array.isArray(data?.interests)) {
        setError(data?.message ?? 'Unable to propose interests.');
        return;
      }

      setProposals(data.interests);
      setStep(3);
    } finally {
      setLoading(false);
    }
  }

  async function saveInterests() {
    setError(null);
    const cleanSelected = selected.flatMap((interest) => {
      const normalized = normalizeInterest(interest);
      return normalized ? [normalized] : [];
    });

    if (cleanSelected.length === 0 || cleanSelected.length > 5) {
      setError('Lock in 1 to 5 interests.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/onboarding/save-interests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interests: cleanSelected }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data?.message ?? 'Unable to save interests.');
        return;
      }

      router.replace('/');
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Step {step} of 3
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal sm:text-4xl">
            Choose your five
          </h1>
        </div>

        <div className="rounded-lg border bg-card p-5 shadow-sm sm:p-6">
          {step === 1 ? (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold tracking-normal">Your invite came with a few ideas</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Keep any that feel right. They count toward your five.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {preSeededInterests.map((interest) => {
                  const selectedSeed = selected.some((item) => isSameInterest(item, interest));
                  return (
                    <button
                      key={interest.label}
                      type="button"
                      onClick={() => toggleInterest(interest)}
                      className={`min-h-14 rounded-md border px-3 py-2 text-left text-sm transition ${
                        selectedSeed
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background hover:bg-accent'
                      }`}
                    >
                      <span className="block font-medium">{interest.label}</span>
                      {interest.broadCategory ? (
                        <span className="block text-xs opacity-75">{interest.broadCategory}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  className="h-11 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
                  onClick={() => setSeededInterests(preSeededInterests)}
                >
                  Accept all
                </button>
                <button
                  type="button"
                  className="h-11 rounded-md border px-4 text-sm font-medium"
                  onClick={() => setStep(2)}
                >
                  Keep selected
                </button>
                <button
                  type="button"
                  className="h-11 rounded-md px-4 text-sm font-medium text-muted-foreground"
                  onClick={() => setSeededInterests([])}
                >
                  Start fresh
                </button>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold tracking-normal">Warm-up questions</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Short answers are enough. Four or more gives Joshing room to work.
                </p>
              </div>
              <div className="grid gap-4">
                {WARMUP_QUESTIONS.map((question, index) => (
                  <label key={question} className="grid gap-2 text-sm font-medium">
                    {question}
                    <textarea
                      className="min-h-20 resize-y rounded-md border bg-background px-3 py-2 text-base font-normal outline-none ring-offset-background focus:ring-2 focus:ring-ring"
                      value={warmupAnswers[index] ?? ''}
                      onChange={(event) => {
                        const next = [...warmupAnswers];
                        next[index] = event.target.value;
                        setWarmupAnswers(next);
                      }}
                    />
                  </label>
                ))}
              </div>
              <button
                type="button"
                className="h-11 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
                onClick={generateProposals}
                disabled={loading}
              >
                {loading ? 'Finding interests...' : 'Find my interests'}
              </button>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold tracking-normal">Pick up to five</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {remainingSlots > 0 ? `${remainingSlots} slot${remainingSlots === 1 ? '' : 's'} left.` : 'Your five are full.'}
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {proposals.map((interest) => {
                  const active = selected.some((item) => isSameInterest(item, interest));
                  return (
                    <button
                      key={`${interest.label}-${interest.broadCategory ?? ''}`}
                      type="button"
                      onClick={() => toggleInterest(interest)}
                      className={`min-h-24 rounded-md border px-3 py-3 text-left text-sm transition ${
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background hover:bg-accent disabled:opacity-50'
                      }`}
                      disabled={!active && selected.length >= 5}
                      title={interest.description ?? undefined}
                    >
                      <span className="block font-medium">{interest.label}</span>
                      <span className="mt-1 block text-xs leading-5 opacity-75">
                        {interest.description}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="space-y-3 rounded-md border bg-background p-3">
                <p className="text-sm font-medium">Your five</p>
                {selected.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Pick from above or write your own.</p>
                ) : (
                  <div className="grid gap-2">
                    {selected.map((interest, index) => (
                      <div key={`${interest.label}-${index}`} className="flex gap-2">
                        <input
                          className="h-10 min-w-0 flex-1 rounded-md border bg-card px-3 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring"
                          value={interest.label}
                          onChange={(event) => updateSelected(index, event.target.value)}
                        />
                        <button
                          type="button"
                          className="h-10 rounded-md border px-3 text-sm"
                          onClick={() => setSelected((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    className="h-10 min-w-0 flex-1 rounded-md border bg-card px-3 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring"
                    placeholder="Write your own interest"
                    value={customLabel}
                    onChange={(event) => setCustomLabel(event.target.value)}
                    disabled={selected.length >= 5}
                  />
                  <button
                    type="button"
                    className="h-10 rounded-md border px-3 text-sm font-medium disabled:opacity-50"
                    onClick={addCustomInterest}
                    disabled={selected.length >= 5}
                  >
                    Add
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  className="h-11 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
                  onClick={saveInterests}
                  disabled={loading || selected.length === 0}
                >
                  {loading ? 'Locking...' : 'Lock my five'}
                </button>
                <button
                  type="button"
                  className="h-11 rounded-md border px-4 text-sm font-medium"
                  onClick={() => setStep(2)}
                  disabled={loading}
                >
                  Revisit answers
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
