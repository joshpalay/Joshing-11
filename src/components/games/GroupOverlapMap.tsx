'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { categoryLabel } from '@/lib/questions-types';

type PlayerColor = { user_id: string; color: string };

export type KnowledgeMapCategory = {
  canonical_subcategory: string;
  broad_category: string;
  shared_correct: number;
  players: Array<{
    user_id: string;
    display_name: string;
    declared_score: number;
    proven_score: number;
    questions_answered_correctly: number;
  }>;
};

type KnowledgeMapResponse = {
  // TODO v11.0: group_id response data - needs new data source
  group_id?: unknown;
  // TODO v11.0: game_id response data - needs new data source
  game_id?: unknown;
  players: Array<{ user_id: string; display_name: string }>;
  player_colors: PlayerColor[];
  // TODO v11.0: GroupKnowledgeMapCategory - needs new data source
  categories: KnowledgeMapCategory[];
};

const eyebrowStyle: CSSProperties = {
  margin: 0,
  fontSize: 13,
  fontVariant: 'small-caps',
  color: '#1a1208',
  fontFamily: 'var(--font-neutral), system-ui, sans-serif',
  letterSpacing: '0.06em',
};

const monoStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.62rem',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function pairwiseOverlapRatio(
  playerCorrectA: number,
  playerCorrectB: number,
  sharedCorrect: number,
) {
  const denom = Math.max(playerCorrectA, playerCorrectB, 1);
  return clamp(sharedCorrect / denom, 0, 1);
}

function meanPairwiseOverlapRatio(players: KnowledgeMapCategory['players'], sharedCorrect: number) {
  if (players.length < 2) return 0;
  const ratios: number[] = [];
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      ratios.push(
        pairwiseOverlapRatio(
          players[i]?.questions_answered_correctly ?? 0,
          players[j]?.questions_answered_correctly ?? 0,
          sharedCorrect,
        ),
      );
    }
  }
  return mean(ratios);
}

function diameterFromScore(score: number, maxScore: number) {
  const MIN_D = 20;
  const MAX_D = 56;
  if (maxScore <= 0) return MIN_D;
  const t = clamp(score / maxScore, 0, 1);
  return MIN_D + (MAX_D - MIN_D) * t;
}

function buildCirclePositions(diameters: number[], overlapRatioMean: number) {
  const radii = diameters.map((d) => d / 2);
  const positions: number[] = [];
  let x = 0;
  for (let i = 0; i < radii.length; i++) {
    if (i === 0) {
      positions.push(0);
      continue;
    }
    const rPrev = radii[i - 1] ?? 0;
    const r = radii[i] ?? 0;
    const gap = (rPrev + r) * (1 - overlapRatioMean * 0.85);
    x += gap;
    positions.push(x);
  }
  const minX = Math.min(...positions);
  const maxX = Math.max(...positions);
  const center = (minX + maxX) / 2;
  return positions.map((p) => p - center);
}

function strongestOverlapCategory(categories: KnowledgeMapCategory[]) {
  let best: { category: KnowledgeMapCategory; ratio: number } | null = null;
  for (const c of categories) {
    const ratio = meanPairwiseOverlapRatio(c.players, c.shared_correct);
    if (ratio <= 0) continue;
    if (!best || ratio > best.ratio) best = { category: c, ratio };
  }
  return best?.category ?? null;
}

export function GroupOverlapMap({
  groupId,
  gameId,
}: {
  // TODO v11.0: groupId prop - needs new data source
  groupId?: unknown;
  // TODO v11.0: gameId prop - needs new data source
  gameId?: unknown;
}) {
  const resolvedGroupId = typeof groupId === 'string' ? groupId : null;
  const resolvedGameId = typeof gameId === 'string' ? gameId : null;
  const [fetchState, setFetchState] = useState<{
    requestKey: string;
    data: KnowledgeMapResponse | null;
  }>({
    requestKey: '',
    data: null,
  });
  const requestKey = `${resolvedGroupId ?? ''}:${resolvedGameId ?? ''}`;
  const loading = fetchState.requestKey !== requestKey;

  useEffect(() => {
    if (!resolvedGroupId || !resolvedGameId) {
      setFetchState({ requestKey, data: null });
      return;
    }
    let cancelled = false;

    fetch(`/api/groups/${resolvedGroupId}/games/${resolvedGameId}/knowledge-map`, { credentials: 'include' })
      .then((r) => (r.ok ? (r.json() as Promise<KnowledgeMapResponse>) : null))
      .then((json) => {
        if (cancelled) return;
        setFetchState({
          requestKey,
          data: json,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setFetchState({
            requestKey,
            data: null,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [resolvedGameId, resolvedGroupId, requestKey]);

  const scopedData = useMemo(() => {
    const data = fetchState.data;
    if (!data) return null;
    if (data.group_id !== resolvedGroupId || data.game_id !== resolvedGameId) return null;
    return data;
  }, [fetchState.data, resolvedGameId, resolvedGroupId]);

  const colorByUserId = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of scopedData?.player_colors ?? []) map.set(row.user_id, row.color);
    return map;
  }, [scopedData?.player_colors]);

  const categoriesWithOverlap = useMemo(() => {
    const base = scopedData?.categories ?? [];
    return base
      .map((c) => ({
        ...c,
        overlapRatioMean: meanPairwiseOverlapRatio(c.players, c.shared_correct),
      }))
      .filter((c) => c.overlapRatioMean > 0);
  }, [scopedData?.categories]);

  const maxActivityScore = useMemo(() => {
    let maxScore = 0;
    for (const c of categoriesWithOverlap) {
      for (const p of c.players) {
        maxScore = Math.max(maxScore, (p.declared_score ?? 0) + (p.proven_score ?? 0));
      }
    }
    return maxScore;
  }, [categoriesWithOverlap]);

  const strongest = useMemo(() => strongestOverlapCategory(categoriesWithOverlap), [categoriesWithOverlap]);

  const groupedByBroad = useMemo(() => {
    const map = new Map<string, Array<(typeof categoriesWithOverlap)[number]>>();
    for (const c of categoriesWithOverlap) {
      const broad = c.broad_category ?? 'other';
      if (!map.has(broad)) map.set(broad, []);
      map.get(broad)!.push(c);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.canonical_subcategory.localeCompare(b.canonical_subcategory));
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [categoriesWithOverlap]);

  return (
    <section className="card px-5 py-4">
      <p style={eyebrowStyle}>GROUP PROGRESS RECAP</p>

      {loading ? (
        <p style={{ marginTop: '10px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Loading…</p>
      ) : null}

      {!loading && strongest ? (
        <p style={{ marginTop: '8px', fontSize: '0.92rem', color: 'var(--text)', lineHeight: 1.45 }}>
          Your strongest overlap: <span style={{ fontWeight: 600 }}>{strongest.canonical_subcategory}</span>
        </p>
      ) : null}

      <div style={{ marginTop: (!loading && strongest) ? 14 : 10, display: 'grid', gap: 18 }}>
        {groupedByBroad.map(([broad, cats]) => (
          <section key={broad} aria-label={categoryLabel(broad)}>
            <p style={{ ...monoStyle, color: 'var(--text-muted)', marginBottom: 10 }}>
              {categoryLabel(broad)}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 16px' }}>
              {cats.map((c) => {
                const players = [...c.players].sort((a, b) => a.display_name.localeCompare(b.display_name));
                const activityScores = players.map((p) => (p.declared_score ?? 0) + (p.proven_score ?? 0));
                const diameters = activityScores.map((s) => diameterFromScore(s, maxActivityScore));
                const positions = buildCirclePositions(diameters, c.overlapRatioMean);

                const width = Math.max(
                  120,
                  Math.ceil(
                    Math.max(...positions.map((x, i) => Math.abs(x) + (diameters[i] ?? 0) / 2), 0) * 2,
                  ),
                );
                const height = Math.max(72, Math.ceil(Math.max(...diameters, 20)));

                const label =
                  players.length >= 2
                    ? `${c.canonical_subcategory}: ${players[0]!.display_name} and ${players[1]!.display_name} overlap`
                    : `${c.canonical_subcategory}: overlap`;

                return (
                  <div
                    key={`${broad}:${c.canonical_subcategory}`}
                    style={{ width: 150 }}
                    aria-label={label}
                  >
                    <div
                      style={{
                        width: '100%',
                        height,
                        position: 'relative',
                        display: 'grid',
                        placeItems: 'center',
                      }}
                      role="img"
                      aria-label={label}
                    >
                      <div style={{ position: 'relative', width, height }}>
                        {players.map((p, idx) => {
                          const d = diameters[idx] ?? 20;
                          const x = positions[idx] ?? 0;
                          const color = colorByUserId.get(p.user_id) ?? '#888888';
                          return (
                            <div
                              key={`${c.canonical_subcategory}:${p.user_id}`}
                              style={{
                                position: 'absolute',
                                left: '50%',
                                top: '50%',
                                width: d,
                                height: d,
                                borderRadius: '999px',
                                transform: `translate(calc(-50% + ${x}px), -50%)`,
                                background: `color-mix(in srgb, ${color} 32%, transparent)`,
                                border: `2px solid ${color}`,
                                boxSizing: 'border-box',
                                pointerEvents: 'none',
                              }}
                            />
                          );
                        })}
                      </div>
                    </div>
                    <p style={{ marginTop: 8, fontSize: '0.85rem', color: 'var(--text)', lineHeight: 1.25 }}>
                      {c.canonical_subcategory}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
