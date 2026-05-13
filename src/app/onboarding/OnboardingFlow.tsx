'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Edit3, Loader2, Plus, X } from 'lucide-react';
import { COUNTRIES } from '@/lib/onboarding/countries';
import { US_STATES } from '@/lib/onboarding/us-regions';

type CurrentStep = 'welcome' | 'background' | 'warmup' | 'review' | 'pick' | 'complete';

export type WarmupAnswers = {
  deepDive?: string;
  hourLongTopic?: string;
  anythingElse?: string;
};

export type ProposedInterest = {
  domain: string;
  broadCategory: string;
  rationale?: string | null;
};

type SelectedInterest = {
  domain: string;
  broadCategory: string;
};

export type PreSeededInterest = ProposedInterest;

type OnboardingFlowProps = {
  preSeededInterests: PreSeededInterest[];
  inviterName?: string | null;
};

type CanonicalSuggestion = {
  original: string;
  suggested: string;
  broadCategory: string;
  explanation: string | null;
};

const WARMUP_FIELDS: Array<{
  field: keyof WarmupAnswers;
  label: string;
  placeholder: string;
  optional?: boolean;
}> = [
  {
    field: 'deepDive',
    label: 'A book, composer, or filmmaker you\'ve gone deep on?',
    placeholder: 'e.g. Middlemarch, or Tchaikovsky\'s symphonies, or Werner Herzog',
  },
  {
    field: 'hourLongTopic',
    label: 'A topic you could talk about for an hour without preparation?',
    placeholder: 'e.g. the French Revolution, or Italian Renaissance painting',
  },
  {
    field: 'anythingElse',
    label: 'Anything else — a period of history, a sport, a field you studied?',
    placeholder: 'Anything',
    optional: true,
  },
];


const LOADING_COPY = [
  'Reading your answers...',
  'Looking for connections...',
  'Building your map...',
];

const STEP_DOTS: Array<{ step: CurrentStep; label: string }> = [
  { step: 'background', label: 'About You' },
  { step: 'warmup', label: 'Warmup' },
  { step: 'review', label: 'Review' },
  { step: 'pick', label: 'Confirm' },
];

function normalizeDomain(domain: string) {
  return domain.trim().replace(/\s+/g, ' ');
}

function selectedKey(interest: SelectedInterest) {
  return interest.domain.trim().toLowerCase();
}

function toSelected(interest: ProposedInterest): SelectedInterest | null {
  const domain = normalizeDomain(interest.domain);
  if (domain.length < 2) return null;

  return {
    domain,
    broadCategory: normalizeDomain(interest.broadCategory || 'Other') || 'Other',
  };
}

function isSelected(selectedInterests: SelectedInterest[], interest: ProposedInterest) {
  const selected = toSelected(interest);
  return selected ? selectedInterests.some((item) => selectedKey(item) === selectedKey(selected)) : false;
}

function isBeforeNoonEastern() {
  const easternParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const hour = Number(easternParts.find((part) => part.type === 'hour')?.value ?? '12');
  return hour < 12;
}

function Spinner({ small = false }: { small?: boolean }) {
  return (
    <Loader2
      className={`${small ? 'size-4' : 'size-7'} animate-spin`}
      aria-hidden="true"
    />
  );
}

function ProgressDots({ currentStep }: { currentStep: CurrentStep }) {
  const activeIndex = currentStep === 'welcome'
    ? -1
    : currentStep === 'complete'
      ? STEP_DOTS.length
      : Math.max(0, STEP_DOTS.findIndex((item) => item.step === currentStep));

  return (
    <div className="flex items-center justify-center gap-3" aria-label="Onboarding progress">
      {STEP_DOTS.map((item, index) => {
        const active = index <= activeIndex;
        const current = item.step === currentStep;

        return (
          <div key={item.step} className="flex items-center gap-2">
            <span
              className={[
                'block size-2.5 rounded-full transition',
                active ? 'bg-foreground' : 'bg-border',
                current ? 'ring-4 ring-foreground/10' : '',
              ].join(' ')}
            />
            <span className="sr-only">{item.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function StepHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="space-y-2">
      <h1 className="text-3xl font-semibold tracking-normal text-balance sm:text-4xl">{title}</h1>
      <p className="text-base leading-7 text-muted-foreground">{subtitle}</p>
    </div>
  );
}

export default function OnboardingFlow({ preSeededInterests, inviterName }: OnboardingFlowProps) {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<CurrentStep>('welcome');
  const [birthYear, setBirthYear] = useState('');
  const [grewUpCountry, setGrewUpCountry] = useState('');
  const [grewUpRegion, setGrewUpRegion] = useState('');
  const [warmupAnswers, setWarmupAnswers] = useState<WarmupAnswers>({});
  const [proposedInterests, setProposedInterests] = useState<ProposedInterest[] | null>(null);
  const [inviteInterests, setInviteInterests] = useState<PreSeededInterest[]>(() => preSeededInterests);
  const [selectedInterests, setSelectedInterests] = useState<SelectedInterest[]>(
    () => preSeededInterests.flatMap((interest) => {
      const selected = toSelected(interest);
      return selected ? [selected] : [];
    }).slice(0, 5),
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isCanonicalizing, setIsCanonicalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingCopyIndex, setLoadingCopyIndex] = useState(0);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingDomain, setEditingDomain] = useState('');
  const [showComposer, setShowComposer] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [canonicalSuggestion, setCanonicalSuggestion] = useState<CanonicalSuggestion | null>(null);
  const [customChoice, setCustomChoice] = useState<'suggested' | 'mine' | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showDailySetup = useMemo(() => isBeforeNoonEastern(), []);

  const displayInviterName = inviterName?.trim() ? inviterName.trim() : 'A friend';

  const parsedBirthYear = parseInt(birthYear, 10);
  const maxBirthYear = new Date().getFullYear() - 13;
  const birthYearValid = birthYear.length === 4 && parsedBirthYear >= 1920 && parsedBirthYear <= maxBirthYear;
  const canAdvanceBackground =
    birthYearValid &&
    grewUpCountry !== '' &&
    (grewUpCountry !== 'US' || grewUpRegion !== '');

  const canGenerate =
    normalizeDomain(warmupAnswers.deepDive ?? '').length > 0 &&
    normalizeDomain(warmupAnswers.hourLongTopic ?? '').length > 0;

  const reviewInterests = useMemo(
    () => [
      ...inviteInterests,
      ...(proposedInterests ?? []).filter(
        (interest) => !inviteInterests.some(
          (seeded) => selectedKey(toSelected(seeded) ?? { domain: '', broadCategory: '' }) === selectedKey(toSelected(interest) ?? { domain: '', broadCategory: '' }),
        ),
      ),
    ],
    [inviteInterests, proposedInterests],
  );

  useEffect(() => {
    if (!isLoading || currentStep !== 'warmup') return;

    const interval = window.setInterval(() => {
      setLoadingCopyIndex((current) => (current + 1) % LOADING_COPY.length);
    }, 3000);

    return () => window.clearInterval(interval);
  }, [currentStep, isLoading]);

  useEffect(() => {
    const rawInput = normalizeDomain(customInput);
    const resetTimer = window.setTimeout(() => {
      setCanonicalSuggestion(null);
      setCustomChoice(null);
      if (!showComposer || rawInput.length <= 3) setIsCanonicalizing(false);
    }, 0);

    if (!showComposer || rawInput.length <= 3) {
      return () => window.clearTimeout(resetTimer);
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsCanonicalizing(true);
      try {
        const response = await fetch('/api/onboarding/canonicalize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rawInput }),
          signal: controller.signal,
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok || typeof data?.suggested !== 'string') return;

        setCanonicalSuggestion({
          original: data.original ?? rawInput,
          suggested: data.suggested,
          broadCategory: data.broadCategory ?? 'Other',
          explanation: data.explanation ?? null,
        });
      } catch (fetchError) {
        if (!(fetchError instanceof DOMException && fetchError.name === 'AbortError')) {
          setCanonicalSuggestion(null);
        }
      } finally {
        if (!controller.signal.aborted) setIsCanonicalizing(false);
      }
    }, 800);

    return () => {
      controller.abort();
      window.clearTimeout(resetTimer);
      window.clearTimeout(timer);
    };
  }, [customInput, showComposer]);

  function updateWarmupAnswer(field: keyof WarmupAnswers, value: string) {
    setWarmupAnswers((current) => ({ ...current, [field]: value.slice(0, 200) }));
  }

  function toggleInterest(interest: ProposedInterest) {
    const selected = toSelected(interest);
    if (!selected) return;

    setSelectedInterests((current) => {
      const exists = current.some((item) => selectedKey(item) === selectedKey(selected));
      if (exists) return current.filter((item) => selectedKey(item) !== selectedKey(selected));
      if (current.length >= 5) return current;
      return [...current, selected];
    });
  }

  function beginEdit(interest: ProposedInterest) {
    const selected = toSelected(interest);
    if (!selected) return;

    setEditingKey(selectedKey(selected));
    setEditingDomain(selected.domain);
  }

  function saveEdit(interest: ProposedInterest) {
    const selected = toSelected(interest);
    const nextDomain = normalizeDomain(editingDomain);
    if (!selected || nextDomain.length < 2) return;

    const edited = { ...interest, domain: nextDomain };
    setInviteInterests((current) => current.map((item) => (
      selectedKey(toSelected(item) ?? { domain: '', broadCategory: '' }) === selectedKey(selected)
        ? edited
        : item
    )));
    setProposedInterests((current) => current?.map((item) => (
      selectedKey(toSelected(item) ?? { domain: '', broadCategory: '' }) === selectedKey(selected)
        ? edited
        : item
    )) ?? current);
    setSelectedInterests((current) => current.map((item) => (
      selectedKey(item) === selectedKey(selected)
        ? { ...item, domain: nextDomain }
        : item
    )));
    setEditingKey(null);
    setEditingDomain('');
  }

  function startLongPress(interest: ProposedInterest) {
    clearLongPress();
    longPressTimer.current = setTimeout(() => beginEdit(interest), 500);
  }

  function clearLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  async function generateProposals() {
    if (!canGenerate) return;

    setError(null);
    setIsLoading(true);
    setLoadingCopyIndex(0);

    try {
      const response = await fetch('/api/onboarding/propose-interests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warmupAnswers,
          culturalAnchor: birthYearValid && grewUpCountry ? {
            birthYear: parsedBirthYear,
            grewUpCountry,
            grewUpRegion: grewUpRegion || undefined,
          } : undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !Array.isArray(data?.proposedInterests)) {
        setError("We couldn't generate suggestions. You can try again or write your own.");
        return;
      }

      setProposedInterests(data.proposedInterests);
      setCurrentStep('review');
    } catch {
      setError("We couldn't generate suggestions. You can try again or write your own.");
    } finally {
      setIsLoading(false);
    }
  }

  async function saveInterests() {
    const cleanSelected = selectedInterests
      .flatMap((interest) => {
        const selected = toSelected(interest);
        return selected ? [selected] : [];
      })
      .slice(0, 5);

    if (cleanSelected.length === 0) {
      setError('Pick at least 1 to continue.');
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch('/api/onboarding/save-interests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interests: cleanSelected }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || data?.ok !== true) {
        setError(data?.message ?? data?.error ?? 'Unable to save interests.');
        return;
      }

      setCurrentStep('complete');
      router.refresh();
    } catch {
      setError('Unable to save interests.');
    } finally {
      setIsLoading(false);
    }
  }

  function skipSuggestions() {
    setError(null);
    setProposedInterests([]);
    setShowComposer(true);
    setCurrentStep('review');
  }

  function addCustomInterest() {
    const rawInput = normalizeDomain(customInput);
    const chosenDomain = customChoice === 'suggested' && canonicalSuggestion
      ? canonicalSuggestion.suggested
      : rawInput;
    const broadCategory = canonicalSuggestion?.broadCategory ?? 'Other';
    const selected = toSelected({ domain: chosenDomain, broadCategory });

    if (!selected || selectedInterests.length >= 5) return;

    setSelectedInterests((current) => {
      if (current.some((item) => selectedKey(item) === selectedKey(selected))) return current;
      return [...current, selected].slice(0, 5);
    });
    setCustomInput('');
    setCanonicalSuggestion(null);
    setCustomChoice(null);
  }

  if (isLoading && currentStep === 'warmup') {
    return (
      <main className="grid min-h-screen place-items-center bg-background px-5 py-12 text-foreground">
        <div className="flex max-w-sm flex-col items-center gap-5 text-center">
          <div className="grid size-16 place-items-center rounded-full border bg-card shadow-sm">
            <Spinner />
          </div>
          <p className="text-xl font-semibold">{LOADING_COPY[loadingCopyIndex]}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background px-4 pb-10 pt-8 text-foreground sm:px-6 sm:pt-12">
      <section className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-2xl flex-col">
        <ProgressDots currentStep={currentStep} />

        <div className="mt-9 flex flex-1 flex-col">
          {currentStep === 'welcome' ? (
            <div className="flex flex-1 flex-col justify-center gap-8">
              <StepHeader
                title="Welcome to Joshing"
                subtitle="The trivia you wish you were asked."
              />
              <div className="space-y-4 text-base leading-7 text-muted-foreground">
                <p>Every day, you&apos;ll get five questions calibrated to your intellectual world.</p>
                <p>First, let&apos;s figure out what that world looks like.</p>
                <p>It takes about two minutes.</p>
              </div>

              {inviteInterests.length > 0 ? (
                <div className="rounded-lg border bg-card p-4 text-sm leading-6 shadow-sm">
                  <p className="font-medium">
                    {displayInviterName} thought you might like:
                  </p>
                  <ul className="mt-2 space-y-1 text-muted-foreground">
                    {inviteInterests.slice(0, 3).map((interest) => (
                      <li key={interest.domain}>- {interest.domain}</li>
                    ))}
                  </ul>
                  <p className="mt-3 text-muted-foreground">
                    They&apos;re preselected, but you can edit, remove, or skip them before anything is saved.
                  </p>
                </div>
              ) : null}

              <button type="button" className="btn-primary h-12 w-full" onClick={() => setCurrentStep('background')}>
                Let&apos;s go
              </button>
            </div>
          ) : null}

          {currentStep === 'background' ? (
            <div className="flex flex-1 flex-col gap-7">
              <StepHeader
                title="Tell us where you're coming from"
                subtitle="Two quick facts that help us calibrate. We won't share these."
              />

              <div className="space-y-5">
                <label className="block">
                  <span className="text-sm font-medium">What year were you born?</span>
                  <input
                    type="number"
                    className="mt-2 h-12 w-full rounded-md border bg-card px-3 text-base outline-none transition placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-ring"
                    placeholder="e.g. 1978"
                    min={1920}
                    max={2010}
                    value={birthYear}
                    onChange={(e) => setBirthYear(e.target.value.slice(0, 4))}
                  />
                  {birthYear.length === 4 && !birthYearValid ? (
                    <span className="mt-1 block text-xs text-destructive">
                      Please enter a year between 1920 and {maxBirthYear}.
                    </span>
                  ) : null}
                </label>

                <label className="block">
                  <span className="text-sm font-medium">Where did you grow up?</span>
                  <select
                    className="mt-2 h-12 w-full rounded-md border bg-card px-3 text-base outline-none transition focus:ring-2 focus:ring-ring"
                    value={grewUpCountry}
                    onChange={(e) => {
                      setGrewUpCountry(e.target.value);
                      setGrewUpRegion('');
                    }}
                  >
                    <option value="">Select a country</option>
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>{c.name}</option>
                    ))}
                  </select>
                </label>

                {grewUpCountry === 'US' ? (
                  <label className="block">
                    <span className="text-sm font-medium">Which state?</span>
                    <select
                      className="mt-2 h-12 w-full rounded-md border bg-card px-3 text-base outline-none transition focus:ring-2 focus:ring-ring"
                      value={grewUpRegion}
                      onChange={(e) => setGrewUpRegion(e.target.value)}
                    >
                      <option value="">Select a state</option>
                      {US_STATES.map((s) => (
                        <option key={s.code} value={s.name}>{s.name}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>

              <div className="mt-auto grid grid-cols-2 gap-3 pt-2">
                <button type="button" className="btn-ghost h-12" onClick={() => setCurrentStep('welcome')}>
                  Back
                </button>
                <button
                  type="button"
                  className="btn-primary h-12"
                  onClick={() => setCurrentStep('warmup')}
                  disabled={!canAdvanceBackground}
                >
                  Continue
                </button>
              </div>
            </div>
          ) : null}

          {currentStep === 'warmup' ? (
            <div className="flex flex-1 flex-col gap-7">
              <StepHeader
                title="Tell us about your interests"
                subtitle="Free text. The more specific, the better."
              />

              <div className="space-y-4">
                {WARMUP_FIELDS.map(({ field, label, placeholder, optional }) => {
                  const value = warmupAnswers[field] ?? '';
                  return (
                    <label key={field} className="block">
                      <span className="text-sm font-medium">
                        {label}
                        {optional ? <span className="text-muted-foreground"> optional</span> : null}
                      </span>
                      <input
                        className="mt-2 h-12 w-full rounded-md border bg-card px-3 text-base outline-none transition placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-ring"
                        maxLength={200}
                        placeholder={placeholder}
                        value={value}
                        onChange={(event) => updateWarmupAnswer(field, event.target.value)}
                      />
                      {value.length > 150 ? (
                        <span className="mt-1 block text-right text-xs text-muted-foreground">
                          {value.length}/200
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>

              {error ? (
                <ErrorPanel
                  message={error}
                  actions={(
                    <>
                      <button type="button" className="btn-primary h-10" onClick={generateProposals}>
                        Try again
                      </button>
                      <button type="button" className="btn-ghost h-10" onClick={skipSuggestions}>
                        Skip suggestions
                      </button>
                    </>
                  )}
                />
              ) : null}

              <div className="mt-auto grid grid-cols-2 gap-3 pt-2">
                <button type="button" className="btn-ghost h-12" onClick={() => setCurrentStep('background')}>
                  Back
                </button>
                <button
                  type="button"
                  className="btn-primary h-12"
                  onClick={generateProposals}
                  disabled={!canGenerate || isLoading}
                >
                  See suggestions
                </button>
              </div>
            </div>
          ) : null}

          {currentStep === 'review' ? (
            <div className="flex flex-1 flex-col gap-7">
              <StepHeader
                title="Here's what we found"
                subtitle="Pick up to 5. You can edit any of them, or write your own."
              />

              <div className="space-y-3">
                {reviewInterests.map((interest) => {
                  const selected = isSelected(selectedInterests, interest);
                  const normalized = toSelected(interest);
                  const atCap = selectedInterests.length >= 5 && !selected;
                  const fromInvite = inviteInterests.some((seeded) => selectedKey(toSelected(seeded) ?? { domain: '', broadCategory: '' }) === selectedKey(normalized ?? { domain: '', broadCategory: '' }));
                  const key = `${interest.domain}-${interest.broadCategory}`;
                  const editing = normalized ? editingKey === selectedKey(normalized) : false;

                  return (
                    <div
                      key={key}
                      className={[
                        'rounded-lg border p-4 transition',
                        selected ? 'border-foreground bg-foreground text-background' : 'bg-card',
                        atCap ? 'opacity-45' : '',
                      ].join(' ')}
                      title={atCap ? '5 max - deselect one to add another' : undefined}
                      onPointerDown={() => startLongPress(interest)}
                      onPointerUp={clearLongPress}
                      onPointerLeave={clearLongPress}
                    >
                      {editing ? (
                        <div className="space-y-3">
                          <input
                            className="h-11 w-full rounded-md border bg-background px-3 text-base text-foreground outline-none focus:ring-2 focus:ring-ring"
                            value={editingDomain}
                            maxLength={100}
                            onChange={(event) => setEditingDomain(event.target.value)}
                          />
                          <div className="flex gap-2">
                            <button type="button" className="btn-primary h-9" onClick={() => saveEdit(interest)}>
                              Save
                            </button>
                            <button type="button" className="btn-ghost h-9" onClick={() => setEditingKey(null)}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-3">
                          <button
                            type="button"
                            className="min-w-0 flex-1 text-left"
                            onClick={() => toggleInterest(interest)}
                            disabled={atCap}
                          >
                            <span className="block text-xl font-semibold tracking-normal">{interest.domain}</span>
                            <span className={`mt-1 block text-xs font-medium uppercase ${selected ? 'text-background/70' : 'text-muted-foreground'}`}>
                              {interest.broadCategory}
                            </span>
                            {interest.rationale ? (
                              <span className={`mt-3 block text-sm italic leading-6 ${selected ? 'text-background/80' : 'text-muted-foreground'}`}>
                                {interest.rationale}
                              </span>
                            ) : null}
                            {fromInvite ? (
                              <span className={`mt-3 inline-flex rounded-sm border px-2 py-1 text-[11px] font-semibold uppercase ${selected ? 'border-background/30 text-background/80' : 'text-muted-foreground'}`}>
                                From {displayInviterName}
                              </span>
                            ) : null}
                          </button>
                          <button
                            type="button"
                            className={`grid size-9 shrink-0 place-items-center rounded-md border ${selected ? 'border-background/30' : 'hover:bg-muted'}`}
                            aria-label={`Edit ${interest.domain}`}
                            title="Edit"
                            onClick={() => beginEdit(interest)}
                          >
                            <Edit3 className="size-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="space-y-3">
                {!showComposer ? (
                  <button
                    type="button"
                    className="btn-ghost h-11 w-full gap-2"
                    onClick={() => setShowComposer(true)}
                    disabled={selectedInterests.length >= 5}
                  >
                    <Plus className="size-4" />
                    Write your own
                  </button>
                ) : (
                  <div className="rounded-lg border bg-card p-4">
                    <div className="flex items-center gap-2">
                      <input
                        className="h-11 min-w-0 flex-1 rounded-md border bg-background px-3 text-base outline-none focus:ring-2 focus:ring-ring"
                        placeholder="Write an interest"
                        value={customInput}
                        maxLength={100}
                        onChange={(event) => setCustomInput(event.target.value)}
                        disabled={selectedInterests.length >= 5}
                      />
                      <button
                        type="button"
                        className="grid size-11 place-items-center rounded-md border hover:bg-muted"
                        aria-label="Close composer"
                        title="Close"
                        onClick={() => setShowComposer(false)}
                      >
                        <X className="size-4" />
                      </button>
                    </div>

                    <div className="mt-3 min-h-11 text-sm">
                      {isCanonicalizing ? (
                        <p className="flex items-center gap-2 text-muted-foreground">
                          <Spinner small />
                          Checking wording...
                        </p>
                      ) : null}
                      {canonicalSuggestion ? (
                        <div className="space-y-3 rounded-md border bg-background p-3">
                          <p>
                            Suggested: <span className="font-medium">{canonicalSuggestion.suggested}</span>
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="btn-primary h-9"
                              onClick={() => setCustomChoice('suggested')}
                            >
                              <Check className="size-4" />
                              Use this
                            </button>
                            <button
                              type="button"
                              className="btn-ghost h-9"
                              onClick={() => setCustomChoice('mine')}
                            >
                              Keep mine
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      className="btn-primary mt-3 h-11 w-full"
                      onClick={addCustomInterest}
                      disabled={
                        normalizeDomain(customInput).length < 2 ||
                        selectedInterests.length >= 5 ||
                        (canonicalSuggestion !== null && customChoice === null)
                      }
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>

              <div className="sticky bottom-0 mt-auto border-t bg-background/95 py-4 backdrop-blur">
                <div className="mb-3 flex items-center justify-between text-sm">
                  <span className="font-medium">{selectedInterests.length} of 5 selected</span>
                  <span className="text-muted-foreground">
                    {selectedInterests.length === 0 ? 'Pick at least 1 to continue' : null}
                    {selectedInterests.length === 5 ? '5 max - deselect one to add another' : null}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" className="btn-ghost h-12" onClick={() => setCurrentStep('warmup')}>
                    Back
                  </button>
                  <button
                    type="button"
                    className="btn-primary h-12"
                    onClick={() => setCurrentStep('pick')}
                    disabled={selectedInterests.length === 0}
                  >
                    Continue
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {currentStep === 'pick' ? (
            <div className="flex flex-1 flex-col gap-7">
              <StepHeader
                title="Here's your starting map"
                subtitle="These are what your daily round will draw from. You can change them any time from your Knowledge page."
              />

              <ol className="space-y-3">
                {selectedInterests.map((interest, index) => (
                  <li key={`${interest.domain}-${index}`} className="flex gap-3 rounded-lg border bg-card p-4">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-foreground text-sm font-semibold text-background">
                      {index + 1}
                    </span>
                    <span className="min-w-0 pt-1">
                      <span className="block font-semibold">{interest.domain}</span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {interest.broadCategory}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>

              {error ? <ErrorPanel message={error} /> : null}

              <div className="mt-auto grid grid-cols-2 gap-3 pt-4">
                <button type="button" className="btn-ghost h-12" onClick={() => setCurrentStep('review')} disabled={isLoading}>
                  Back
                </button>
                <button type="button" className="btn-primary h-12" onClick={saveInterests} disabled={isLoading}>
                  {isLoading ? 'Saving...' : 'Lock it in'}
                </button>
              </div>
            </div>
          ) : null}

          {currentStep === 'complete' ? (
            <div className="flex flex-1 flex-col justify-center gap-8">
              <StepHeader
                title="You're set."
                subtitle="Your first daily round will be ready at noon EST."
              />
              <p className="text-base leading-7 text-muted-foreground">Until then, take a look around.</p>
              <div className="space-y-3">
                <button type="button" className="btn-primary h-12 w-full" onClick={() => router.push('/')}>
                  Go to home
                </button>
                {showDailySetup ? (
                  <button type="button" className="btn-ghost h-12 w-full" onClick={() => router.push('/daily/setup')}>
                    Set up today&apos;s round now
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function ErrorPanel({ message, actions }: { message: string; actions?: ReactNode }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
      <p>{message}</p>
      {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
