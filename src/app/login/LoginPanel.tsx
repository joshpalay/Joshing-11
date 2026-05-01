'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const US_E164_REGEX = /^\+1\d{10}$/;

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return phone.startsWith('+') ? phone : `+${digits}`;
}

export default function LoginPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const invitationToken =
    searchParams.get('invitationToken') ?? searchParams.get('invite') ?? searchParams.get('token');

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function continueWithPhone(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const normalized = normalizePhone(phone.trim());
    if (!US_E164_REGEX.test(normalized)) {
      setError('Use a US phone number.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: normalized }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data?.message ?? 'Unable to continue.');
        return;
      }

      setPhone(normalized);
      setStep('code');
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
      const response = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ phone, code: trimmedCode, invitationToken }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data?.message ?? 'Code invalid or expired.');
        return;
      }

      router.replace('/');
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="w-full max-w-sm rounded-lg border bg-card p-5 shadow-sm">
      <div className="mb-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {step === 'phone' ? 'Login with phone' : 'Enter code'}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-normal">Joshing</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Trivia you wish you were asked.
        </p>
      </div>

      {step === 'phone' ? (
        <form className="space-y-3" onSubmit={continueWithPhone}>
          <label className="block text-sm font-medium" htmlFor="phone">
            Phone number
          </label>
          <input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            className="h-11 w-full rounded-md border bg-background px-3 text-base outline-none ring-offset-background focus:ring-2 focus:ring-ring"
            placeholder="555-123-4567"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            disabled={loading}
          />
          <button
            type="submit"
            className="h-11 w-full rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
            disabled={loading}
          >
            {loading ? 'Continuing...' : 'Continue'}
          </button>
        </form>
      ) : (
        <form className="space-y-3" onSubmit={verifyCode}>
          <label className="block text-sm font-medium" htmlFor="code">
            Temporary code
          </label>
          <input
            id="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            className="h-11 w-full rounded-md border bg-background px-3 text-base outline-none ring-offset-background focus:ring-2 focus:ring-ring"
            placeholder="000000"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            disabled={loading}
          />
          <button
            type="submit"
            className="h-11 w-full rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
            disabled={loading}
          >
            {loading ? 'Verifying...' : 'Verify code'}
          </button>
          <button
            type="button"
            className="h-9 w-full text-sm text-muted-foreground"
            onClick={() => {
              setCode('');
              setError(null);
              setStep('phone');
            }}
            disabled={loading}
          >
            Change number
          </button>
        </form>
      )}

      {error ? (
        <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
