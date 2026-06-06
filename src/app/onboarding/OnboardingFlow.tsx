'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Edit3, Loader2, X } from 'lucide-react'
import { AddTopicField, type AddTopicError } from '@/components/interests/AddTopicField'

// Condensed onboarding: name → handle → one interests screen (warm-up is an
// optional expander there; the cultural-anchor/background step was removed).
type CurrentStep = 'display-name' | 'handle' | 'review'

export type WarmupAnswers = {
  deepDive?: string
  hourLongTopic?: string
  anythingElse?: string
}

export type ProposedInterest = {
  domain: string
  broadCategory: string
  rationale?: string | null
}

type SelectedInterest = {
  domain: string
  broadCategory: string
}

export type PreSeededInterest = ProposedInterest

type OnboardingFlowProps = {
  preSeededInterests: PreSeededInterest[]
  inviterName?: string | null
  inviteeDisplayName?: string | null
  initialDisplayName?: string | null
  initialHandle?: string | null
}

const DISPLAY_NAME_MIN = 2
const DISPLAY_NAME_MAX = 30
const HANDLE_MIN = 3
const HANDLE_MAX = 20
const HANDLE_FORMAT = /^[a-z][a-z0-9_]{2,19}$/

function sanitizeForHandle(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, HANDLE_MAX)
}

const WARMUP_FIELDS: Array<{
  field: keyof WarmupAnswers
  label: string
  placeholder: string
  optional?: boolean
}> = [
  {
    field: 'deepDive',
    label: "A book, composer, or filmmaker you've gone deep on?",
    placeholder:
      "e.g. Middlemarch, or Tchaikovsky's symphonies, or Werner Herzog",
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
]

const LOADING_COPY = [
  'Reading your answers...',
  'Looking for connections...',
  'Building your map...',
]

const STEP_DOTS: Array<{ step: CurrentStep; label: string }> = [
  { step: 'display-name', label: 'Name' },
  { step: 'handle', label: 'Handle' },
  { step: 'review', label: 'Interests' },
]

const MIN_INTERESTS = 3
// No upper product cap — players pick as many interests as they like. This is a
// defensive sanity bound only (the save path fans out into per-interest LLM
// work); no real user reaches it, and the UI never shows it as a ceiling.
const MAX_INTERESTS = 100

function normalizeDomain(domain: string) {
  return domain.trim().replace(/\s+/g, ' ')
}

function selectedKey(interest: SelectedInterest) {
  return interest.domain.trim().toLowerCase()
}

function toSelected(interest: ProposedInterest): SelectedInterest | null {
  const domain = normalizeDomain(interest.domain)
  if (domain.length < 2) return null

  return {
    domain,
    broadCategory:
      normalizeDomain(interest.broadCategory || 'General Knowledge') || 'General Knowledge',
  }
}

function isSelected(
  selectedInterests: SelectedInterest[],
  interest: ProposedInterest
) {
  const selected = toSelected(interest)
  return selected
    ? selectedInterests.some(
        (item) => selectedKey(item) === selectedKey(selected)
      )
    : false
}

function Spinner({ small = false }: { small?: boolean }) {
  return (
    <Loader2
      className={`${small ? 'size-4' : 'size-7'} animate-spin`}
      aria-hidden="true"
    />
  )
}

function ProgressDots({ currentStep }: { currentStep: CurrentStep }) {
  const activeIndex = Math.max(
    0,
    STEP_DOTS.findIndex((item) => item.step === currentStep)
  )

  return (
    <div
      className="flex items-center justify-center gap-3"
      aria-label="Onboarding progress"
    >
      {STEP_DOTS.map((item, index) => {
        const active = index <= activeIndex
        const current = item.step === currentStep

        return (
          <div key={item.step} className="flex items-center gap-2">
            <span
              className={[
                'block size-2.5 rounded-full transition',
                active ? 'bg-foreground' : 'bg-border',
                current ? 'ring-foreground/10 ring-4' : '',
              ].join(' ')}
            />
            <span className="sr-only">{item.label}</span>
          </div>
        )
      })}
    </div>
  )
}

function StepHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="space-y-2">
      <h1 className="text-3xl font-semibold tracking-normal text-balance sm:text-4xl">
        {title}
      </h1>
      <p className="text-muted-foreground text-base leading-7">{subtitle}</p>
    </div>
  )
}

export default function OnboardingFlow({
  preSeededInterests,
  inviterName,
  inviteeDisplayName,
  initialDisplayName,
  initialHandle,
}: OnboardingFlowProps) {
  const router = useRouter()
  const hasInitialDisplayName = Boolean(initialDisplayName?.trim())
  const hasInitialHandle = Boolean(initialHandle?.trim())
  const [currentStep, setCurrentStep] = useState<CurrentStep>(() => {
    if (!hasInitialDisplayName) return 'display-name'
    if (!hasInitialHandle) return 'handle'
    return 'review'
  })
  const [displayName, setDisplayName] = useState<string>(() =>
    (initialDisplayName ?? inviteeDisplayName ?? '')
      .trim()
      .slice(0, DISPLAY_NAME_MAX)
  )
  const [isSavingDisplayName, setIsSavingDisplayName] = useState(false)
  const [displayNameError, setDisplayNameError] = useState<string | null>(null)
  const [handle, setHandle] = useState<string>(() => {
    const seed = initialHandle?.trim()
    if (seed) return seed.toLowerCase().slice(0, HANDLE_MAX)
    return sanitizeForHandle(initialDisplayName ?? inviteeDisplayName ?? '')
  })
  const [handleTouched, setHandleTouched] = useState(false)
  const [handleStatus, setHandleStatus] = useState<
    | { state: 'idle' }
    | { state: 'checking' }
    | { state: 'available' }
    | { state: 'unavailable'; reason: 'format' | 'reserved' | 'taken' }
  >({ state: 'idle' })
  const [isSavingHandle, setIsSavingHandle] = useState(false)
  const [handleError, setHandleError] = useState<string | null>(null)
  const [showWarmup, setShowWarmup] = useState(false)
  const [warmupAnswers, setWarmupAnswers] = useState<WarmupAnswers>({})
  const [proposedInterests, setProposedInterests] = useState<
    ProposedInterest[] | null
  >(null)
  const [inviteInterests, setInviteInterests] = useState<PreSeededInterest[]>(
    () => preSeededInterests
  )
  const [selectedInterests, setSelectedInterests] = useState<
    SelectedInterest[]
  >(() =>
    preSeededInterests
      .flatMap((interest) => {
        const selected = toSelected(interest)
        return selected ? [selected] : []
      })
      .slice(0, MAX_INTERESTS)
  )
  const [isLoading, setIsLoading] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingCopyIndex, setLoadingCopyIndex] = useState(0)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editingDomain, setEditingDomain] = useState('')
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const displayInviterName = inviterName?.trim()
    ? inviterName.trim()
    : 'A friend'

  const canGenerate =
    normalizeDomain(warmupAnswers.deepDive ?? '').length > 0 &&
    normalizeDomain(warmupAnswers.hourLongTopic ?? '').length > 0

  const reviewInterests = useMemo(
    () => [
      ...inviteInterests,
      ...(proposedInterests ?? []).filter(
        (interest) =>
          !inviteInterests.some(
            (seeded) =>
              selectedKey(
                toSelected(seeded) ?? { domain: '', broadCategory: '' }
              ) ===
              selectedKey(
                toSelected(interest) ?? { domain: '', broadCategory: '' }
              )
          )
      ),
    ],
    [inviteInterests, proposedInterests]
  )

  useEffect(() => {
    if (currentStep !== 'handle') return

    const candidate = handle.trim().toLowerCase()
    const controller = new AbortController()

    const immediate = window.setTimeout(() => {
      if (candidate.length < HANDLE_MIN) {
        setHandleStatus({ state: 'idle' })
        return
      }
      if (!HANDLE_FORMAT.test(candidate)) {
        setHandleStatus({ state: 'unavailable', reason: 'format' })
        return
      }
      setHandleStatus({ state: 'checking' })
    }, 0)

    const debounced = window.setTimeout(async () => {
      if (
        candidate.length < HANDLE_MIN ||
        !HANDLE_FORMAT.test(candidate)
      ) {
        return
      }
      try {
        const response = await fetch(
          `/api/handle/check?handle=${encodeURIComponent(candidate)}`,
          { signal: controller.signal },
        )
        const data = await response.json().catch(() => ({}))
        if (!response.ok) return
        if (data?.available === true) {
          setHandleStatus({ state: 'available' })
        } else if (typeof data?.reason === 'string') {
          setHandleStatus({
            state: 'unavailable',
            reason: data.reason as 'format' | 'reserved' | 'taken',
          })
        }
      } catch (fetchError) {
        if (
          !(fetchError instanceof DOMException && fetchError.name === 'AbortError')
        ) {
          setHandleStatus({ state: 'idle' })
        }
      }
    }, 300)

    return () => {
      controller.abort()
      window.clearTimeout(immediate)
      window.clearTimeout(debounced)
    }
  }, [currentStep, handle])

  useEffect(() => {
    if (!isGenerating) return

    const interval = window.setInterval(() => {
      setLoadingCopyIndex((current) => (current + 1) % LOADING_COPY.length)
    }, 3000)

    return () => window.clearInterval(interval)
  }, [isGenerating])

  function updateWarmupAnswer(field: keyof WarmupAnswers, value: string) {
    setWarmupAnswers((current) => ({
      ...current,
      [field]: value.slice(0, 200),
    }))
  }

  function toggleInterest(interest: ProposedInterest) {
    const selected = toSelected(interest)
    if (!selected) return

    setSelectedInterests((current) => {
      const exists = current.some(
        (item) => selectedKey(item) === selectedKey(selected)
      )
      if (exists)
        return current.filter(
          (item) => selectedKey(item) !== selectedKey(selected)
        )
      if (current.length >= MAX_INTERESTS) return current
      return [...current, selected]
    })
  }

  function beginEdit(interest: ProposedInterest) {
    const selected = toSelected(interest)
    if (!selected) return

    setEditingKey(selectedKey(selected))
    setEditingDomain(selected.domain)
  }

  function saveEdit(interest: ProposedInterest) {
    const selected = toSelected(interest)
    const nextDomain = normalizeDomain(editingDomain)
    if (!selected || nextDomain.length < 2) return

    const edited = { ...interest, domain: nextDomain }
    setInviteInterests((current) =>
      current.map((item) =>
        selectedKey(toSelected(item) ?? { domain: '', broadCategory: '' }) ===
        selectedKey(selected)
          ? edited
          : item
      )
    )
    setProposedInterests(
      (current) =>
        current?.map((item) =>
          selectedKey(toSelected(item) ?? { domain: '', broadCategory: '' }) ===
          selectedKey(selected)
            ? edited
            : item
        ) ?? current
    )
    setSelectedInterests((current) =>
      current.map((item) =>
        selectedKey(item) === selectedKey(selected)
          ? { ...item, domain: nextDomain }
          : item
      )
    )
    setEditingKey(null)
    setEditingDomain('')
  }

  function startLongPress(interest: ProposedInterest) {
    clearLongPress()
    longPressTimer.current = setTimeout(() => beginEdit(interest), 500)
  }

  function clearLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  async function generateProposals() {
    if (!canGenerate) return

    setError(null)
    setIsGenerating(true)
    setLoadingCopyIndex(0)

    try {
      // Cultural anchor was removed from onboarding; the endpoint generates
      // from warm-up answers alone.
      const response = await fetch('/api/onboarding/propose-interests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warmupAnswers }),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok || !Array.isArray(data?.proposedInterests)) {
        setError(
          "We couldn't generate suggestions. You can try again or write your own."
        )
        return
      }

      setProposedInterests(data.proposedInterests)
      setShowWarmup(false)
    } catch {
      setError(
        "We couldn't generate suggestions. You can try again or write your own."
      )
    } finally {
      setIsGenerating(false)
    }
  }

  // Stage a chosen topic (from the add-topic field) into the selected list.
  async function addSelectedInterest(topic: { label: string; broadCategory?: string | null }) {
    const selected = toSelected({
      domain: topic.label,
      broadCategory: topic.broadCategory ?? 'General Knowledge',
    })
    if (!selected) throw new Error('Enter a topic name.')
    if (selectedInterests.length >= MAX_INTERESTS) {
      const limit = new Error(`That's the max — ${MAX_INTERESTS} interests.`) as AddTopicError
      limit.code = 'limit_reached'
      throw limit
    }

    // Validate answerability up front: interests are staged client-side and not
    // persisted until "Lock it in", so without this a topic with no factual
    // basis ("my cat") would only be caught at the very end. The check fails
    // open server-side, so an LLM outage never blocks staging.
    const check = await fetch('/api/interests/check', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: selected.domain }),
    })
    const checkBody = await check.json().catch(() => null)
    if (check.ok && checkBody?.ok === false) {
      if (checkBody.code === 'too_broad') {
        const broad = new Error(checkBody.message) as AddTopicError
        broad.code = 'too_broad'
        throw broad
      }
      throw new Error(
        checkBody.message ?? 'We could not find real questions for that topic.'
      )
    }

    setError(null)
    setSelectedInterests((current) =>
      current.some((item) => selectedKey(item) === selectedKey(selected))
        ? current
        : [...current, selected].slice(0, MAX_INTERESTS)
    )
  }

  function removeSelectedInterest(target: SelectedInterest) {
    setSelectedInterests((current) =>
      current.filter((item) => selectedKey(item) !== selectedKey(target))
    )
  }

  async function submitDisplayName() {
    const trimmed = displayName.trim().replace(/\s+/g, ' ')
    if (trimmed.length < DISPLAY_NAME_MIN || trimmed.length > DISPLAY_NAME_MAX) {
      setDisplayNameError(
        `Pick something between ${DISPLAY_NAME_MIN} and ${DISPLAY_NAME_MAX} characters.`
      )
      return
    }

    setDisplayNameError(null)
    setIsSavingDisplayName(true)

    try {
      const response = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: trimmed }),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setDisplayNameError(
          typeof data?.error === 'string'
            ? data.error
            : "We couldn't save that name. Try again."
        )
        return
      }

      setDisplayName(trimmed)
      if (!handle && !hasInitialHandle) {
        setHandle(sanitizeForHandle(trimmed))
      }
      setCurrentStep(hasInitialHandle ? 'review' : 'handle')
    } catch {
      setDisplayNameError("We couldn't save that name. Try again.")
    } finally {
      setIsSavingDisplayName(false)
    }
  }

  async function submitHandle() {
    const candidate = handle.trim().toLowerCase()
    if (!HANDLE_FORMAT.test(candidate)) {
      setHandleError(
        'Handle must be 3–20 characters, start with a letter, and use only lowercase letters, numbers, and underscores.'
      )
      return
    }

    setIsSavingHandle(true)
    setHandleError(null)

    try {
      const response = await fetch('/api/account/handle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: candidate }),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setHandleError(
          typeof data?.message === 'string'
            ? data.message
            : "We couldn't save that handle. Try again."
        )
        return
      }

      setHandle(candidate)
      setCurrentStep('review')
    } catch {
      setHandleError("We couldn't save that handle. Try again.")
    } finally {
      setIsSavingHandle(false)
    }
  }

  async function saveInterests(interestsOverride?: SelectedInterest[]) {
    const cleanSelected = (interestsOverride ?? selectedInterests)
      .flatMap((interest) => {
        const selected = toSelected(interest)
        return selected ? [selected] : []
      })
      .slice(0, MAX_INTERESTS)

    const inviteSelectedCount = inviteInterests.filter((interest) => {
      const selected = toSelected(interest)
      return selected
        ? cleanSelected.some(
            (item) => selectedKey(item) === selectedKey(selected)
          )
        : false
    }).length

    if (cleanSelected.length < MIN_INTERESTS) {
      setError(`Pick at least ${MIN_INTERESTS} to continue.`)
      return
    }

    setError(null)
    setIsLoading(true)

    try {
      const response = await fetch('/api/onboarding/save-interests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interests: cleanSelected,
          telemetry: {
            inviteInterestCount: inviteInterests.length,
            inviteSelectedCount,
          },
        }),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok || data?.ok !== true) {
        setError(data?.message ?? data?.error ?? 'Unable to save interests.')
        return
      }

      // Kick off first-round generation in the background so it's ready (or
      // nearly) when the player lands in /daily, then take them straight into
      // gameplay instead of the homepage. keepalive lets the POST survive the
      // client navigation; the queue route is idempotent, so /daily's own load
      // won't double-generate. A freshly-declared interest list guarantees a
      // knowledge base, so /daily won't bounce to setup.
      void fetch('/api/daily/queue', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        keepalive: true,
      }).catch(() => {})

      router.push('/daily')
    } catch {
      setError('Unable to save interests.')
    } finally {
      setIsLoading(false)
    }
  }

  if (isGenerating) {
    return (
      <main className="bg-background text-foreground grid min-h-screen place-items-center px-5 py-12">
        <div className="flex max-w-sm flex-col items-center gap-5 text-center">
          <div className="bg-card grid size-16 place-items-center rounded-full border shadow-sm">
            <Spinner />
          </div>
          <p className="text-xl font-semibold">
            {LOADING_COPY[loadingCopyIndex]}
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="bg-background text-foreground min-h-screen px-4 pt-8 pb-10 sm:px-6 sm:pt-12">
      <section className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-2xl flex-col">
        <ProgressDots currentStep={currentStep} />

        <div className="mt-9 flex flex-1 flex-col">
          {currentStep === 'display-name' ? (
            <div className="flex flex-1 flex-col justify-center gap-8">
              <StepHeader
                title="What should we call you?"
                subtitle={
                  inviteeDisplayName?.trim()
                    ? `${displayInviterName} added you as "${inviteeDisplayName.trim()}". Keep it or change it — ${DISPLAY_NAME_MIN} to ${DISPLAY_NAME_MAX} characters.`
                    : `This is how you'll appear to friends. ${DISPLAY_NAME_MIN} to ${DISPLAY_NAME_MAX} characters.`
                }
              />

              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!isSavingDisplayName) void submitDisplayName()
                }}
              >
                <label className="block">
                  <span className="text-sm font-medium">Your name</span>
                  <input
                    type="text"
                    className="bg-card placeholder:text-muted-foreground/70 focus:ring-ring mt-2 h-12 w-full rounded-md border px-3 text-base transition outline-none focus:ring-2"
                    placeholder="Your name"
                    autoFocus
                    autoComplete="name"
                    maxLength={DISPLAY_NAME_MAX}
                    value={displayName}
                    onChange={(e) => {
                      setDisplayName(e.target.value.slice(0, DISPLAY_NAME_MAX))
                      if (displayNameError) setDisplayNameError(null)
                    }}
                  />
                </label>

                {displayNameError ? (
                  <p className="text-destructive text-sm">{displayNameError}</p>
                ) : null}

                <button
                  type="submit"
                  className="btn-primary h-12 w-full"
                  disabled={
                    isSavingDisplayName ||
                    displayName.trim().length < DISPLAY_NAME_MIN
                  }
                >
                  {isSavingDisplayName ? 'Saving...' : 'Continue'}
                </button>
              </form>
            </div>
          ) : null}

          {currentStep === 'handle' ? (
            <div className="flex flex-1 flex-col justify-center gap-8">
              <StepHeader
                title="Pick your handle"
                subtitle={`This is your @ on Joshing — friends use it to find you. ${HANDLE_MIN}–${HANDLE_MAX} characters, lowercase letters, numbers, and underscores. Starts with a letter.`}
              />

              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!isSavingHandle) void submitHandle()
                }}
              >
                <label className="block">
                  <span className="text-sm font-medium">Your handle</span>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-muted-foreground text-base">@</span>
                    <input
                      type="text"
                      className="bg-card placeholder:text-muted-foreground/70 focus:ring-ring h-12 w-full rounded-md border px-3 text-base transition outline-none focus:ring-2"
                      placeholder="yourhandle"
                      autoFocus
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      maxLength={HANDLE_MAX}
                      value={handle}
                      onChange={(e) => {
                        setHandleTouched(true)
                        setHandle(
                          e.target.value
                            .toLowerCase()
                            .replace(/[^a-z0-9_]/g, '')
                            .slice(0, HANDLE_MAX),
                        )
                        if (handleError) setHandleError(null)
                      }}
                    />
                  </div>
                </label>

                {handleTouched && handle.length >= HANDLE_MIN ? (
                  <p
                    className={`text-sm ${
                      handleStatus.state === 'available'
                        ? 'text-emerald-600'
                        : handleStatus.state === 'unavailable'
                          ? 'text-destructive'
                          : 'text-muted-foreground'
                    }`}
                  >
                    {handleStatus.state === 'checking'
                      ? 'Checking…'
                      : handleStatus.state === 'available'
                        ? `@${handle} is available.`
                        : handleStatus.state === 'unavailable'
                          ? handleStatus.reason === 'taken'
                            ? 'That handle is already taken.'
                            : handleStatus.reason === 'reserved'
                              ? 'That handle is reserved.'
                              : 'Use only lowercase letters, numbers, and underscores. Start with a letter.'
                          : null}
                  </p>
                ) : null}

                {handleError ? (
                  <p className="text-destructive text-sm">{handleError}</p>
                ) : null}

                <button
                  type="submit"
                  className="btn-primary h-12 w-full"
                  disabled={
                    isSavingHandle ||
                    handle.length < HANDLE_MIN ||
                    handleStatus.state === 'checking' ||
                    handleStatus.state === 'unavailable'
                  }
                >
                  {isSavingHandle ? 'Saving…' : 'Continue'}
                </button>
              </form>
            </div>
          ) : null}

          {currentStep === 'review' ? (
            <div className="flex flex-1 flex-col gap-7">
              <StepHeader
                title="What are you into?"
                subtitle={`Add at least ${MIN_INTERESTS} things you'd love to be asked about. Tap a suggestion, write your own, or get ideas from the prompts.`}
              />

              <div className="space-y-3">
                <p className="text-sm font-medium">
                  Your interests · {selectedInterests.length}
                </p>
                {selectedInterests.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    Nothing yet — add at least {MIN_INTERESTS} below.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {selectedInterests.map((interest) => (
                      <button
                        key={selectedKey(interest)}
                        type="button"
                        className="bg-foreground text-background inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium"
                        onClick={() => removeSelectedInterest(interest)}
                        aria-label={`Remove ${interest.domain}`}
                      >
                        {interest.domain}
                        <X className="size-3.5" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <AddTopicField
                heading="Add your own"
                placeholder="e.g. Byzantine Coinage"
                maxLength={100}
                disabled={selectedInterests.length >= MAX_INTERESTS}
                existingLabels={selectedInterests.map((item) => item.domain)}
                onAdd={addSelectedInterest}
                inputClassName="bg-background focus:ring-ring h-11 min-w-0 flex-1 rounded-md border px-3 text-base outline-none focus:ring-2 disabled:opacity-60"
                buttonClassName="btn-primary h-11 px-5"
                chipClassName="rounded-md border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-muted disabled:opacity-50"
                mutedClassName="text-muted-foreground text-sm"
                errorClassName="text-destructive mt-3 text-sm"
              />

              {reviewInterests.some(
                (interest) => !isSelected(selectedInterests, interest)
              ) ? (
                <div className="space-y-3">
                  <p className="text-sm font-medium">Suggestions</p>
                  {reviewInterests
                    .filter((interest) => !isSelected(selectedInterests, interest))
                    .map((interest) => {
                      const normalized = toSelected(interest)
                      const atCap = selectedInterests.length >= MAX_INTERESTS
                      const fromInvite = inviteInterests.some(
                        (seeded) =>
                          selectedKey(
                            toSelected(seeded) ?? { domain: '', broadCategory: '' }
                          ) ===
                          selectedKey(normalized ?? { domain: '', broadCategory: '' })
                      )
                      const key = `${interest.domain}-${interest.broadCategory}`
                      const editing = normalized
                        ? editingKey === selectedKey(normalized)
                        : false

                      return (
                        <div
                          key={key}
                          className={[
                            'bg-card rounded-lg border p-4 transition',
                            atCap ? 'opacity-45' : '',
                          ].join(' ')}
                          title={atCap ? `${MAX_INTERESTS} max - remove one to add another` : undefined}
                          onPointerDown={() => startLongPress(interest)}
                          onPointerUp={clearLongPress}
                          onPointerLeave={clearLongPress}
                        >
                          {editing ? (
                            <div className="space-y-3">
                              <input
                                className="bg-background text-foreground focus:ring-ring h-11 w-full rounded-md border px-3 text-base outline-none focus:ring-2"
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
                                <span className="block text-xl font-semibold tracking-normal">
                                  {interest.domain}
                                </span>
                                <span className="text-muted-foreground mt-1 block text-xs font-medium uppercase">
                                  {interest.broadCategory}
                                </span>
                                {interest.rationale ? (
                                  <span className="text-muted-foreground mt-3 block text-sm leading-6 italic">
                                    {interest.rationale}
                                  </span>
                                ) : null}
                                {fromInvite ? (
                                  <span className="text-muted-foreground mt-3 inline-flex rounded-sm border px-2 py-1 text-[11px] font-semibold uppercase">
                                    From {displayInviterName}
                                  </span>
                                ) : null}
                              </button>
                              <button
                                type="button"
                                className="hover:bg-muted grid size-9 shrink-0 place-items-center rounded-md border"
                                aria-label={`Edit ${interest.domain}`}
                                title="Edit"
                                onClick={() => beginEdit(interest)}
                              >
                                <Edit3 className="size-4" />
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                </div>
              ) : null}

              <div className="space-y-3">
                {!showWarmup ? (
                  <button
                    type="button"
                    className="btn-ghost h-11 w-full"
                    onClick={() => setShowWarmup(true)}
                  >
                    Need ideas? Answer a couple quick questions
                  </button>
                ) : (
                  <div className="bg-card space-y-4 rounded-lg border p-4">
                    {WARMUP_FIELDS.map(({ field, label, placeholder, optional }) => {
                      const value = warmupAnswers[field] ?? ''
                      return (
                        <label key={field} className="block">
                          <span className="text-sm font-medium">
                            {label}
                            {optional ? (
                              <span className="text-muted-foreground"> optional</span>
                            ) : null}
                          </span>
                          <input
                            className="bg-background placeholder:text-muted-foreground/70 focus:ring-ring mt-2 h-12 w-full rounded-md border px-3 text-base transition outline-none focus:ring-2"
                            maxLength={200}
                            placeholder={placeholder}
                            value={value}
                            onChange={(event) => updateWarmupAnswer(field, event.target.value)}
                          />
                        </label>
                      )
                    })}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn-primary h-11 flex-1"
                        onClick={generateProposals}
                        disabled={!canGenerate || isGenerating}
                      >
                        See suggestions
                      </button>
                      <button
                        type="button"
                        className="btn-ghost h-11 px-4"
                        onClick={() => setShowWarmup(false)}
                      >
                        Hide
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-background/95 sticky bottom-0 mt-auto border-t py-4 backdrop-blur">
                {error ? (
                  <div className="mb-3">
                    <ErrorPanel message={error} />
                  </div>
                ) : null}
                <p className="text-muted-foreground mb-3 text-sm">
                  {selectedInterests.length < MIN_INTERESTS
                    ? `Pick at least ${MIN_INTERESTS} to continue (${selectedInterests.length}/${MIN_INTERESTS}).`
                    : `${selectedInterests.length} selected.`}
                </p>
                <button
                  type="button"
                  className="btn-primary h-12 w-full"
                  onClick={() => saveInterests()}
                  disabled={selectedInterests.length < MIN_INTERESTS || isLoading}
                >
                  {isLoading ? 'Saving...' : 'Lock it in'}
                </button>
              </div>
            </div>
          ) : null}

        </div>
      </section>
    </main>
  )
}

function ErrorPanel({
  message,
  actions,
}: {
  message: string
  actions?: ReactNode
}) {
  return (
    <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-4 text-sm">
      <p>{message}</p>
      {actions ? (
        <div className="mt-3 flex flex-wrap gap-2">{actions}</div>
      ) : null}
    </div>
  )
}
