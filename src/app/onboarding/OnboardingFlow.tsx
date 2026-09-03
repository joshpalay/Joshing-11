'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { AddTopicField, type AddTopicError } from '@/components/interests/AddTopicField'

// Condensed onboarding: name → handle → one interests screen (warm-up is an
// optional expander there; the cultural-anchor/background step was removed).
// Picking areas marks onboarding complete, kicks off question generation, and
// lands the player straight in /daily. The daily-reminder email opt-in moved
// off this flow into the post-first-five recap (FirstSessionRecap), so the ask
// arrives once the player has actually felt the loop.
type CurrentStep = 'setup' | 'review'

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
  /**
   * Where preSeededInterests came from — controls both pre-selection and copy.
   * 'named': the inviter chose these topics FOR this specific person
   * (AddFriendInvite) — they arrive pre-selected, as today.
   * 'link': the topics rode a per-user invite link (curated or auto-fallback
   * from the inviter's declared interests) that may reach anyone, not someone
   * the inviter had in mind — they arrive UNSELECTED, offered only as
   * suggestion chips. Defaults to 'named' so every existing caller (the dev
   * preview harness included) keeps today's pre-selecting behavior unchanged.
   */
  seedSource?: 'named' | 'link'
  inviterName?: string | null
  inviteeDisplayName?: string | null
  initialDisplayName?: string | null
  initialHandle?: string | null
  /**
   * Read-only replay for the dev onboarding harness. When set, the name, handle,
   * and interests steps advance through the real UI WITHOUT their mutating
   * writes (no PATCH /api/account, no POST /api/onboarding/save-interests), and
   * finishing chains to the next harness stage instead of the live flow. Lets
   * the harness drive this real component without burning onboarding state.
   */
  previewMode?: boolean
  /**
   * Where the interests step routes after finishing in `previewMode`. Lets the
   * full-walkthrough harness chain onward (e.g. into the welcome tour) instead
   * of the live home. Defaults to the standalone welcome-tour preview.
   */
  previewNextHref?: string
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

const MIN_INTERESTS = 3
// Onboarding caps the starting-areas selection at 12 (per product spec). The cap
// also bounds the save path's per-interest LLM fan-out. Inviter-suggested topics
// live in selectedInterests too, so they count toward this ceiling.
const MAX_INTERESTS = 12

// Bottom counter copy that mirrors the selection state without dashboard-speak:
// "0 selected" → "2 selected · pick at least 1 more" → "6 selected · add up to 6
// more" → "12 selected · that's plenty".
function selectionCounterCopy(count: number): string {
  if (count <= 0) return '0 selected'
  if (count < MIN_INTERESTS) {
    const remaining = MIN_INTERESTS - count
    return `${count} selected · pick at least ${remaining} more`
  }
  if (count >= MAX_INTERESTS) return `${MAX_INTERESTS} selected · that's plenty`
  return `${count} selected · add up to ${MAX_INTERESTS - count} more`
}

// One primary CTA, its label tracking the selection: locked until 3, a warm
// "that's plenty" flourish at the cap, "Start with these" in between.
function startCtaCopy(count: number): string {
  if (count < MIN_INTERESTS) return 'Pick at least 3 to start'
  if (count >= MAX_INTERESTS) return "That's plenty — start with these"
  return 'Start with these'
}

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
  seedSource = 'named',
  inviterName,
  inviteeDisplayName,
  initialDisplayName,
  initialHandle,
  previewMode = false,
  previewNextHref = '/dev/welcome-tour',
}: OnboardingFlowProps) {
  const router = useRouter()
  const hasInitialDisplayName = Boolean(initialDisplayName?.trim())
  const hasInitialHandle = Boolean(initialHandle?.trim())
  const [currentStep, setCurrentStep] = useState<CurrentStep>(() => {
    // Name and call sign now share one "setup" screen; only skip it when both
    // are already on file.
    if (!hasInitialDisplayName || !hasInitialHandle) return 'setup'
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
  // Inviter-seeded suggestions are immutable after the initial pre-selection: the
  // invitee keeps, ignores, or removes them (and adds their own), but never edits
  // the wording inline — so this is a stable value, not state.
  const inviteInterests: PreSeededInterest[] = preSeededInterests
  // Link-sourced seeds may reach someone the inviter never had in mind, so they
  // must NOT pre-populate the selection — only a named invite's topics do.
  const [selectedInterests, setSelectedInterests] = useState<
    SelectedInterest[]
  >(() =>
    seedSource === 'named'
      ? preSeededInterests
          .flatMap((interest) => {
            const selected = toSelected(interest)
            return selected ? [selected] : []
          })
          .slice(0, MAX_INTERESTS)
      : []
  )
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const displayInviterName = inviterName?.trim()
    ? inviterName.trim()
    : 'A friend'
  // Whether the invitee arrived with any pre-seeded topics. Drives the welcome
  // copy: with seeds we frame the screen as "remove what doesn't fit"; without
  // any (e.g. invite-link signups) we frame it as "add a few to start".
  const hasSeeds = inviteInterests.length > 0

  // The merged "suggested for you" list: pre-seeded topics the invitee removed
  // from their selection, offered back as one re-addable group. (Selected topics
  // live in the chips above and drop out of this list automatically.)
  const inviteSuggestions = inviteInterests.filter(
    (interest) => !isSelected(selectedInterests, interest)
  )
  const atSelectionCap = selectedInterests.length >= MAX_INTERESTS

  // Compact, tappable suggestion chips (not large cards): just the area name with
  // a "+" affordance. Tapping adds it back to Your topics. No rationale
  // paragraphs or category labels — keeps the screen scannable on mobile.
  const renderSuggestionChips = (list: ProposedInterest[], keyPrefix: string) => (
    <div className="flex flex-wrap gap-2">
      {list.map((interest) => (
        <button
          key={`${keyPrefix}-${interest.domain}`}
          type="button"
          onClick={() => toggleInterest(interest)}
          disabled={atSelectionCap}
          title={
            atSelectionCap
              ? `${MAX_INTERESTS} max — remove one to add another`
              : undefined
          }
          className="bg-card inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-45"
        >
          <span aria-hidden="true" className="text-muted-foreground">
            +
          </span>
          {interest.domain}
        </button>
      ))}
    </div>
  )

  useEffect(() => {
    if (currentStep !== 'setup') return

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
    // persisted until "Start with these", so without this a topic with no factual
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

  // Name + call sign now save together from one "setup" screen. Name persists
  // first, then handle; a handle failure surfaces under the handle field while
  // the (already-saved) name is kept, so retrying only re-runs the handle PATCH.
  async function submitSetup() {
    const trimmedName = displayName.trim().replace(/\s+/g, ' ')
    if (trimmedName.length < DISPLAY_NAME_MIN || trimmedName.length > DISPLAY_NAME_MAX) {
      setDisplayNameError(
        `Pick something between ${DISPLAY_NAME_MIN} and ${DISPLAY_NAME_MAX} characters.`
      )
      return
    }
    const candidate = handle.trim().toLowerCase()
    if (!HANDLE_FORMAT.test(candidate)) {
      setHandleError(
        'Handle must be 3–20 characters, start with a letter, and use only lowercase letters, numbers, and underscores.'
      )
      return
    }

    setDisplayNameError(null)
    setHandleError(null)

    // Dev harness replay — advance through the real UI without the PATCHes.
    if (previewMode) {
      setDisplayName(trimmedName)
      setHandle(candidate)
      setCurrentStep('review')
      return
    }

    setIsSavingDisplayName(true)
    try {
      const nameResponse = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: trimmedName }),
      })
      const nameData = await nameResponse.json().catch(() => ({}))
      if (!nameResponse.ok) {
        setDisplayNameError(
          typeof nameData?.error === 'string'
            ? nameData.error
            : "We couldn't save that name. Try again."
        )
        return
      }
      setDisplayName(trimmedName)

      setIsSavingHandle(true)
      const handleResponse = await fetch('/api/account/handle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: candidate }),
      })
      const handleData = await handleResponse.json().catch(() => ({}))
      if (!handleResponse.ok) {
        setHandleError(
          typeof handleData?.message === 'string'
            ? handleData.message
            : "We couldn't save that handle. Try again."
        )
        return
      }
      setHandle(candidate)
      setCurrentStep('review')
    } catch {
      setHandleError("We couldn't save your details. Try again.")
    } finally {
      setIsSavingDisplayName(false)
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

    // Dev harness replay — skip the save + first-round generation and chain to
    // the next stage (the welcome tour) instead of the live home.
    if (previewMode) {
      router.push(previewNextHref)
      return
    }

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
      // nearly) when the player lands in /daily. keepalive lets the POST survive
      // the client navigation; the queue route is idempotent, so /daily's own
      // load won't double-generate. A freshly-declared interest list guarantees
      // a knowledge base, so /daily won't bounce to setup.
      void fetch('/api/daily/queue', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        keepalive: true,
      }).catch(() => {})

      // Onboarding is now complete (save-interests set the flag) and the queue
      // is generating in the background. Land the player on home with the
      // first-run welcome tour armed (`?welcome=1`); its closing CTA drops them
      // straight into playing their Five. The tour self-suppresses after one
      // run, so returning users skip it. The daily-reminder opt-in lives in the
      // post-first-five recap.
      router.push('/?welcome=1')
    } catch {
      setError('Unable to save interests.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main className="bg-background text-foreground min-h-screen px-4 pt-8 pb-10 sm:px-6 sm:pt-12">
      <section className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-2xl flex-col">
        <div className="flex flex-1 flex-col">
          {currentStep === 'setup' ? (
            <div className="flex flex-1 flex-col justify-center gap-8">
              <div className="space-y-3">
                <p className="font-wordmark text-quiet font-bold tracking-[0.18em] text-[var(--brand-navy)] uppercase">
                  Joshing
                </p>
                <StepHeader
                  title="Set up your profile"
                  subtitle="Joshing is a daily trivia game you play with friends — questions tuned to what you actually know."
                />
                <p className="text-muted-foreground text-sm leading-6">
                  {inviteeDisplayName?.trim()
                    ? `${displayInviterName} added you as "${inviteeDisplayName.trim()}". Set your name and call sign — friends use your @ to find you.`
                    : 'Pick the name friends see and your call sign — your @ on Joshing.'}
                </p>
              </div>

              <form
                className="space-y-5"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!isSavingDisplayName && !isSavingHandle) void submitSetup()
                }}
              >
                <label className="block">
                  <span className="text-sm font-medium">Your name</span>
                  <input
                    type="text"
                    className="bg-[var(--brand-field)] placeholder:text-muted-foreground/70 focus:border-[var(--brand-navy)] mt-2 h-12 w-full rounded-md border border-[var(--accent-gold)] px-3 text-base transition outline-none"
                    placeholder="Your name"
                    autoFocus
                    autoComplete="name"
                    maxLength={DISPLAY_NAME_MAX}
                    value={displayName}
                    onChange={(e) => {
                      const next = e.target.value.slice(0, DISPLAY_NAME_MAX)
                      setDisplayName(next)
                      if (displayNameError) setDisplayNameError(null)
                      // Seed the call sign from the name until the user edits it.
                      if (!handleTouched && !hasInitialHandle) {
                        setHandle(sanitizeForHandle(next))
                      }
                    }}
                  />
                  {displayNameError ? (
                    <p className="text-destructive mt-2 text-sm">{displayNameError}</p>
                  ) : null}
                </label>

                <label className="block">
                  <span className="text-sm font-medium">Your call sign</span>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-muted-foreground text-base">@</span>
                    <input
                      type="text"
                      className="bg-[var(--brand-field)] placeholder:text-muted-foreground/70 focus:border-[var(--brand-navy)] h-12 w-full rounded-md border border-[var(--accent-gold)] px-3 text-base transition outline-none"
                      placeholder="yourhandle"
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
                  {handleTouched && handle.length >= HANDLE_MIN ? (
                    <p
                      className={`mt-2 text-sm ${
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
                              ? 'That call sign is already taken.'
                              : handleStatus.reason === 'reserved'
                                ? 'That call sign is reserved.'
                                : 'Use only lowercase letters, numbers, and underscores. Start with a letter.'
                            : null}
                    </p>
                  ) : null}
                  {handleError ? (
                    <p className="text-destructive mt-2 text-sm">{handleError}</p>
                  ) : null}
                </label>

                <p className="text-muted-foreground text-xs leading-5">
                  {`${DISPLAY_NAME_MIN}–${DISPLAY_NAME_MAX} characters for your name. Call sign is ${HANDLE_MIN}–${HANDLE_MAX} characters — lowercase letters, numbers, and underscores, starting with a letter.`}
                </p>

                <button
                  type="submit"
                  className="btn-primary w-full"
                  disabled={
                    isSavingDisplayName ||
                    isSavingHandle ||
                    displayName.trim().length < DISPLAY_NAME_MIN ||
                    handle.length < HANDLE_MIN ||
                    handleStatus.state === 'checking' ||
                    handleStatus.state === 'unavailable'
                  }
                >
                  {isSavingDisplayName || isSavingHandle ? 'Saving…' : 'Continue'}
                </button>
              </form>
            </div>
          ) : null}

          {currentStep === 'review' ? (
            <div className="flex flex-1 flex-col gap-7">
              {/* Welcome hero — wordmark eyebrow + editorial serif headline. The
                  explainer frames the screen as remove-or-add when topics were
                  pre-seeded, or add-to-start when the invitee arrived with none. */}
              <div className="space-y-3">
                <p className="font-wordmark text-quiet font-bold tracking-[0.18em] text-[var(--brand-navy)] uppercase">
                  Joshing
                </p>
                <h1 className="font-serif text-4xl leading-tight font-semibold text-balance sm:text-5xl">
                  Welcome to Joshing
                </h1>
                <p className="text-muted-foreground text-base leading-7">
                  {!hasSeeds
                    ? "A new trivia game. Add a few topics you'd want questions about, and we'll build your first round from them."
                    : seedSource === 'link'
                      ? `A new trivia game. Here are a few from ${displayInviterName} — take any that are yours, or add your own.`
                      : "A new trivia game. Here are some topics we picked for you — remove any that don't fit, or add your own."}
                </p>
              </div>

              <div className="space-y-3">
                <p className="font-serif text-2xl leading-tight font-semibold text-balance text-[var(--ink)] sm:text-3xl">
                  Your trivia questions will come from these subjects
                </p>
                {selectedInterests.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    Nothing yet — add a few below.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {selectedInterests.map((interest) => (
                      <li
                        key={selectedKey(interest)}
                        className="flex items-center gap-3"
                      >
                        <span
                          aria-hidden="true"
                          className="text-muted-foreground text-xs"
                        >
                          ▸
                        </span>
                        <span className="text-base font-medium">
                          {interest.domain}
                        </span>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-destructive text-sm font-medium underline transition-colors"
                          onClick={() => removeSelectedInterest(interest)}
                          aria-label={`Remove ${interest.domain}`}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <AddTopicField
                heading="Add your own"
                placeholder="Add anything: a book, musician, team, era, show, place, person, or theory…"
                maxLength={100}
                convergeBeforeAdd
                disabled={selectedInterests.length >= MAX_INTERESTS}
                existingLabels={selectedInterests.map((item) => item.domain)}
                onAdd={addSelectedInterest}
                inputClassName="bg-[var(--brand-field)] placeholder:text-muted-foreground/70 focus:border-[var(--brand-navy)] h-12 min-w-0 flex-1 rounded-full border border-[var(--accent-gold)] px-4 text-base outline-none transition disabled:opacity-60"
                buttonClassName="bg-[var(--brand-navy)] h-12 rounded-full px-5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                chipClassName="rounded-full border border-[var(--border-warm)] bg-[var(--brand-card)] px-3 py-1.5 text-sm transition-colors hover:bg-muted disabled:opacity-50"
                mutedClassName="text-muted-foreground text-sm"
                errorClassName="text-destructive mt-3 text-sm"
              />

              {inviteSuggestions.length > 0 ? (
                <div className="space-y-3">
                  <p className="text-sm font-medium">Suggested for you</p>
                  {renderSuggestionChips(inviteSuggestions, 'suggested')}
                </div>
              ) : null}

              <div className="bg-background/95 sticky bottom-0 border-t py-4 backdrop-blur">
                {error ? (
                  <div className="mb-3">
                    <ErrorPanel message={error} />
                  </div>
                ) : null}
                <p className="text-muted-foreground mb-3 text-sm">
                  {selectionCounterCopy(selectedInterests.length)}
                </p>
                <button
                  type="button"
                  className="btn-primary w-full"
                  onClick={() => saveInterests()}
                  disabled={selectedInterests.length < MIN_INTERESTS || isLoading}
                >
                  {isLoading ? 'Saving…' : startCtaCopy(selectedInterests.length)}
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
