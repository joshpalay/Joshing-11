import Link from 'next/link';
import type { ReactNode } from 'react';

import {
  CREAM,
  FF,
  FI,
  FM,
  FS,
  INK,
  INK2,
  INK3,
  PAPER,
  RULE,
} from './tokens';

type Props = {
  caption: string;
  title: ReactNode;
  italicBody?: ReactNode | null;
  regularBody?: ReactNode | null;
  extra?: ReactNode | null;
  timestamp: string;
  action?: ReactNode | null;
  // Optional DOM id — used by the friend-invitation deep link
  // (/activities#friendship-{id}) to scroll the relevant card into view.
  anchorId?: string | null;
};

export function UtilityCard({
  caption,
  title,
  italicBody,
  regularBody,
  extra,
  timestamp,
  action,
  anchorId,
}: Props) {
  return (
    <div
      id={anchorId ?? undefined}
      style={{
        background: PAPER,
        border: `1.5px solid ${RULE}`,
        padding: '14px 18px 14px',
        marginBottom: 14,
        display: 'flex',
        gap: 14,
        alignItems: 'flex-start',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 9,
            fontFamily: FM,
            color: INK3,
            letterSpacing: 2.5,
            marginBottom: 8,
          }}
        >
          {caption}
        </div>

        <div
          style={{
            fontSize: 17,
            fontFamily: FS,
            fontWeight: 500,
            color: INK,
            lineHeight: 1.35,
            letterSpacing: -0.2,
            marginBottom: 6,
          }}
        >
          {title}
        </div>

        {italicBody ? (
          <div
            style={{
              fontFamily: FI,
              fontStyle: 'italic',
              color: INK2,
              fontSize: 13,
              marginBottom: 10,
            }}
          >
            {italicBody}
          </div>
        ) : null}

        {regularBody ? (
          <div
            style={{
              fontFamily: FF,
              color: INK2,
              fontSize: 13,
              lineHeight: 1.5,
              marginBottom: 10,
            }}
          >
            {regularBody}
          </div>
        ) : null}

        {extra ? <div style={{ marginBottom: 10 }}>{extra}</div> : null}

        <div
          style={{
            fontSize: 9,
            fontFamily: FM,
            color: INK3,
            letterSpacing: 2,
          }}
        >
          {timestamp}
        </div>
      </div>

      {action ? <div style={{ alignSelf: 'flex-start' }}>{action}</div> : null}
    </div>
  );
}

const inkButtonStyle = {
  display: 'inline-block',
  background: INK,
  color: CREAM,
  border: 'none',
  fontFamily: FM,
  fontSize: 10,
  letterSpacing: 2,
  padding: '10px 14px',
  cursor: 'pointer',
  boxShadow: `2px 2px 0 ${INK2}`,
  whiteSpace: 'nowrap',
  textDecoration: 'none',
} as const;

export function UtilityActionLink({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <Link href={href} style={inkButtonStyle}>
      {label.toUpperCase()} →
    </Link>
  );
}

export function UnderlineName({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        textDecoration: 'underline',
        textDecorationColor: INK,
        textUnderlineOffset: 4,
        textDecorationThickness: 1.5,
      }}
    >
      {children}
    </span>
  );
}
