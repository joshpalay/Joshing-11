'use client';

import type { MasteryTier } from '@/types/db';
import { DomainProgressBar } from '@/components/knowledge/DomainProgressBar';

export type ProgressionView = {
  domain: string;
  displayName: string;
  tier: MasteryTier;
  points: number;
  pointsToNextTier: number | null;
  progressPercent: number;
  nextTier: MasteryTier | null;
  isAtTopTier: boolean;
};

type ProgressionLandscapeProps = {
  domains: ProgressionView[];
  onDomainSelect?: (domain: string) => void;
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(Math.round(value));
}

function tierLabel(value: MasteryTier): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function ProgressionLandscape({ domains, onDomainSelect }: ProgressionLandscapeProps) {
  if (domains.length === 0) {
    return (
      <p className="mt-4 rounded-lg border bg-card p-5 text-sm text-muted-foreground">
        Your progression will appear as you answer more questions.
      </p>
    );
  }

  return (
    <div className="mt-4 divide-y rounded-lg border bg-card text-card-foreground">
      {domains.map((domain) => (
        <button
          key={domain.domain}
          type="button"
          className="block w-full bg-transparent px-4 py-4 text-left transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onDomainSelect?.(domain.domain)}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-foreground">{domain.displayName}</h3>
              <p className="mt-1 text-xs capitalize text-muted-foreground">{tierLabel(domain.tier)}</p>
            </div>
            <p className="shrink-0 text-xs text-muted-foreground">{formatNumber(domain.points)} pts</p>
          </div>
          <div className="mt-3">
            <DomainProgressBar tier={domain.tier} progressWithinTier={domain.progressPercent / 100} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {domain.isAtTopTier || domain.pointsToNextTier === null || !domain.nextTier
              ? 'Top tier reached'
              : `${formatNumber(domain.pointsToNextTier)} points to ${tierLabel(domain.nextTier)}`}
          </p>
        </button>
      ))}
    </div>
  );
}
