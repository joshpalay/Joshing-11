'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { clearCachedLoadingMomentPayload } from '@/components/loading-moment/client-cache';
import { formatUsPhoneInput } from '@/lib/phone-e164';

const US_E164_REGEX = /^\+1\d{10}$/;
const HANDLE_MIN = 3;
const HANDLE_MAX = 20;
const HANDLE_FORMAT = /^[a-z][a-z0-9_]{2,19}$/;

/** Format a stored E.164 US number as (734)-277-6819 for display. */
function formatPhoneForDisplay(e164: string): string {
  const digits = e164.replace(/\D/g, '').replace(/^1/, '');
  if (digits.length !== 10) return e164;
  return `(${digits.slice(0, 3)})-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

const CARD_CLASS =
  'w-full max-w-sm rounded-[var(--radius-md)] bg-[var(--brand-cream-card)] px-12 py-8 shadow-[0_4px_4px_0_rgba(0,0,0,0.25),var(--shadow-card)] ring-1 ring-black/5';
const INPUT_CLASS =
  'h-11 w-full rounded-[var(--radius-xs)] border border-[var(--accent-gold)] bg-white px-3 text-center text-base tracking-wide text-[var(--brand-navy)] outline-none transition-colors focus:border-[var(--brand-navy)]';
const SUBMIT_CLASS =
  'h-11 w-full rounded-[var(--radius-xs)] bg-[var(--btn-primary-bg)] px-4 text-base font-bold tracking-[0.04em] text-white transition hover:opacity-90 disabled:opacity-60';
// Quiet secondary action (e.g. "this number is not correct" / "go back"): a
// muted, sentence-case text link. Deliberately understated so it doesn't
// compete with the primary button or flood the card with orange caps.
const SUBTLE_LINK_CLASS =
  'mx-auto block text-sm leading-5 text-black/55 underline underline-offset-4 transition-colors hover:text-black/80 disabled:opacity-60';

function sendTelemetry(event: string) {
  void fetch('/api/telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ event }),
    keepalive: true,
  }).catch(() => undefined);
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return phone.startsWith('+') ? phone : `+${digits}`;
}

function sanitizeForSuggestedHandle(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, HANDLE_MAX);
}

export function readInvitationToken(searchParams: URLSearchParams) {
  return (
    searchParams.get('invitationToken') ?? searchParams.get('invite') ?? searchParams.get('token')
  );
}

export function readUserInvite(searchParams: URLSearchParams) {
  const handle = searchParams.get('inviteHandle');
  const token = searchParams.get('inviteUserToken');
  return handle && token ? { handle, token } : null;
}

export function buildVerifyOtpRequestBody(
  phone: string,
  code: string,
  searchParams: URLSearchParams,
) {
  return {
    phone,
    code,
    invitationToken: readInvitationToken(searchParams),
    userInvite: readUserInvite(searchParams),
  };
}

type InviteContext = {
  inviterName: string;
  inviterUserId: string;
  inviterAvatarColor: string | null;
  // Per-user invite-link topics only (up to 3), already filtered to what a
  // not-yet-friend visitor may see (resolveInviteLink). Absent/empty for the
  // named FriendInvitation path, which has its own separate seeded-interests
  // flow inside onboarding rather than a pre-login preview.
  topics?: string[];
};

// Phone-first invite path: the full invited number crosses to the client so
// the phone field arrives pre-filled for confirmation (D-AUTH-INVITE-PHONE-FIRST
// §2.3). It is the invitee's own number, gated by a valid invitation token.
type InvitePrefill = InviteContext & { inviteePhone: string };

type LoginPanelProps = {
  invitePrefill?: InvitePrefill | null;
  inviteContext?: InviteContext | null;
  // Dev-preview only (`/dev/invite-login`): seed the warm dead-end (Screen 1b)
  // so it can be inspected without a real failed gate round-trip. Never passed
  // by the production login page.
  previewDeadEnd?: boolean;
  // Dev-preview only: render a later sign-up state without sending an OTP.
  previewStep?: Step;
};

type Step = 'phone' | 'code' | 'profile';

type VerifiedIdentity = {
  displayName: string;
  handle: string;
};

type HandleStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available' }
  | { state: 'unavailable'; reason: 'format' | 'reserved' | 'taken' };

type DisplayNameDuplicateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'unique' }
  | { state: 'duplicate'; count: number };

type VerifyOtpUserPayload = {
  display_name?: unknown;
  displayName?: unknown;
  handle?: unknown;
};

function identityValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function readVerifiedIdentity(data: unknown): VerifiedIdentity {
  const user =
    data && typeof data === 'object' && 'user' in data
      ? (data as { user?: VerifyOtpUserPayload }).user
      : null;

  if (!user || typeof user !== 'object') return { displayName: '', handle: '' };

  return {
    displayName: identityValue(user.display_name ?? user.displayName),
    handle: identityValue(user.handle),
  };
}

export function shouldCollectProfileIdentity(identity: VerifiedIdentity): boolean {
  return !identity.displayName || !identity.handle;
}

function inviterFirstName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'A friend';
  // Handle-style names (e.g. "@craig") have no spaces — keep them whole.
  return trimmed.split(/\s+/)[0];
}

// In-flight label for a pressed primary button: the verb stays put while the
// trailing "…" is split into three dots that pulse on the shared loading-dot
// keyframe (see .loading-ellipsis-dot in globals.css), so the wait reads as
// alive rather than a frozen static ellipsis. The dots are aria-hidden and the
// verb itself carries the meaning for screen readers.
function LoadingLabel({ verb }: { verb: string }) {
  return (
    <span className="inline-flex items-baseline">
      {verb}
      <span aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className="loading-ellipsis-dot" style={{ animationDelay: `${i * 0.16}s` }}>
            .
          </span>
        ))}
      </span>
    </span>
  );
}

function InviteContextCard({ invite }: { invite: InviteContext }) {
  const topics = invite.topics?.filter((topic) => topic.trim().length > 0) ?? [];
  return (
    <div className="space-y-3 rounded-[var(--radius-md)] border border-[var(--accent-gold)]/40 bg-white/55 p-4 text-center">
      <p className="text-[15px] leading-6 text-black/75">
        {inviterFirstName(invite.inviterName)} invited you to Joshing, a new trivia game. We just
        need to verify your phone number and then you can start playing.
      </p>
      {topics.length > 0 ? (
        <div className="flex flex-wrap justify-center gap-2">
          {topics.map((topic) => (
            <span
              key={topic}
              className="rounded-full border border-[var(--accent-gold)]/40 bg-white/70 px-3 py-1 text-xs font-medium text-black/70"
            >
              {topic}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function OtpRequestDisclosure() {
  return (
    <p className="mt-2 text-center text-xs leading-5 text-black/60">
      By selecting Continue, you agree to receive one automated Joshing verification text at this
      number. Message and data rates may apply. Reply <strong>STOP</strong> to unsubscribe or{' '}
      <strong>HELP</strong> for help. Consent is not a condition of purchase.{' '}
      <Link href="/terms" className="underline underline-offset-2">
        Terms
      </Link>{' '}
      and{' '}
      <Link href="/privacy" className="underline underline-offset-2">
        Privacy
      </Link>
      .
    </p>
  );
}

export default function LoginPanel({
  invitePrefill = null,
  inviteContext = null,
  previewDeadEnd = false,
  previewStep = 'phone',
}: LoginPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const invitationToken = readInvitationToken(searchParams);
  const userInvite = readUserInvite(searchParams);

  // Phone-first invite path: pre-fill the confirm-only field with the full
  // invited number so the invitee can verify it before continuing
  // (D-AUTH-INVITE-PHONE-FIRST §2.2). Empty on the cold / per-user-link paths.
  const [phone, setPhone] = useState(() =>
    invitePrefill?.inviteePhone
      ? formatUsPhoneInput(invitePrefill.inviteePhone)
      : previewStep === 'code'
        ? formatUsPhoneInput('+12025550147')
        : '',
  );
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [handleManuallyEdited, setHandleManuallyEdited] = useState(false);
  const [handleStatus, setHandleStatus] = useState<HandleStatus>({ state: 'idle' });
  const [displayNameDuplicateStatus, setDisplayNameDuplicateStatus] =
    useState<DisplayNameDuplicateStatus>({ state: 'idle' });
  const [verifiedIdentity, setVerifiedIdentity] = useState<VerifiedIdentity>({
    displayName: '',
    handle: '',
  });
  // The invite arrival is now phone-first: it collapses into the `phone` step
  // with the field pre-filled, rather than a separate masked confirmation card
  // (D-AUTH-INVITE-PHONE-FIRST §4b / §6.1).
  const [step, setStep] = useState<Step>(previewStep);
  // Inline warm dead-end (Screen 1b): set when the invitee says the invited
  // number isn't theirs. The number is confirm-only (not editable), so the way
  // out is a fresh invite from the inviter — carried by wording, not an error
  // banner (D-AUTH-INVITE-PHONE-FIRST §2.6).
  const [inviteDeadEnd, setInviteDeadEnd] = useState(previewDeadEnd);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Controls the bottom-card transition: the title card (in page.tsx) stays
  // fixed; only this form card animates out, swaps content, then animates in.
  const [entering, setEntering] = useState(true);

  useEffect(() => {
    if (step !== 'profile') return;

    const candidate = displayName.trim();
    const controller = new AbortController();

    const immediate = window.setTimeout(() => {
      if (candidate.length < 1 || candidate.length > 60) {
        setDisplayNameDuplicateStatus({ state: 'idle' });
        return;
      }
      setDisplayNameDuplicateStatus({ state: 'checking' });
    }, 0);

    const debounced = window.setTimeout(async () => {
      if (candidate.length < 1 || candidate.length > 60) return;

      try {
        const response = await fetch(
          `/api/account/display-name/check?displayName=${encodeURIComponent(candidate)}`,
          {
            credentials: 'include',
            signal: controller.signal,
          },
        );
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          setDisplayNameDuplicateStatus({ state: 'idle' });
          return;
        }

        if (data?.duplicate === true) {
          setDisplayNameDuplicateStatus({
            state: 'duplicate',
            count: typeof data?.count === 'number' ? data.count : 1,
          });
        } else {
          setDisplayNameDuplicateStatus({ state: 'unique' });
        }
      } catch (fetchError) {
        if (!(fetchError instanceof DOMException && fetchError.name === 'AbortError')) {
          setDisplayNameDuplicateStatus({ state: 'idle' });
        }
      }
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(immediate);
      window.clearTimeout(debounced);
    };
  }, [displayName, step]);

  useEffect(() => {
    if (step !== 'profile') return;

    const candidate = handle.trim().replace(/^@+/, '').toLowerCase();
    const currentHandle = verifiedIdentity.handle.toLowerCase();
    const controller = new AbortController();

    const immediate = window.setTimeout(() => {
      if (candidate.length < HANDLE_MIN) {
        setHandleStatus({ state: 'idle' });
        return;
      }
      if (!HANDLE_FORMAT.test(candidate)) {
        setHandleStatus({ state: 'unavailable', reason: 'format' });
        return;
      }
      if (candidate === currentHandle) {
        setHandleStatus({ state: 'available' });
        return;
      }
      setHandleStatus({ state: 'checking' });
    }, 0);

    const debounced = window.setTimeout(async () => {
      if (
        candidate.length < HANDLE_MIN ||
        !HANDLE_FORMAT.test(candidate) ||
        candidate === currentHandle
      ) {
        return;
      }

      try {
        const response = await fetch(`/api/handle/check?handle=${encodeURIComponent(candidate)}`, {
          signal: controller.signal,
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) return;
        if (data?.available === true) {
          setHandleStatus({ state: 'available' });
        } else if (typeof data?.reason === 'string') {
          setHandleStatus({
            state: 'unavailable',
            reason: data.reason as 'format' | 'reserved' | 'taken',
          });
        }
      } catch (fetchError) {
        if (!(fetchError instanceof DOMException && fetchError.name === 'AbortError')) {
          setHandleStatus({ state: 'idle' });
        }
      }
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(immediate);
      window.clearTimeout(debounced);
    };
  }, [handle, step, verifiedIdentity.handle]);

  const swapStep = useCallback((next: Step, nextError: string | null = null) => {
    // Return to the top so the title card is back in view after the button
    // press — on mobile the focused input scrolls the page down, and landing
    // mid-page on the next step looks unpolished. Blur first so the keyboard
    // closes and the browser stops anchoring the viewport to the focused field,
    // which otherwise fights the scroll-to-top and leaves the page mid-screen.
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setEntering(false); // exit: fade + slide down
    window.setTimeout(() => {
      setStep(next); // swap content while hidden
      // Clear by default; callers can carry an explanatory error onto the next
      // step (e.g. the invite→manual fallback) since this overwrites it.
      setError(nextError);
      requestAnimationFrame(() => setEntering(true)); // enter: fade + slide in
    }, 200);
  }, []);

  function updateDisplayName(nextDisplayName: string) {
    setDisplayName(nextDisplayName);

    if (!handleManuallyEdited) {
      const suggested = sanitizeForSuggestedHandle(nextDisplayName);
      setHandle(suggested.length >= HANDLE_MIN ? suggested : '');
    }
  }

  // Single OTP-request path for every entry (cold, per-user-link, and the
  // phone-first invite). The submitted phone is authoritative for the gate;
  // the invitation token rides along as the credential, re-validated against
  // that phone server-side (D-AUTH-INVITE-PHONE-FIRST §4 default stance).
  async function requestCodeForPhone(normalized: string) {
    setError(null);
    setInviteDeadEnd(false);

    if (!US_E164_REGEX.test(normalized)) {
      setError('Use a US phone number.');
      return;
    }

    if (invitationToken || userInvite) sendTelemetry('friend_invite_auth_started');

    setLoading(true);
    try {
      const response = await fetch('/api/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Forward the invitation token (so the server can return the warm
        // dead-end signal for an edited no-claim number) and the per-user
        // invite link (so request-otp can satisfy the gate for a brand-new
        // phone that arrived via /u/<handle>/<token>).
        body: JSON.stringify({ phone: normalized, invitationToken, userInvite }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        // Invite path + edited number with no claim of its own: render the
        // warm dead-end (Screen 1b) instead of a generic error
        // (D-AUTH-INVITE-PHONE-FIRST §1b / §6.4).
        if (data?.error === 'invite_phone_unclaimed' && invitePrefill?.inviteePhone) {
          setPhone(formatUsPhoneInput(normalized));
          setInviteDeadEnd(true);
          return;
        }
        setError(data?.message ?? 'Unable to continue.');
        return;
      }

      setPhone(normalized);
      swapStep('code');
    } finally {
      setLoading(false);
    }
  }

  async function continueWithPhone(event: FormEvent) {
    event.preventDefault();
    await requestCodeForPhone(normalizePhone(phone.trim()));
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const trimmedCode = code.trim();
    if (!/^\d{6}$/.test(trimmedCode)) {
      setError('Enter the 6-digit code.');
      return;
    }

    setLoading(true);
    try {
      // The field is always pre-filled or typed, so we always have a real
      // submitted phone — no separate no-phone invite payload is needed. The
      // server re-validates the token against this phone
      // (D-AUTH-INVITE-PHONE-FIRST §4).
      const body = buildVerifyOtpRequestBody(phone, trimmedCode, searchParams);
      const response = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data?.message ?? 'Code invalid or expired.');
        setLoading(false);
        return;
      }

      // A new session is now established for this tab. Drop any Loading Moment
      // payload cached by a previous user so it can never leak across accounts
      // (the loading screen reads the cache without knowing the current user).
      clearCachedLoadingMomentPayload();

      const identity = readVerifiedIdentity(data);
      setVerifiedIdentity(identity);
      setDisplayName(identity.displayName);
      setHandle(identity.handle);
      setHandleManuallyEdited(Boolean(identity.handle));
      setHandleStatus({ state: 'idle' });
      setDisplayNameDuplicateStatus({ state: 'idle' });

      if (shouldCollectProfileIdentity(identity)) {
        setLoading(false);
        swapStep('profile');
        return;
      }

      // Success: navigation is async and doesn't block, so keep the button in
      // its "Verifying…" state. Resetting loading here would flash "Continue"
      // before the redirect lands.
      window.scrollTo({ top: 0, behavior: 'smooth' });
      router.replace('/');
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  async function completeProfile(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const trimmedDisplayName = displayName.trim();
    const trimmedHandle = handle.trim().replace(/^@+/, '').toLowerCase();
    const currentHandle = verifiedIdentity.handle.toLowerCase();

    if (!trimmedDisplayName) {
      setError('Enter your display name.');
      return;
    }

    if (trimmedDisplayName.length > 60) {
      setError('Display name must be 60 characters or fewer.');
      return;
    }

    if (displayNameDuplicateStatus.state === 'checking') {
      setError('Please wait while we check that display name.');
      return;
    }

    if (displayNameDuplicateStatus.state === 'duplicate') {
      setError('Choose a display name that is not already taken.');
      return;
    }

    if (!trimmedHandle) {
      setError('Enter your call sign.');
      return;
    }

    if (!HANDLE_FORMAT.test(trimmedHandle)) {
      setError('Use 3–20 lowercase letters, numbers, or underscores. Start with a letter.');
      return;
    }

    if (handleStatus.state === 'checking') {
      setError('Please wait while we check that call sign.');
      return;
    }

    if (handleStatus.state === 'unavailable') {
      setError('Choose an available call sign.');
      return;
    }

    if (trimmedHandle !== currentHandle && handleStatus.state !== 'available') {
      setError('Please wait until we confirm that call sign is available.');
      return;
    }

    setLoading(true);
    try {
      const profileResponse = await fetch('/api/account/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ displayName: trimmedDisplayName }),
      });
      const profileData = await profileResponse.json().catch(() => ({}));

      if (!profileResponse.ok) {
        setError(profileData?.message ?? 'Unable to save your display name.');
        setLoading(false);
        return;
      }

      if (trimmedHandle !== currentHandle) {
        const handleResponse = await fetch('/api/account/handle', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ handle: trimmedHandle }),
        });
        const handleData = await handleResponse.json().catch(() => ({}));

        if (!handleResponse.ok) {
          setError(handleData?.message ?? 'Unable to save your call sign.');
          setLoading(false);
          return;
        }
      }

      window.scrollTo({ top: 0, behavior: 'smooth' });
      router.replace('/');
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  return (
    <section
      className={CARD_CLASS}
      style={{
        opacity: entering ? 1 : 0,
        transform: entering ? 'translateY(0)' : 'translateY(10px)',
        transition: 'opacity 200ms ease, transform 200ms ease',
      }}
    >
      {step === 'phone' ? (
        <form className="space-y-3.5" onSubmit={continueWithPhone}>
          {/* Phone artwork for the entry step (uploaded asset). */}
          <Image
            src="/images/phone-transparent.png"
            alt=""
            aria-hidden
            width={230}
            height={305}
            priority
            className="mx-auto h-16 w-auto"
          />
          {/* Suppress the generic context card on the confirm view — that view
              carries its own inviter line + number. */}
          {inviteContext && !(invitePrefill && !inviteDeadEnd) ? (
            <InviteContextCard invite={inviteContext} />
          ) : null}

          {invitePrefill && !inviteDeadEnd ? (
            // Confirm view: the inviter already supplied the number, so show it
            // as a value (not a fake input) and offer one-tap send. The number
            // is not editable — a phone-bound invite belongs to one person, so
            // "this isn't my number" leads to a fresh invite, not a re-type
            // (D-AUTH-INVITE-PHONE-FIRST §2.2 / §2.4).
            <>
              <div className="space-y-2 rounded-[var(--radius-md)] border border-[var(--accent-gold)]/40 bg-white/55 p-4 text-center">
                <p className="text-[15px] leading-6 text-black/75">
                  {inviterFirstName(invitePrefill.inviterName)} invited you to Joshing, a new trivia
                  game. We just need to send a text to confirm it’s you:
                </p>
                <p className="text-[20px] leading-7 font-semibold tracking-wide text-[var(--brand-navy)]">
                  {formatUsPhoneInput(invitePrefill.inviteePhone)}
                </p>
              </div>
              <div>
                <button type="submit" className={SUBMIT_CLASS} disabled={loading}>
                  {loading ? 'Sending…' : 'Send text'}
                </button>
                <OtpRequestDisclosure />

                {/* Divider sets the secondary action apart from the primary:
                    small, muted "or" with more room below it than above. */}
                <div className="mt-4 flex items-center gap-3" aria-hidden="true">
                  <span className="h-px flex-1 bg-[var(--brand-navy)]/15" />
                  <span className="text-xs font-medium text-black/45">or</span>
                  <span className="h-px flex-1 bg-[var(--brand-navy)]/15" />
                </div>

                <button
                  type="button"
                  className={`mt-6 ${SUBTLE_LINK_CLASS}`}
                  onClick={() => {
                    setError(null);
                    setInviteDeadEnd(true);
                  }}
                  disabled={loading}
                >
                  That isn’t my number
                </button>
              </div>
            </>
          ) : invitePrefill && inviteDeadEnd ? (
            // Warm dead-end (Screen 1b): the invitee says the number isn't
            // theirs. The invite is phone-bound, so the only way forward is a
            // fresh invite from the inviter — carried by wording, not an error
            // banner (D-AUTH-INVITE-PHONE-FIRST §2.6 / §2.7).
            <div className="space-y-3 rounded-[var(--radius-md)] border border-[var(--accent-gold)]/40 bg-white/55 p-4 text-center">
              <p className="text-[15px] leading-6 text-black/75">
                This invite was sent to{' '}
                <span className="font-medium whitespace-nowrap text-black">
                  {formatUsPhoneInput(invitePrefill.inviteePhone)}
                </span>
                . If that isn’t your number, ask {inviterFirstName(invitePrefill.inviterName)} to
                send you a new invite.
              </p>
              <button
                type="button"
                className={SUBTLE_LINK_CLASS}
                onClick={() => setInviteDeadEnd(false)}
                disabled={loading}
              >
                Go back
              </button>
            </div>
          ) : (
            // Editable entry: cold-visit / per-user-link paths only.
            <>
              <label
                className="block text-center text-[17px] leading-[26px] font-medium tracking-[1.7px] text-black"
                htmlFor="phone"
              >
                What is your phone number?
              </label>
              <input
                id="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                className={INPUT_CLASS}
                placeholder="(555) 123-4567"
                maxLength={14}
                value={phone}
                onChange={(event) => setPhone(formatUsPhoneInput(event.target.value))}
                disabled={loading}
              />
              <button type="submit" className={SUBMIT_CLASS} disabled={loading}>
                {loading ? <LoadingLabel verb="Continuing" /> : 'Continue'}
              </button>
              <OtpRequestDisclosure />
            </>
          )}
        </form>
      ) : step === 'code' ? (
        <form className="space-y-3.5" onSubmit={verifyCode}>
          {/* Two overlapping oval speech bubbles — navy behind, orange in front
              — recreating the Figma two-tone mark. The front bubble is drawn
              twice: first as a slightly larger cream copy (the page background
              color) so a crescent of background shows where it overlaps the
              navy, then as the orange bubble on top. */}
          <svg className="mx-auto h-14 w-auto" viewBox="-3 -3 54 44" aria-hidden="true">
            <g fill="var(--brand-navy)">
              <ellipse cx="15" cy="15" rx="15" ry="12" />
              <path d="M3 22 L11 26.5 L1 31 Z" />
            </g>
            {/* cream halo — background color showing through the overlap */}
            <g
              fill="var(--brand-cream-card)"
              transform="translate(32 23) scale(1.14) translate(-32 -23)"
            >
              <ellipse cx="32" cy="23" rx="15" ry="12" />
              <path d="M44 30 L36 34.5 L46.5 39 Z" />
            </g>
            <g fill="var(--brand-orange)">
              <ellipse cx="32" cy="23" rx="15" ry="12" />
              <path d="M44 30 L36 34.5 L46.5 39 Z" />
            </g>
          </svg>
          <label
            className="block text-center text-[17px] leading-[26px] font-medium tracking-[1.7px] text-black"
            htmlFor="code"
          >
            Enter your code for{' '}
            <span className="whitespace-nowrap">{formatPhoneForDisplay(phone)}</span>
          </label>
          <input
            id="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            className={INPUT_CLASS}
            placeholder="000000"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            disabled={loading}
          />

          {/* Button + divider + Change number form a tight 6px cluster (Figma
              Frame 3), separate from the 14px rhythm of the fields above. */}
          <div className="space-y-1.5">
            <button type="submit" className={SUBMIT_CLASS} disabled={loading}>
              {loading ? <LoadingLabel verb="Verifying" /> : 'Continue'}
            </button>

            <div className="flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-[var(--brand-navy)]/15" />
              <span className="text-[17px] font-medium text-black">or</span>
              <span className="h-px flex-1 bg-[var(--brand-navy)]/15" />
            </div>

            <button
              type="button"
              className={SUBTLE_LINK_CLASS}
              onClick={() => {
                setCode('');
                swapStep('phone');
              }}
              disabled={loading}
            >
              Change number
            </button>
          </div>
        </form>
      ) : (
        <form className="space-y-3.5" onSubmit={completeProfile}>
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--brand-navy)] text-2xl font-bold text-white">
            @
          </div>
          <p className="block text-center text-[17px] leading-[26px] font-medium tracking-[1.7px] text-black">
            Finish your profile
          </p>
          <p className="text-center text-[15px] leading-6 text-black/70">
            Pick the name friends will see and the call sign they can use to find you.
          </p>
          <div className="space-y-2">
            <label
              className="block text-center text-sm font-medium text-black"
              htmlFor="display-name"
            >
              Display name
            </label>
            <input
              id="display-name"
              type="text"
              autoComplete="name"
              className={INPUT_CLASS}
              placeholder="Jane Palay"
              value={displayName}
              onChange={(event) => updateDisplayName(event.target.value)}
              disabled={loading}
              maxLength={60}
            />
            {displayNameDuplicateStatus.state === 'duplicate' ? (
              <p className="rounded-md border border-[color-mix(in_srgb,var(--accent-gold)_45%,var(--brand-rule))] bg-[color-mix(in_srgb,var(--accent-gold)_12%,var(--brand-card))] px-3 py-2 text-center text-sm leading-5 text-[var(--brand-ink)]">
                That display name is already taken. Choose a distinctive name so friends can find
                the right account.
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="block text-center text-sm font-medium text-black" htmlFor="handle">
              Call sign / handle
            </label>
            <input
              id="handle"
              type="text"
              autoComplete="username"
              className={INPUT_CLASS}
              placeholder="jpalay"
              value={handle}
              onChange={(event) => {
                setHandleManuallyEdited(true);
                setHandle(sanitizeForSuggestedHandle(event.target.value.replace(/^@+/, '')));
              }}
              disabled={loading}
              maxLength={HANDLE_MAX}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <p
              className={`text-center text-sm ${
                handleStatus.state === 'available'
                  ? 'text-emerald-600'
                  : handleStatus.state === 'unavailable'
                    ? 'text-destructive'
                    : 'text-black/60'
              }`}
            >
              {handle.length < HANDLE_MIN
                ? 'Use 3–20 characters: lowercase letters, numbers, or underscores. Start with a letter.'
                : handleStatus.state === 'checking'
                  ? 'Checking call sign…'
                  : handleStatus.state === 'available'
                    ? `@${handle} is available.`
                    : handleStatus.state === 'unavailable'
                      ? handleStatus.reason === 'taken'
                        ? 'That call sign is already taken.'
                        : handleStatus.reason === 'reserved'
                          ? 'That call sign is reserved.'
                          : 'Use 3–20 lowercase letters, numbers, or underscores. Start with a letter.'
                      : 'We’ll check whether this call sign is available.'}
            </p>
          </div>
          <button
            type="submit"
            className={SUBMIT_CLASS}
            disabled={
              loading ||
              displayNameDuplicateStatus.state === 'checking' ||
              displayNameDuplicateStatus.state === 'duplicate' ||
              handleStatus.state === 'checking' ||
              handleStatus.state === 'unavailable'
            }
          >
            {loading ? 'Saving…' : 'Enter Joshing'}
          </button>
        </form>
      )}

      {error ? (
        <p className="border-destructive/30 bg-destructive/10 text-destructive mt-4 rounded-md border px-3 py-2 text-center text-sm">
          {error}
        </p>
      ) : null}

      {step !== 'profile' ? (
        <p className="mt-4 text-center text-xs leading-5 text-black/60">
          By signing in you agree to our
          <br />
          <a
            href="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[var(--brand-orange)] underline underline-offset-2"
          >
            Terms &amp; Conditions
          </a>
          .
        </p>
      ) : null}
    </section>
  );
}
