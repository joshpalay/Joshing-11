import type { MasteryTier } from '@prisma/client';
import { TierProgressBar } from '@/components/progression/TierProgressBar';

type Props = {
  tier: MasteryTier;
  progressWithinTier: number;
};

export function DomainProgressBar({ tier, progressWithinTier }: Props) {
  return <TierProgressBar tier={tier} progressWithinTier={progressWithinTier} ariaLabelPrefix="Domain progression" />;
}
