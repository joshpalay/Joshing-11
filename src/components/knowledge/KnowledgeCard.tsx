'use client';

import { useMemo, useState } from 'react';
import type { MasteryTier } from '@/types/db';
import { DomainCircle } from '@/components/knowledge/DomainCircle';
import { buildKnowledgeCardPublicUrl } from '@/lib/knowledge-card';

export interface KnowledgeDomainCircle {
  canonicalSubcategory: string;
  canonicalSubcategorySlug: string;
  currentTier: MasteryTier;
  lifetimePoints: number;
  iconKey: string;
}

export interface KnowledgeCardProps {
  playerDisplayName: string;
  portraitStatement: string;
  domains: KnowledgeDomainCircle[];
  overflowCount: number;
  tierSignature: string;
  rarestTerritory: string | null;
  rarestTerritorySolo: boolean;
  shareText: string;
  shareCardToken: string;
  shareCardExpiresAt: string;
  readOnly?: boolean;
  highlightedSlug?: string | null;
}

function getCircleDiameter(points: number, maxPoints: number, isMobile: boolean): number {
  const max = isMobile ? 64 : 80;
  const min = isMobile ? 24 : 28;
  const ratio = maxPoints > 0 ? points / maxPoints : 0;
  return Math.round(min + (ratio * (max - min)));
}

export function KnowledgeCard(props: KnowledgeCardProps) {
  const [copyLabel, setCopyLabel] = useState('Copy');
  const [shareLabel, setShareLabel] = useState('Share');
  const sorted = useMemo(() => [...props.domains].sort((a, b) => b.lifetimePoints - a.lifetimePoints), [props.domains]);
  const maxPoints = sorted[0]?.lifetimePoints ?? 1;

  const onCopy = async () => {
    await navigator.clipboard.writeText(props.shareText);
    setCopyLabel('Copied ✓');
    window.setTimeout(() => setCopyLabel('Copy'), 2000);
  };

  const onShare = async () => {
    const url = buildKnowledgeCardPublicUrl(props.shareCardToken);
    if (navigator.share) {
      await navigator.share({ text: props.shareText, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    setShareLabel('Link copied');
    window.setTimeout(() => setShareLabel('Share'), 2000);
  };

  return (
    <section style={{ background: '#f5f0e8', border: '1px solid #e8e2d6', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#8a8070' }}>Your Knowledge Portrait</p>
          <p style={{ fontFamily: 'var(--font-literata), serif', fontStyle: 'italic', fontSize: 15, color: '#1a1208' }}>Joshing</p>
        </div>
        <p style={{ marginTop: 6, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#8a8070' }}>{props.playerDisplayName} · Joshing</p>
      </div>

      <div style={{ borderTop: '1px solid #e8e2d6', padding: '24px 20px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-end', columnGap: 16, rowGap: 20 }}>
          {sorted.map((domain) => {
            const diameter = getCircleDiameter(domain.lifetimePoints, maxPoints, typeof window !== 'undefined' ? window.innerWidth < 400 : false);
            return (
              <DomainCircle
                key={domain.canonicalSubcategorySlug}
                id={`knowledge-portrait-circle-${domain.canonicalSubcategorySlug}`}
                diameter={diameter}
                iconKey={domain.iconKey}
                canonicalSubcategory={domain.canonicalSubcategory}
                currentTier={domain.currentTier}
                highlighted={props.highlightedSlug === domain.canonicalSubcategorySlug}
              />
            );
          })}
        </div>
        {props.overflowCount > 0 && <p style={{ marginTop: 14, fontSize: 11, color: '#8a8070', textAlign: 'center' }}>+{props.overflowCount} more territories</p>}
      </div>

      <div style={{ borderTop: '1px solid #e8e2d6', padding: 20 }}>
        <p style={{ fontFamily: 'var(--font-literata), serif', fontStyle: 'italic', fontSize: 18, color: '#1a1208' }}>{props.portraitStatement}</p>
        <p style={{ marginTop: 8, fontSize: 13, color: '#1a1208' }}>{props.tierSignature}</p>
        {props.rarestTerritory && (
          <p style={{ marginTop: 6, fontSize: 11, color: '#8a8070' }}>
            Rarest territory: {props.rarestTerritory}{props.rarestTerritorySolo ? " — you're the only one here" : ''}
          </p>
        )}
        <p style={{ marginTop: 8, marginBottom: 20, fontSize: 11, color: '#8a8070' }}>{props.playerDisplayName} on Joshing</p>
        {!props.readOnly && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <button type="button" onClick={onCopy} style={{ minHeight: 44, borderRadius: 999, border: '1px solid #1a1208', background: 'transparent', color: '#1a1208' }}>{copyLabel}</button>
            <button type="button" onClick={onShare} style={{ minHeight: 44, borderRadius: 999, border: '1px solid #1a1208', background: '#1a1208', color: '#f5f0e8' }}>{shareLabel}</button>
          </div>
        )}
      </div>
    </section>
  );
}
