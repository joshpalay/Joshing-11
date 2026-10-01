'use client';

import { Send, X } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';

import { SendQuestionDrawer, type SendableQuestion } from '@/components/SendQuestionDrawer';
import { cn } from '@/lib/utils';

// The send-onward paper plane on a question the viewer already knows (answered
// or wrote). Tapping it asks HOW to pass it on:
//   - "Send in Joshing" — the existing SendQuestionDrawer. The friend gets the
//     question to PLAY, so it never carries the answer.
//   - "Text it" — opens the phone's own Messages app with the question AND the
//     answer pre-filled ("did you know…"); the viewer picks the person there.
//     This is the device's sms: handler, not our Twilio sender — the A2P
//     campaign is deliberately narrow (see isSmsMessageTypeEnabled). Off a phone
//     there's no Messages app to open, so the text is copied instead.
// Same sheet-on-mobile / dropdown-on-desktop shape as AnsweredRowActions.

// `answer` is null only in the rare case the client doesn't hold it (a From
// Friends card answered wrong earlier this session — the grade sheet showed it,
// but it isn't threaded back to the card); the text then goes without it rather
// than inventing one.
export function buildTextOnwardMessage(
  question: { text: string; answer: string | null },
  url: string,
): string {
  const answer = question.answer?.trim();
  return answer
    ? `Did you know?\n\n${question.text.trim()}\n\n${answer}\n\nPlay on Joshing: ${url}`
    : `${question.text.trim()}\n\nPlay on Joshing: ${url}`;
}

function isPhone(): boolean {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

// iOS wants `sms:&body=`, Android `sms:?body=` — with no number either way, so
// Messages opens on its own contact picker.
function smsHref(body: string): string {
  const sep = /iPhone|iPad|iPod/i.test(navigator.userAgent) ? '&' : '?';
  return `sms:${sep}body=${encodeURIComponent(body)}`;
}

export function SendOnwardMenu({
  question,
  answer,
  buttonStyle,
  buttonClassName,
  iconSize = 15,
}: {
  question: SendableQuestion;
  answer: string | null;
  buttonStyle?: CSSProperties;
  buttonClassName?: string;
  iconSize?: number;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMenuOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setIsMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [isMenuOpen]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => {
      setCopied(false);
      setIsMenuOpen(false);
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function textIt() {
    const body = buildTextOnwardMessage({ text: question.text, answer }, window.location.origin);
    if (isPhone()) {
      setIsMenuOpen(false);
      window.location.href = smsHref(body);
      return;
    }
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
    } catch {
      setIsMenuOpen(false);
    }
  }

  return (
    <div className="relative" ref={menuRef} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label="Send to a friend"
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        onClick={() => setIsMenuOpen((current) => !current)}
        className={cn('inline-flex min-h-11 min-w-11 items-center justify-center', buttonClassName)}
        style={buttonStyle}
      >
        <Send size={iconSize} strokeWidth={1.8} aria-hidden="true" />
      </button>

      {isMenuOpen ? (
        <div className="fixed inset-0 z-[var(--z-sheet)] flex items-end justify-center bg-[var(--scrim-soft)] px-3 pt-16 pb-3 sm:absolute sm:inset-auto sm:right-0 sm:mt-2 sm:block sm:bg-transparent sm:p-0">
          <button
            type="button"
            className="absolute inset-0 cursor-default sm:hidden"
            aria-label="Close menu"
            onClick={() => setIsMenuOpen(false)}
          />
          <div
            role="menu"
            aria-label="Send to a friend"
            className="bg-background relative w-full max-w-md rounded-3xl border p-2 shadow-[var(--shadow-overlay)] sm:w-64 sm:rounded-2xl"
          >
            <div className="flex items-center justify-between px-3 py-2 sm:hidden">
              <p className="text-foreground text-sm font-medium">Send to a friend</p>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setIsMenuOpen(false)}
                className="btn-icon rounded-full"
              >
                <X className="size-4" />
              </button>
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsMenuOpen(false);
                setDrawerOpen(true);
              }}
              className="text-muted-foreground hover:bg-muted hover:text-foreground flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm transition"
            >
              Send in Joshing
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => void textIt()}
              className="text-muted-foreground hover:bg-muted hover:text-foreground flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm transition"
            >
              {copied ? 'Copied — paste it in a text ✓' : 'Text it'}
            </button>
          </div>
        </div>
      ) : null}

      <SendQuestionDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} question={question} />
    </div>
  );
}
