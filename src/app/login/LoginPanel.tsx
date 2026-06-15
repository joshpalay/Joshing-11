'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { AvatarChip } from '@/components/AvatarChip';
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
  'w-full max-w-sm rounded-[8px] bg-[var(--brand-cream-card)] px-12 py-8 shadow-[0_4px_4px_0_rgba(0,0,0,0.25),0_4px_12px_0_rgba(40,32,30,0.04)] ring-1 ring-black/5';
const INPUT_CLASS =
  'h-11 w-full rounded-[var(--radius-xs)] border border-[var(--accent-gold)] bg-white px-3 text-center text-base tracking-wide text-[var(--brand-navy)] outline-none transition-colors focus:border-[var(--brand-navy)]';
const SUBMIT_CLASS =
  'h-11 w-full rounded-[var(--radius-xs)] bg-[var(--btn-primary-bg)] px-4 text-base font-bold tracking-[0.04em] text-white transition hover:opacity-90 disabled:opacity-60';

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

/**
 * Verify-OTP payload for the invite-prefill flow: no phone is sent — the
 * server resolves the recipient phone from the invitation token. `userInvite`
 * is forwarded so a per-user invite link is still honored if present.
 */
export function buildInviteVerifyOtpRequestBody(
  code: string,
  invitationToken: string,
  searchParams: URLSearchParams,
) {
  return {
    code,
    invitationToken,
    useInvitePhone: true,
    userInvite: readUserInvite(searchParams),
  };
}

type InviteContext = {
  inviterName: string;
  inviterUserId: string;
  inviterAvatarColor: string | null;
};

type InvitePrefill = InviteContext & { maskedPhone: string };

type LoginPanelProps = {
  invitePrefill?: InvitePrefill | null;
  inviteContext?: InviteContext | null;
};

type Step = 'invite' | 'phone' | 'code' | 'profile';

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

function InviteContextCard({ invite }: { invite: InviteContext }) {
  return (
    <div className="space-y-3 rounded-[8px] border border-[var(--accent-gold)]/40 bg-white/55 p-4 text-center">
      <div className="flex items-center justify-center gap-3">
        <AvatarChip
          displayName={invite.inviterName}
          userId={invite.inviterUserId}
          color={invite.inviterAvatarColor}
          size="lg"
        />
        <span className="text-[17px] leading-6 font-semibold text-black">{invite.inviterName}</span>
      </div>
      <p className="text-[15px] leading-6 text-black/75">
        {invite.inviterName} invited you to Joshing. Enter your phone number to join and start
        answering their questions.
      </p>
    </div>
  );
}

export default function LoginPanel({
  invitePrefill = null,
  inviteContext = null,
}: LoginPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const invitationToken = readInvitationToken(searchParams);
  const userInvite = readUserInvite(searchParams);

  const [phone, setPhone] = useState('');
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
  // Start on the invite confirmation step only when the link resolved to a
  // recipient phone; otherwise fall straight through to manual entry.
  const [step, setStep] = useState<Step>(invitePrefill?.maskedPhone ? 'invite' : 'phone');
  // True once the OTP was sent to the invite's phone (so the code step and
  // verify call use the masked phone + token instead of a typed number).
  const [invitePhoneMode, setInvitePhoneMode] = useState(false);
  // Masked phone to display on the code step while in invite-phone mode.
  const [maskedPhone, setMaskedPhone] = useState(invitePrefill?.maskedPhone ?? '');
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

  async function sendCodeToInvitePhone(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!invitationToken) {
      // No token to resolve a phone from — fall back to manual entry.
      setInvitePhoneMode(false);
      swapStep('phone');
      return;
    }

    sendTelemetry('friend_invite_auth_started');

    setLoading(true);
    try {
      const response = await fetch('/api/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // No phone: the server resolves the recipient phone from the invite
        // token and texts the code there. We only ever receive a masked form.
        body: JSON.stringify({ invitationToken, useInvitePhone: true, userInvite }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        // The invite no longer resolves to a sendable phone — drop to manual
        // entry so the user isn't stranded, carrying the reason onto the step.
        setInvitePhoneMode(false);
        swapStep('phone', data?.message ?? 'Enter your phone number to continue.');
        return;
      }

      if (typeof data?.maskedPhone === 'string') setMaskedPhone(data.maskedPhone);
      setInvitePhoneMode(true);
      swapStep('code');
    } finally {
      setLoading(false);
    }
  }

  async function continueWithPhone(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const normalized = normalizePhone(phone.trim());
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
        // Forward the per-user invite link so request-otp can satisfy the
        // invite gate for a brand-new phone that arrived via /u/<handle>/<token>
        // (the invitation isn't phone-targeted, so the gate can't infer it).
        body: JSON.stringify({ phone: normalized, userInvite }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data?.message ?? 'Unable to continue.');
        return;
      }

      setPhone(normalized);
      swapStep('code');
    } finally {
      setLoading(false);
    }
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
      const body =
        invitePhoneMode && invitationToken
          ? buildInviteVerifyOtpRequestBody(trimmedCode, invitationToken, searchParams)
          : buildVerifyOtpRequestBody(phone, trimmedCode, searchParams);
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
      {step === 'invite' ? (
        <form className="space-y-3.5" onSubmit={sendCodeToInvitePhone}>
          {/* Texting glyph (the two-tone speech bubble) — this step is about us
              sending a code by text, so it mirrors the OTP step's mark. */}
          <svg className="mx-auto h-14 w-auto" viewBox="-3 -3 54 44" aria-hidden="true">
            <g fill="var(--brand-navy)">
              <ellipse cx="15" cy="15" rx="15" ry="12" />
              <path d="M3 22 L11 26.5 L1 31 Z" />
            </g>
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
          {inviteContext ? (
            <InviteContextCard invite={inviteContext} />
          ) : (
            <p className="block text-center text-[17px] leading-[26px] font-medium tracking-[1.7px] text-black">
              {invitePrefill?.inviterName ?? 'A friend'} invited you to Joshing.
            </p>
          )}
          <p className="text-center text-[15px] leading-6 text-black/70">
            We&rsquo;ll text a code to{' '}
            <span className="font-medium whitespace-nowrap text-black">{maskedPhone}</span>.
          </p>

          {/* Button + divider + secondary action form a tight 6px cluster,
              matching the OTP step's rhythm. */}
          <div className="space-y-1.5">
            <button type="submit" className={SUBMIT_CLASS} disabled={loading}>
              {loading ? 'Sending…' : 'Send code'}
            </button>

            <div className="flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-[var(--brand-navy)]/15" />
              <span className="text-[17px] font-medium text-black">or</span>
              <span className="h-px flex-1 bg-[var(--brand-navy)]/15" />
            </div>

            <button
              type="button"
              className="mx-auto block text-sm leading-5 font-medium tracking-[0.56px] text-[var(--brand-orange)] uppercase underline underline-offset-4 disabled:opacity-60"
              onClick={() => {
                setInvitePhoneMode(false);
                swapStep('phone');
              }}
              disabled={loading}
            >
              Use a different number
            </button>
          </div>
        </form>
      ) : step === 'phone' ? (
        <form className="space-y-3.5" onSubmit={continueWithPhone}>
          {/* Solid filled handset, matching the Figma black phone glyph
              (and the filled treatment of the OTP step's bubble icon).
              Hand-drawn as a fill-only glyph rather than a force-filled
              lucide outline, which rendered with a muddy stroked edge. */}
          <svg className="mx-auto h-12 w-12 fill-black" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
          </svg>
          {inviteContext ? <InviteContextCard invite={inviteContext} /> : null}
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
            {loading ? 'Continuing…' : 'Continue'}
          </button>
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
            <span className="whitespace-nowrap">
              {invitePhoneMode ? maskedPhone : formatPhoneForDisplay(phone)}
            </span>
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
              {loading ? 'Verifying…' : 'Continue'}
            </button>

            <div className="flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-[var(--brand-navy)]/15" />
              <span className="text-[17px] font-medium text-black">or</span>
              <span className="h-px flex-1 bg-[var(--brand-navy)]/15" />
            </div>

            <button
              type="button"
              className="mx-auto block text-sm leading-5 font-medium tracking-[0.56px] text-[var(--brand-orange)] uppercase underline underline-offset-4 disabled:opacity-60"
              onClick={() => {
                setCode('');
                // Leaving the invite phone behind — collect a number manually.
                setInvitePhoneMode(false);
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
    </section>
  );
}
