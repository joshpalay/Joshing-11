'use client';

import { type CSSProperties } from 'react';

import {
  GameCategoryCircles,
  RoundCategoryCircles,
  type GameCircleItem,
  type RoundCircleItem,
} from '@/components/knowledge/CategoryCircles';
import type { MasteryTier } from '@/types/db';

type DeltaCircleRow = {
  subcategory: string;
  points_earned: number;
  total: number;
  current_tier: MasteryTier;
  new_tier: MasteryTier | null;
  broad_category?: string | null;
};

export type CategoryGainsDisplayProps = {
  mode?: 'lightweight' | 'full';
  gameItems?: GameCircleItem[];
  roundItems?: RoundCircleItem[];
  deltas?: DeltaCircleRow[];
  className?: string;
  emptyMessage?: string;
};

function itemsFromDeltas(deltas: DeltaCircleRow[]): RoundCircleItem[] {
  return deltas
    .filter((row) => row.points_earned > 0)
    .map((row) => ({
      canonical_subcategory: row.subcategory,
      broad_category: row.broad_category || row.subcategory,
      points_total: row.total,
      points_gained_this_round: row.points_earned,
      tier_current: row.new_tier ?? row.current_tier,
    }));
}

export function CategoryGainsDisplay({
  gameItems,
  roundItems,
  deltas,
  className,
  emptyMessage,
}: CategoryGainsDisplayProps) {
  const resolvedRoundItems = roundItems ?? (deltas ? itemsFromDeltas(deltas) : undefined);
  const hasItems = Boolean(gameItems?.length || resolvedRoundItems?.length);

  if (!hasItems) {
    return emptyMessage ? (
      <p className="text-muted-foreground mt-3 text-sm">{emptyMessage}</p>
    ) : null;
  }

  return (
    <div className={className} style={wrapperStyle}>
      {gameItems?.length ? <GameCategoryCircles items={gameItems} /> : null}
      {resolvedRoundItems?.length ? <RoundCategoryCircles items={resolvedRoundItems} /> : null}
    </div>
  );
}

const wrapperStyle: CSSProperties = {
  marginTop: 12,
};
