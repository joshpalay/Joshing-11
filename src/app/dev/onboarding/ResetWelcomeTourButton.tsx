'use client';

import { RotateCcw } from 'lucide-react';
import { useState } from 'react';

import { SettingsGroup, SettingsRow } from '@/components/profile/SettingsRow';
import { clearWelcomeTourSeen } from '@/components/welcome/WelcomeTourScreen';

/**
 * Re-arm the first-run welcome tour by clearing its persisted client flag.
 *
 * Scope: this clears ONLY the client-side `localStorage` suppression key, so the
 * next visit to `/?welcome=1` runs the tour again. It deliberately does NOT
 * touch real account onboarding state (onboardingComplete,
 * firstSessionRecapSeenAt) — those live server-side and re-running them is out
 * of scope for this read-only harness.
 */
export function ResetWelcomeTourButton() {
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);

  return (
    <div>
      <SettingsGroup>
        <SettingsRow
          icon={<RotateCcw className="size-5" />}
          title="Re-arm the welcome tour"
          subtitle="Clear the local seen-flag so /?welcome=1 runs the tour again"
          tone="destructive"
          onClick={() => {
            setDone(false);
            setConfirming(true);
          }}
        />
      </SettingsGroup>
      {confirming ? (
        <div className="border-destructive/30 bg-card text-card-foreground mt-3 rounded-xl border p-4">
          <p className="text-sm font-medium">Re-arm the welcome tour on this device?</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Clears the local seen-flag only. Does not change any account onboarding state.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="btn-danger"
              onClick={() => {
                clearWelcomeTourSeen();
                setConfirming(false);
                setDone(true);
              }}
            >
              Re-arm tour
            </button>
            <button type="button" className="btn-ghost" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {done ? (
        <p className="mt-2 text-sm text-[var(--game-correct)]">
          Done — open <span className="font-semibold">/?welcome=1</span> to see it again.
        </p>
      ) : null}
    </div>
  );
}
