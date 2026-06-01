import { DomainRow } from '@/components/knowledge/DomainRow';
import type { MasteryTier } from '@/types/db';

export type KnowledgeMapDomain = {
  domain: string;
  displayName: string;
  points: number;
  tier: string;
  tierProgress: number;
  questionsAnswered: number;
  isDeclaredInterest: boolean;
};

type DomainListProps = {
  domains: KnowledgeMapDomain[];
  onDomainSelect?: (domain: string) => void;
};

export function DomainList({ domains, onDomainSelect }: DomainListProps) {
  if (domains.length === 0) return null;

  return (
    <div className="bg-card text-card-foreground mt-4 divide-y rounded-lg border">
      {domains.map((domain) => (
        <button
          key={domain.domain}
          type="button"
          className="hover:bg-muted/50 focus-visible:ring-ring block w-full bg-transparent px-4 py-0 text-left transition-colors first:rounded-t-lg last:rounded-b-lg focus-visible:ring-2 focus-visible:outline-none"
          onClick={() => onDomainSelect?.(domain.domain)}
        >
          <DomainRow
            domain={domain.displayName}
            masteryPoints={domain.points}
            yourQuestionsCount={domain.questionsAnswered}
            tierOverride={asTier(domain.tier)}
            progressOverride={domain.tierProgress / 100}
            pointsLabel={`${formatNumber(domain.points)} pts`}
            declared={domain.isDeclaredInterest}
          />
        </button>
      ))}
    </div>
  );
}

function asTier(value: string): MasteryTier {
  if (value === 'familiar' || value === 'solid' || value === 'mastery') return value;
  return 'establishing';
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(Math.round(value));
}
