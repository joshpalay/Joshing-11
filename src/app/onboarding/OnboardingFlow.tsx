'use client'

import { useEffect, useState } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { AddTopicField, type AddTopicError } from '@/components/interests/AddTopicField'
import { LoadingBackdrop } from '@/components/LoadingScreen'
import { SmsReminderDisclosure } from '@/components/reminders/SmsReminderDisclosure'
import { safeInviteName } from '@/lib/invite-links'

// Condensed onboarding: name → handle → one interests screen (warm-up is an
// optional expander there; the cultural-anchor/background step was removed).
// Picking areas marks onboarding complete and kicks off question generation.
// A final, optional SMS-reminder choice then closes setup — both answers land
// on /daily, whose own load path shows the crafting screen while the first
// queue finishes generating. Declining stamps reminderInterstitialSeenAt (same
// as opting in), so this is the ONE ask: the daily-summary interstitial never
// repeats it later for an account that made this choice here.
type CurrentStep = 'setup' | 'review' | 'reminders'

export type ProposedInterest = {
  domain: string
  broadCategory: string
  rationale?: string | null
  /**
   * True for a topic the app added to top up a sparse invite (B-INVITE-TOPUP),
   * never one the inviter actually typed. Must never be pre-selected — a named
   * invite's own seeds ARE the inviter's picks and get auto-selected below, but
   * a catalog-guessed addition is exactly the "invent personal meaning" failure
   * mode this product avoids, so it's offered as a suggestion chip like a
   * link-sourced seed, regardless of seedSource.
   */
  fromCatalog?: boolean
}

type SelectedInterest = {
  domain: string
  broadCategory: string
}

export type PreSeededInterest = ProposedInterest

type OnboardingFlowProps = {
  preSeededInterests: PreSeededInterest[]
  /**
   * Where preSeededInterests came from — controls attribution copy.
   * 'named': the inviter chose these topics FOR this specific person
   * (AddFriendInvite) — they arrive pre-selected, as today.
   * 'link': the topics rode a per-user invite link (curated or auto-fallback
   * from the inviter's declared interests) that may reach anyone, not someone
   * the inviter had in mind. Non-catalog topics start selected in both paths;
   * the player can remove them before saving. Catalog additions are unselected.
   */
  seedSource?: 'named' | 'link'
  inviterName?: string | null
  inviteeDisplayName?: string | null
  initialDisplayName?: string | null
  initialHandle?: string | null
  phoneNumber?: string | null
  showReminderOffer?: boolean
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
      normalizeDomain(interest.broadCategory || 'General Knowledge') || 'General Knowledge'
  }
}

function StepHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="space-y-2">
      <h1 className="text-3xl font-semibold tracking-normal text-balance sm:text-4xl">{title}</h1>
      <p className="text-muted-foreground text-base leading-7">{subtitle}</p>
    </div>
  )
}

/**
 * A topic chip in the onboarding topic picker that toggles in place rather
 * than jumping between a separate "suggested" list and a "your topics" list —
 * 'selected' and 'removed' render the same slot the topic already occupies,
 * so nothing reflows when you tap it.
 */
function InterestToggleChip({
  interest,
  state,
  onToggle,
  disabled
}: {
  interest: ProposedInterest
  state: 'selected' | 'removed' | 'available'
  onToggle: () => void
  disabled?: boolean
}) {
  const sourceLabel = interest.fromCatalog ? (
    <span className="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
      From Joshing
    </span>
  ) : null

  if (state === 'selected') {
    return (
      <span className="bg-card inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium">
        {interest.domain}
        {sourceLabel}
        <button
          type="button"
          onClick={onToggle}
          className="text-muted-foreground hover:text-destructive ml-0.5 inline-flex size-5 items-center justify-center rounded-full text-base leading-none"
          aria-label={`Remove ${interest.domain}`}
        >
          ×
        </button>
      </span>
    )
  }

  if (state === 'removed') {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1.5 rounded-full border border-dashed px-3 py-1.5 text-sm">
        <span className="line-through">{interest.domain}</span>
        {sourceLabel}
        <span className="text-[10px] font-semibold tracking-wide uppercase">Removed</span>
        <button
          type="button"
          onClick={onToggle}
          disabled={disabled}
          className="font-semibold text-[var(--brand-navy)] underline disabled:opacity-50"
          aria-label={`Undo removing ${interest.domain}`}
        >
          Undo
        </button>
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      title={disabled ? `${MAX_INTERESTS} max — remove one to add another` : undefined}
      className="bg-card hover:bg-muted inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-45"
    >
      <span aria-hidden="true" className="text-muted-foreground">
        +
      </span>
      {interest.domain}
      {sourceLabel}
    </button>
  )
}

// D-REMINDER-ASK-CRAFTING-01 — the final onboarding beat, once interests are
// saved and the first queue has started generating in the background. Both
// exits land on `/daily`, whose own load path shows the crafting screen while
// generation finishes — so declining costs nothing (same destination, same
// wait) and the SMS button is the consent act itself, matching the pattern
// already published as compliance evidence on /sms-consent for the OTP step.
// No duration is claimed here; the crafting screen that follows proves the
// "written from your topics" claim rather than asserting a wait length.
export function OnboardingReminderStep({
  displayName,
  phoneNumber,
  saving,
  error,
  onContinueWithReminders,
  onContinueWithoutReminders
}: {
  displayName?: string | null
  phoneNumber?: string | null
  saving: boolean
  error: string | null
  onContinueWithReminders: () => void
  onContinueWithoutReminders: () => void
}) {
  const name = displayName?.trim()

  return (
    <div className="flex flex-1 flex-col justify-center gap-8">
      <div className="space-y-3">
        <p className="font-wordmark text-quiet font-bold tracking-[0.18em] text-[var(--brand-navy)] uppercase">
          Joshing
        </p>
        <StepHeader
          title={name ? `${name}, we’re writing your first five.` : 'We’re writing your first five.'}
          subtitle="Made from your topics, not pulled off a shelf. A new five lands every afternoon."
        />
      </div>

      <div className="space-y-4">
        <button
          type="button"
          className="btn-primary h-12 w-full"
          onClick={onContinueWithReminders}
          disabled={saving}
        >
          {saving ? 'Turning on…' : 'Text me when they open'}
        </button>
        <SmsReminderDisclosure phoneNumber={phoneNumber} actionLabel="Text me when they open" />
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          className="btn-ghost h-12 w-full"
          onClick={onContinueWithoutReminders}
          disabled={saving}
        >
          I&rsquo;ll check back on my own
        </button>
      </div>
    </div>
  )
}

export function OnboardingReminderScreen(props: ComponentProps<typeof OnboardingReminderStep>) {
  return (
    <main className="min-h-dvh">
      <LoadingBackdrop className="min-h-dvh px-4 py-8 sm:px-6 sm:py-12">
        <section className="relative z-10 mx-auto w-full max-w-2xl rounded-[var(--radius-md)] bg-[var(--brand-cream-card)] px-6 py-8 shadow-[0_4px_4px_0_rgba(0,0,0,0.25),var(--shadow-card)] ring-1 ring-black/5 sm:px-10 sm:py-10">
          <OnboardingReminderStep {...props} />
        </section>
      </LoadingBackdrop>
    </main>
  )
}

export default function OnboardingFlow({
  preSeededInterests,
  seedSource = 'named',
  inviterName,
  inviteeDisplayName,
  initialDisplayName,
  initialHandle,
  phoneNumber,
  showReminderOffer = true,
  previewMode = false,
  previewNextHref = '/dev/welcome-tour'
}: OnboardingFlowProps) {
  const router = useRouter()
  const hasInitialDisplayName = Boolean(initialDisplayName?.trim())
  const hasInitialHandle = Boolean(initialHandle?.trim())
  const [currentStep, setCurrentStep] = useState<CurrentStep>(() => {
    // Name and username now share one "setup" screen; only skip it when both
    // are already on file.
    if (!hasInitialDisplayName || !hasInitialHandle) return 'setup'
    return 'review'
  })
  const [displayName, setDisplayName] = useState<string>(() =>
    (initialDisplayName ?? inviteeDisplayName ?? '').trim().slice(0, DISPLAY_NAME_MAX)
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
  // The topic-picker's chip list, in a fixed order for the life of this screen:
  // every pre-seeded topic (named or link-sourced alike), then any custom topic
  // the invitee types in, appended as they add it. Toggling a topic on/off never
  // reorders this list — see InterestToggleChip.
  const [slots, setSlots] = useState<ProposedInterest[]>(preSeededInterests)
  // Every real inviter-picked topic (never a catalog top-up — see fromCatalog)
  // starts pre-selected, whether it rode a named invite or a link: the invitee
  // keeps, removes, or adds to it, but doesn't have to tap each one just to
  // accept the defaults.
  const [selectedInterests, setSelectedInterests] = useState<SelectedInterest[]>(() =>
    preSeededInterests
      .filter((interest) => !interest.fromCatalog)
      .flatMap((interest) => {
        const selected = toSelected(interest)
        return selected ? [selected] : []
      })
      .slice(0, MAX_INTERESTS)
  )
  // Keys ever selected this session, so an unchecked topic shows as "Removed …
  // Undo" (it was on) rather than a plain "+" suggestion (it never was).
  const [everSelectedKeys, setEverSelectedKeys] = useState<Set<string>>(
    () => new Set(selectedInterests.map(selectedKey))
  )
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savingReminder, setSavingReminder] = useState(false)
  const [reminderError, setReminderError] = useState<string | null>(null)
  const safeInviterName = safeInviteName(inviterName)
  const displayInviterName = safeInviterName ?? 'A friend'
  // Whether the invitee arrived with any pre-seeded topics. Drives the welcome
  // copy: with seeds we frame the screen as "remove what doesn't fit"; without
  // any (e.g. invite-link signups) we frame it as "add a few to start".
  const hasSeeds = inviteInterests.length > 0
  const hasInviterSeeds = inviteInterests.some((interest) => !interest.fromCatalog)
  const hasCatalogSeeds = inviteInterests.some((interest) => interest.fromCatalog)
  const atSelectionCap = selectedInterests.length >= MAX_INTERESTS

  function slotState(interest: ProposedInterest): 'selected' | 'removed' | 'available' {
    const key = selectedKey(interest)
    if (selectedInterests.some((item) => selectedKey(item) === key)) return 'selected'
    if (everSelectedKeys.has(key)) return 'removed'
    return 'available'
  }

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
      if (candidate.length < HANDLE_MIN || !HANDLE_FORMAT.test(candidate)) {
        return
      }
      try {
        const response = await fetch(`/api/handle/check?handle=${encodeURIComponent(candidate)}`, {
          signal: controller.signal
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) return
        if (data?.available === true) {
          setHandleStatus({ state: 'available' })
        } else if (typeof data?.reason === 'string') {
          setHandleStatus({
            state: 'unavailable',
            reason: data.reason as 'format' | 'reserved' | 'taken'
          })
        }
      } catch (fetchError) {
        if (!(fetchError instanceof DOMException && fetchError.name === 'AbortError')) {
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
    const key = selectedKey(selected)

    setSelectedInterests((current) => {
      const exists = current.some((item) => selectedKey(item) === key)
      if (exists) return current.filter((item) => selectedKey(item) !== key)
      if (current.length >= MAX_INTERESTS) return current
      return [...current, selected]
    })
    setEverSelectedKeys((current) => (current.has(key) ? current : new Set(current).add(key)))
  }

  // Stage a chosen topic (from the add-topic field) into the selected list.
  async function addSelectedInterest(topic: { label: string; broadCategory?: string | null }) {
    const selected = toSelected({
      domain: topic.label,
      broadCategory: topic.broadCategory ?? 'General Knowledge'
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
      body: JSON.stringify({ topic: selected.domain })
    })
    const checkBody = await check.json().catch(() => null)
    if (check.ok && checkBody?.ok === false) {
      if (checkBody.code === 'too_broad') {
        const broad = new Error(checkBody.message) as AddTopicError
        broad.code = 'too_broad'
        throw broad
      }
      throw new Error(checkBody.message ?? 'We could not find real questions for that topic.')
    }

    setError(null)
    const key = selectedKey(selected)
    setSlots((current) =>
      current.some((item) => selectedKey(item) === key) ? current : [...current, selected]
    )
    setSelectedInterests((current) =>
      current.some((item) => selectedKey(item) === key)
        ? current
        : [...current, selected].slice(0, MAX_INTERESTS)
    )
    setEverSelectedKeys((current) => new Set(current).add(key))
  }

  // Name + username now save together from one "setup" screen. Name persists
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
        'Username must be 3–20 characters, start with a letter, and use only lowercase letters, numbers, and underscores.'
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
        body: JSON.stringify({ displayName: trimmedName })
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
        body: JSON.stringify({ handle: candidate })
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
        ? cleanSelected.some((item) => selectedKey(item) === selectedKey(selected))
        : false
    }).length

    if (cleanSelected.length < MIN_INTERESTS) {
      setError(`Pick at least ${MIN_INTERESTS} to continue.`)
      return
    }

    setError(null)

    // Dev harness replay — skip the save + first-round generation and advance
    // through the genuine final reminder choice without mutating the account.
    if (previewMode) {
      if (showReminderOffer) setCurrentStep('reminders')
      else finishOnboarding()
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
            inviteSelectedCount
          }
        })
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
        keepalive: true
      }).catch(() => {})

      // Onboarding is complete and the first queue is warming. Close setup with
      // the optional reminder choice before entering the welcome tour.
      if (showReminderOffer) setCurrentStep('reminders')
      else finishOnboarding()
    } catch {
      setError('Unable to save interests.')
    } finally {
      setIsLoading(false)
    }
  }

  // Both reminder-ask exits land on the same place: `/daily`, whose own load
  // path shows the crafting screen (LoadingScreen) while the first queue
  // finishes generating (D-REMINDER-ASK-CRAFTING-01). Declining a reminder
  // costs nothing — same destination, same wait — which is what keeps the
  // consent genuinely optional rather than a toll on getting into the app.
  // `optedIntoReminders` rides a one-time `remindersOn` query param so the
  // crafting screen can confirm the opt-in; /daily strips it after reading it.
  function finishOnboarding(optedIntoReminders = false) {
    const dest = previewMode ? previewNextHref : '/daily'
    if (!optedIntoReminders) {
      router.push(dest)
      return
    }
    const [path, existingQuery] = dest.split('?')
    const params = new URLSearchParams(existingQuery)
    params.set('remindersOn', '1')
    router.push(`${path}?${params.toString()}`)
  }

  // "I'll check back on my own" — the one write this ask must make on decline.
  // Stamping reminderInterstitialSeenAt here is what keeps this a single ask:
  // without it, deriveReminderAcquisitionState stays 'eligible' and the daily
  // summary's full-screen interstitial fires again a day later for the same
  // decision already made. Best-effort and never blocks navigation — a lost
  // write just means Settings remains the fallback place to opt in.
  function declineReminders() {
    finishOnboarding()
    if (previewMode) return
    void fetch('/api/account/reminders', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interstitialSeen: true })
    }).catch(() => {})
  }

  async function continueWithSmsReminders() {
    setReminderError(null)

    if (previewMode) {
      finishOnboarding(true)
      return
    }

    setSavingReminder(true)
    try {
      // Record consent first. The reminders route sends the required opt-in
      // confirmation and keeps SMS off if delivery fails.
      const response = await fetch('/api/account/reminders', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          smsOptIn: 'opted_in',
          smsConsentSource: 'onboarding_web_form'
        })
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok || !data?.state) {
        setReminderError(
          typeof data?.message === 'string'
            ? data.message
            : "We couldn't turn on reminders. Try again or continue without them."
        )
        return
      }

      // The server stamps the shared acquisition state only after the required
      // confirmation text succeeds, so a failed send never consumes this ask.
      finishOnboarding(true)
    } catch {
      setReminderError("We couldn't turn on reminders. Try again or continue without them.")
    } finally {
      setSavingReminder(false)
    }
  }

  // One stable-position picker: the heading, an optional attribution line,
  // then every topic as a toggle chip — selecting or removing one never moves
  // it or reflows the list (see InterestToggleChip).
  const topicPicker = (
    <div className="space-y-3">
      <p className="font-serif text-2xl leading-tight font-semibold text-balance text-[var(--ink)] sm:text-3xl">
        Your trivia questions will come from these subjects
      </p>
      {hasSeeds ? (
        <p className="text-muted-foreground text-sm leading-6">
          {hasInviterSeeds && seedSource === 'link'
            ? `These starting topics come from ${displayInviterName}’s invitation. Keep what fits, remove what doesn’t, or add your own.${hasCatalogSeeds ? ' Extra ideas from Joshing are labeled.' : ''}`
            : hasInviterSeeds && hasCatalogSeeds
            ? `${displayInviterName} picked the preselected topics. Extra ideas from Joshing are labeled.`
            : hasInviterSeeds
              ? `${displayInviterName} picked these for you. Take any that feel right, or remove what doesn't fit.`
              : 'Joshing added these starting ideas. Pick any that feel right.'}
        </p>
      ) : null}
      {slots.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {slots.map((interest) => {
            const state = slotState(interest)
            return (
              <InterestToggleChip
                key={interest.domain}
                interest={interest}
                state={state}
                onToggle={() => toggleInterest(interest)}
                disabled={state !== 'selected' && atSelectionCap}
              />
            )
          })}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">Nothing yet — add a few below.</p>
      )}
    </div>
  )

  if (currentStep === 'reminders') {
    return (
      <OnboardingReminderScreen
        displayName={displayName}
        phoneNumber={phoneNumber}
        saving={savingReminder}
        error={reminderError}
        onContinueWithReminders={() => void continueWithSmsReminders()}
        onContinueWithoutReminders={declineReminders}
      />
    )
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
                    ? `${displayInviterName} added you as "${inviteeDisplayName.trim()}". Set your name and username — friends use your @ to find you.`
                    : 'Pick the name friends see and your username — your @ on Joshing.'}
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
                    className="placeholder:text-muted-foreground/70 mt-2 h-12 w-full rounded-md border border-[var(--accent-gold)] bg-[var(--brand-field)] px-3 text-base transition outline-none focus:border-[var(--brand-navy)]"
                    placeholder="Your name"
                    autoFocus
                    autoComplete="name"
                    maxLength={DISPLAY_NAME_MAX}
                    value={displayName}
                    onChange={(e) => {
                      const next = e.target.value.slice(0, DISPLAY_NAME_MAX)
                      setDisplayName(next)
                      if (displayNameError) setDisplayNameError(null)
                      // Seed the username from the name until the user edits it.
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
                  <span className="text-sm font-medium">Your username</span>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-muted-foreground text-base">@</span>
                    <input
                      type="text"
                      className="placeholder:text-muted-foreground/70 h-12 w-full rounded-md border border-[var(--accent-gold)] bg-[var(--brand-field)] px-3 text-base transition outline-none focus:border-[var(--brand-navy)]"
                      placeholder="yourusername"
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
                            .slice(0, HANDLE_MAX)
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
                              ? 'That username is already taken.'
                              : handleStatus.reason === 'reserved'
                                ? 'That username is reserved.'
                                : 'Use only lowercase letters, numbers, and underscores. Start with a letter.'
                            : null}
                    </p>
                  ) : null}
                  {handleError ? (
                    <p className="text-destructive mt-2 text-sm">{handleError}</p>
                  ) : null}
                </label>

                <p className="text-muted-foreground text-xs leading-5">
                  {`${DISPLAY_NAME_MIN}–${DISPLAY_NAME_MAX} characters for your name. Username is ${HANDLE_MIN}–${HANDLE_MAX} characters — lowercase letters, numbers, and underscores, starting with a letter.`}
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
                    ? "A trivia game built for you. Add a few topics you'd want questions about, and we'll build your first round from them."
                    : seedSource === 'link'
                      ? `A trivia game built for you. Here are a few from ${displayInviterName} — take any that are yours, or add your own.`
                      : "A trivia game built for you. Here are some topics we picked for you — remove any that don't fit, or add your own."}
                </p>
              </div>

              {topicPicker}

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

function ErrorPanel({ message, actions }: { message: string; actions?: ReactNode }) {
  return (
    <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-4 text-sm">
      <p>{message}</p>
      {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  )
}
