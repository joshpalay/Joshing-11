'use client';

import type { ReactNode } from 'react';

import type { StreamItem } from '@/lib/activity-stream';
import { FF, INK, INK2, INK3 } from '@/components/lately/tokens';

import { Line } from './ActivityStreamItem';
import { ActivityIcon } from './ActivityIcon';

// Width of the shape column (mark 24 + gap 8), so the rolled-up lines indent to
// sit directly under the heading statement's text.
const HEADING_INDENT = 32;

// The friend's first name, pulled from the first actor part of any of their rows.
function firstNameFromRows(rows: StreamItem[]): string {
  for (const row of rows) {
    for (const part of row.line) {
      if (part.t === 'actor') {
        const [first] = part.name.trim().split(/\s+/);
        if (first) return first;
      }
    }
  }
  return 'They';
}

// Distinct topics across a set of rows, first-seen order, nulls dropped.
function topicsOf(rows: StreamItem[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const t = r.topic?.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

// The human predicate of a convergence caption ("keep landing in the same
// place") with the "You and {Name}" lead stripped — the cluster header already
// names the pair, so the echo is removed (v2 §3).
function convergencePredicate(row: StreamItem): string {
  const parts = row.line;
  const actorIdx = parts.findIndex((p) => p.t === 'actor');
  const after = parts.slice(actorIdx + 1).find((p) => p.t === 'text');
  if (after && 'v' in after && after.v.trim()) return after.v.trim();
  const before = [...parts.slice(0, actorIdx)].reverse().find((p) => p.t === 'text');
  if (before && 'v' in before) {
    const stripped = before.v.replace(/\b(you\s+and|and)\s*$/i, '').trim();
    if (stripped) return stripped;
  }
  return 'both knew these';
}

// One quiet rolled-up line beneath the cluster header. No bold, no shape, no
// timestamp — the texture layer (v2 §4).
function SubLine({ children }: { children: ReactNode }) {
  return (
    <p style={{ margin: '4px 0 0', fontFamily: FF, fontSize: 14, lineHeight: 1.4, color: INK2 }}>
      {children}
    </p>
  );
}

// Tier 2 + 3 of the home hierarchy (D-FEED-TIER v2 §3): one quiet per-person
// cluster. The header is the relationship pair ("You & Robyn") with the single
// diamond; the friend's events roll up beneath it by direction — "got {Name} —
// topics", "{Name} got yours — topics", a folded convergence line — names said
// once, topics on few lines, per-event timestamps/actions dropped.
export function PersonActivityCard({
  rows,
  timestampFor,
}: {
  friendId: string;
  rows: StreamItem[];
  timestampFor: (item: StreamItem) => string;
}) {
  const name = firstNameFromRows(rows);
  const youGot = rows.filter((r) => r.relationship === 'you_got');
  const gotYou = rows.filter((r) => r.relationship === 'got_you');
  const saved = rows.filter((r) => r.relationship === 'saved');
  const reacted = rows.filter((r) => r.relationship === 'reacted');
  const convergence = rows.find((r) => r.relationship === 'convergence') ?? null;
  // Anything without a relationship kind (mastery, opened a domain, follows…)
  // keeps its own quiet one-liner as a fallback.
  const others = rows.filter((r) => !r.relationship);

  const youGotTopics = topicsOf(youGot);
  const gotYouTopics = topicsOf(gotYou);
  const seed = rows[0]?.id ?? 'person';

  return (
    <div style={{ padding: '14px 2px' }}>
      {/* No flex `gap`: ActivityIcon already reserves mark 24 + 8px marginRight,
          so the heading lands at the same 32px x as the lines below it. */}
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        <ActivityIcon spec={{ kind: 'diamond' }} seed={seed} />
        <p
          style={{
            margin: 0,
            flex: 1,
            minWidth: 0,
            fontFamily: FF,
            fontSize: 15,
            fontWeight: 600,
            lineHeight: 1.4,
            letterSpacing: 0.2,
            color: INK,
          }}
        >
          You &amp; {name}
        </p>
        {rows[0] ? (
          <span
            style={{ fontSize: 12, color: INK3, opacity: 0.6, whiteSpace: 'nowrap', marginLeft: 8 }}
          >
            {timestampFor(rows[0])}
          </span>
        ) : null}
      </div>
      <div style={{ marginLeft: HEADING_INDENT, marginTop: 2 }}>
        {youGot.length ? (
          <SubLine>
            got {name}
            {youGotTopics.length ? ` — ${youGotTopics.join(', ')}` : ''}
          </SubLine>
        ) : null}
        {gotYou.length ? (
          <SubLine>
            {name} got yours
            {gotYouTopics.length ? ` — ${gotYouTopics.join(', ')}` : ''}
          </SubLine>
        ) : null}
        {saved.length ? (
          <SubLine>
            {name} saved {saved.length > 1 ? `${saved.length} of your questions` : 'your question'}
          </SubLine>
        ) : null}
        {reacted.length ? <SubLine>{name} reacted to your question</SubLine> : null}
        {convergence ? <SubLine>{convergencePredicate(convergence)}</SubLine> : null}
        {others.map((row) => (
          <SubLine key={row.id}>
            <Line parts={row.line} />
          </SubLine>
        ))}
      </div>
    </div>
  );
}
