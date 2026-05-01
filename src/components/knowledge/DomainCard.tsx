import type { ReactNode } from 'react';
import type { KnowledgeDomain } from '@/server/profile/knowledge-types';
import { DomainRow } from '@/components/knowledge/DomainRow';

type Props = {
  domain: KnowledgeDomain;
  highlighted?: boolean;
  trailingControl?: ReactNode;
};

export function DomainCard({ domain, highlighted = false, trailingControl }: Props) {
  const href = trailingControl ? undefined : `/profile/domains/${encodeURIComponent(domain.name)}`;

  return (
    <DomainRow
      domain={domain.name}
      masteryPoints={domain.masteryPoints}
      yourQuestionsCount={domain.declaredQuestionCount}
      href={href}
      highlighted={highlighted}
      tierOverride={domain.tier}
      progressOverride={domain.progressWithinTier}
      trailingControl={trailingControl}
    />
  );
}
