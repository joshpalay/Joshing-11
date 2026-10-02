'use client';

import { Send, X } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

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

type InviteLinkSummary = { url: string; categories: Array<{ label: string }> };

// Joshing is invite-only, so a bare site link dead-ends a texted friend at the
// login wall ("Joshing is invite-only"). The text carries one of the sender's
// own invite links instead — the one whose topics include this question's,
// else their first. Null when they have none (the text then carries the site
// URL, as before).
export function pickInviteLinkUrl(links: InviteLinkSummary[], domain: string): string | null {
  const key = domain.trim().toLocaleLowerCase('en-US');
  const matching = key
    ? links.find((link) => link.categories.some((c) => c.label.trim().toLocaleLowerCase('en-US') === key))
    : undefined;
  return (matching ?? links[0])?.url ?? null;
}

async function fetchInviteLinks(): Promise<InviteLinkSummary[]> {
  const response = await fetch('/api/account/invite-links', { credentials: 'include', cache: 'no-store' });
  if (!response.ok) return [];
  const body = (await response.json().catch(() => null)) as { links?: InviteLinkSummary[] } | null;
  return Array.isArray(body?.links) ? body.links : [];
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
  // Set on first open; from then on the drawer (and its "Sent" toast) is
  // portaled to <body> for the same stacking-context reason as the sheet.
  const [drawerUsed, setDrawerUsed] = useState(false);
  const [copied, setCopied] = useState(false);
  // Phone-width menus render as a bottom sheet portaled to <body>. Inline, any
  // ancestor that makes a stacking context (a faded answered card's opacity)
  // trapped the z-sheet layer under the bottom nav and FAB, so "Text it" could
  // not be tapped (QA 2026-10-01 run 2). The desktop dropdown stays inline —
  // it is positioned against the airplane button.
  const [asSheet, setAsSheet] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  // Resolved while the menu is open, then read synchronously on tap: sms: and
  // the clipboard only work inside the tap's user gesture, so "Text it" must
  // not await the network.
  const [inviteLinks, setInviteLinks] = useState<InviteLinkSummary[] | null>(null);

  useEffect(() => {
    if (!isMenuOpen) return;
    if (inviteLinks === null) {
      void fetchInviteLinks()
        .catch(() => [])
        .then(setInviteLinks);
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMenuOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !sheetRef.current?.contains(target)) setIsMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [isMenuOpen, inviteLinks]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => {
      setCopied(false);
      setIsMenuOpen(false);
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);

  function toggleMenu() {
    setAsSheet(!window.matchMedia('(min-width: 640px)').matches);
    setIsMenuOpen((current) => !current);
  }

  async function textIt() {
    const url = pickInviteLinkUrl(inviteLinks ?? [], question.domain) ?? window.location.origin;
    const body = buildTextOnwardMessage({ text: question.text, answer }, url);
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

  const menu = isMenuOpen ? (
    <div
      ref={sheetRef}
      onClick={(e) => e.stopPropagation()}
      className="fixed inset-0 z-[var(--z-sheet)] flex items-end justify-center bg-[var(--scrim-soft)] px-3 pt-16 pb-3 sm:absolute sm:inset-auto sm:right-0 sm:mt-2 sm:block sm:bg-transparent sm:p-0"
    >
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
            setDrawerUsed(true);
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
  ) : null;

  return (
    <div className="relative" ref={menuRef} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label="Send to a friend"
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        onClick={toggleMenu}
        className={cn('inline-flex min-h-11 min-w-11 items-center justify-center', buttonClassName)}
        style={buttonStyle}
      >
        <Send size={iconSize} strokeWidth={1.8} aria-hidden="true" />
      </button>

      {menu && asSheet ? createPortal(menu, document.body) : menu}

      {drawerUsed
        ? createPortal(
            <SendQuestionDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} question={question} />,
            document.body,
          )
        : null}
    </div>
  );
}
