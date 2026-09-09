'use client';

import { RotateCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { SettingsGroup, SettingsRow } from '@/components/profile/SettingsRow';

/**
 * Developer replay for the post-game welcome tour. The forced harness neither
 * reads nor writes the account's durable seen marker, so QA can replay it
 * without changing the real first-player lifecycle.
 */
export function ResetWelcomeTourButton() {
  const router = useRouter();

  return (
    <SettingsGroup>
      <SettingsRow
        icon={<RotateCcw className="size-5" />}
        title="Replay the welcome tour"
        subtitle="Open the read-only post-game tour preview"
        onClick={() => router.push('/dev/welcome-tour')}
      />
    </SettingsGroup>
  );
}
