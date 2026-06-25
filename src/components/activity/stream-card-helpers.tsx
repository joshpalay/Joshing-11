import Link from 'next/link';
import type { CSSProperties } from 'react';

import { FM, INK2, INK3, RULE } from '@/components/lately/tokens';
import type { StreamLinePart, StreamQuestion } from '@/lib/activity-stream';
import { HOUSE_AUTHOR, LLM_QUESTION_ATTRIBUTION } from '@/lib/questions-types';

// Pure, presentational stream-card helpers shared across the activity surfaces
// (ActivityStreamItem, PersonActivityCard) and the From Friends streak cards
// (B-FROMFRIENDS-STREAK-HEADER-01). Kept dependency-light — no answer flow, no
// sheets — so the streak cards can reuse the one-liner renderer and the honest
// provenance marker without pulling in the whole ActivityStreamItem tree.

// Friend names render in the activity-blue from Figma (--brand-link),
// linked or not, so the actor reads as the warm social anchor of the row.
export const ACTOR_BLUE = 'var(--brand-link)';

export function ActorLink({
  name,
  userId,
  style,
}: {
  name: string;
  userId: string | null;
  // Optional override for surfaces that render the actor in a different voice
  // (e.g. the playable milestone headline, where the name reads in the large
  // Editorial serif rather than the default activity-blue sans link).
  style?: CSSProperties;
}) {
  if (!userId) return <b style={{ fontWeight: 600, color: ACTOR_BLUE, ...style }}>{name}</b>;
  return (
    <Link
      href={`/users/${userId}`}
      onClick={(e) => e.stopPropagation()}
      style={{
        color: ACTOR_BLUE,
        fontWeight: 600,
        textDecoration: 'underline',
        textDecorationColor: RULE,
        textUnderlineOffset: 3,
        ...style,
      }}
    >
      {name}
    </Link>
  );
}

export function Line({ parts, plain = false }: { parts: StreamLinePart[]; plain?: boolean }) {
  return (
    <>
      {parts.map((part, i) => {
        if (part.t === 'actor') {
          return <ActorLink key={i} name={part.name} userId={part.userId} />;
        }
        if (part.t === 'category') {
          // `plain` (the ambient activity stream): the category stays in the
          // row's own sans face so the one-liner reads in a single voice — only
          // a touch of weight + the secondary ink set it apart from the sentence.
          if (plain) {
            return (
              <span key={i} style={{ fontWeight: 600, color: INK2 }}>
                {part.v}
              </span>
            );
          }
          // Default (editorial surfaces): category names read in the Editorial
          // serif (STYLE-GUIDE-TYPE §5) — warm, in their stored title case
          // ("Shakespearean Tragedy"), a register away from the sans sentence.
          return (
            <span
              key={i}
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: '1.05em',
                color: INK2,
              }}
            >
              {part.v}
            </span>
          );
        }
        return <span key={i}>{part.v}</span>;
      })}
    </>
  );
}

// D-FEED-GROUP3-01 §4 (honesty, load-bearing): when a row expands to reveal its
// question, a house/LLM-authored question MUST be marked — never rendered as if
// a person wrote it. Returns the marker text, or null when no marker is needed:
//   - authorIsHouse        → the house identity ("Joshing · Editorial")
//   - authorName === null  → a non-person LLM-origin question (LLM_QUESTION_ATTRIBUTION)
//   - human name / undefined → null (the row frame already attributes it; a
//                              human author needs no machine-honesty marker)
export function questionProvenance(q: StreamQuestion): string | null {
  if (q.authorIsHouse) return `${HOUSE_AUTHOR.displayName} · ${HOUSE_AUTHOR.label}`;
  if (q.authorName === null) return LLM_QUESTION_ATTRIBUTION;
  return null;
}

export function QuestionProvenance({ q, style }: { q: StreamQuestion; style?: CSSProperties }) {
  const label = questionProvenance(q);
  if (!label) return null;
  return (
    <p
      style={{
        margin: '4px 0 0',
        fontFamily: FM,
        fontSize: 10,
        letterSpacing: 1,
        color: INK3,
        ...style,
      }}
    >
      {label.toUpperCase()}
    </p>
  );
}
