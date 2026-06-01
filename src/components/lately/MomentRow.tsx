'use client';

import Link from 'next/link';
import { useState, type KeyboardEvent, type MouseEvent } from 'react';

import type { LatelyMoment } from '@/server/db/queries/lately';

import { CREAM, FI, FM, FS, INK, INK2, INK3, PAPER, RULE } from './tokens';

type Props = {
  moment: LatelyMoment;
  caption: string;
  footnoteTime: string;
  featured?: boolean;
  defaultOpen?: boolean;
};

export function MomentRow({
  moment,
  caption,
  footnoteTime,
  featured = false,
  defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  function toggle() {
    setOpen((v) => !v);
  }

  // iOS Safari is unreliable about firing click on plain <div> even with
  // cursor:pointer; role=button + keyboard handler makes the tap target
  // unambiguous to the gesture engine and to assistive tech.
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  }

  function handleSend(e: MouseEvent) {
    e.stopPropagation();
    console.log({
      momentId: moment.momentId,
      questionId: moment.questionId,
      friendId: moment.friendId,
      dir: moment.dir,
    });
  }

  function handleFriendClick(e: MouseEvent) {
    e.stopPropagation();
  }

  const nameLink = (
    <Link
      href={`/users/${moment.friendId}`}
      onClick={handleFriendClick}
      style={{
        color: INK,
        textDecoration: 'underline',
        textDecorationColor: INK,
        textUnderlineOffset: 4,
        textDecorationThickness: 1.5,
        cursor: 'pointer',
      }}
    >
      {moment.friendName}
    </Link>
  );

  const categorySpan = (
    <span style={{ fontFamily: FI, fontStyle: 'italic', fontWeight: 500 }}>{moment.category}</span>
  );

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={toggle}
      onKeyDown={handleKeyDown}
      style={{
        background: PAPER,
        border: `1.5px solid ${featured ? INK : RULE}`,
        boxShadow: featured ? `3px 3px 0 ${INK2}` : 'none',
        padding: featured ? '18px 20px 16px' : '14px 18px 12px',
        marginBottom: 14,
        cursor: 'pointer',
        transition: 'border-color 120ms ease',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
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
          fontSize: featured ? 22 : 17,
          fontFamily: FS,
          fontWeight: 500,
          color: INK,
          lineHeight: 1.35,
          letterSpacing: -0.2,
          marginBottom: open ? 14 : 12,
        }}
      >
        {moment.dir === 'they_got_you' ? (
          <>
            {nameLink} got you on {categorySpan}.
          </>
        ) : (
          <>
            You got {nameLink} on {categorySpan}.
          </>
        )}
      </div>

      {open ? (
        <>
          <div
            style={{
              borderLeft: `2px solid ${INK}`,
              paddingLeft: 12,
              marginBottom: 14,
            }}
          >
            <div
              style={{
                fontSize: featured ? 14 : 13,
                fontFamily: FI,
                fontStyle: 'italic',
                color: INK2,
                lineHeight: 1.55,
              }}
            >
              &ldquo;{moment.questionText}&rdquo;
            </div>
          </div>

          <div onClick={(e) => e.stopPropagation()} style={{ marginBottom: 14 }}>
            <button
              type="button"
              onClick={handleSend}
              style={{
                background: CREAM,
                border: `1.5px solid ${INK}`,
                color: INK,
                fontFamily: FM,
                fontSize: 10,
                letterSpacing: 2,
                padding: '8px 14px',
                cursor: 'pointer',
                boxShadow: `2px 2px 0 ${INK2}`,
              }}
            >
              SEND TO A FRIEND →
            </button>
          </div>
        </>
      ) : null}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 9,
            fontFamily: FM,
            color: INK3,
            letterSpacing: 2,
          }}
        >
          <span>{moment.gameTitle.toUpperCase()}</span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span>{footnoteTime}</span>
        </div>
        <div
          style={{
            fontSize: 9,
            fontFamily: FM,
            color: INK2,
            letterSpacing: 2,
            fontWeight: 600,
          }}
        >
          {open ? '− QUESTION' : '+ QUESTION'}
        </div>
      </div>
    </div>
  );
}
