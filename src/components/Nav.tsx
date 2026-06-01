'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, Brain, Home, Pencil, Plus, User, Users } from 'lucide-react';
import { CreateChooser } from '@/components/CreateChooser';

const navItems = [
  { href: '/', label: 'Home', Icon: Home },
  { href: '/friends', label: 'Friends', Icon: Users },
  { href: '/questions', label: 'Questions', Icon: Pencil },
  { href: '/knowledge', label: 'Knowledge', Icon: Brain },
  { href: '/users/me', label: 'Profile', Icon: User },
];

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase();
}

function formatBadgeCount(count: number): string {
  if (count > 99) return '99+';
  return String(count);
}

export function Nav({
  initialUserId = null,
  initialDisplayName = null,
  bellBadgeCount = 0,
  friendsDotVisible = false,
}: {
  initialUserId?: string | null;
  initialDisplayName?: string | null;
  bellBadgeCount?: number;
  friendsDotVisible?: boolean;
}) {
  const pathname = usePathname();
  const accountInitials = initialDisplayName ? initialsFor(initialDisplayName) || null : null;
  const currentUserId = initialUserId;
  const [createChooserOpen, setCreateChooserOpen] = useState(false);
  const isOtherUserProfilePath = (() => {
    if (!pathname.startsWith('/users/')) return false;
    const rest = pathname.slice('/users/'.length);
    const profileId = rest.split('/')[0] ?? '';
    if (!profileId) return false;
    return profileId !== currentUserId;
  })();
  const hidesNewGameShortcut =
    pathname.startsWith('/daily') ||
    pathname === '/replay' ||
    pathname.startsWith('/games/') ||
    pathname === '/friends' ||
    isOtherUserProfilePath;
  const showNewGameShortcut = !hidesNewGameShortcut;

  // The Joshing-game play screen (/games/<id>) is a focused flow with its own
  // in-screen header (title + progress dots + X-to-exit) per the Figma "Game"
  // frame, so the global app chrome is suppressed there — matching how the
  // sibling /daily gameplay flow already hides Nav. The summary route
  // (/games/<id>/summary) keeps the nav.
  const gameSegments = pathname.split('/').filter(Boolean);
  const isGamePlayScreen = gameSegments[0] === 'games' && gameSegments.length === 2;

  if (
    pathname === '/onboarding' ||
    pathname.startsWith('/daily') ||
    pathname === '/login' ||
    pathname.startsWith('/invite/') ||
    isGamePlayScreen
  ) {
    return null;
  }

  function AccountIcon({ active }: { active: boolean }) {
    if (!accountInitials) {
      return <User className="size-5" strokeWidth={active ? 2.4 : 1.8} />;
    }

    return (
      <span
        className={[
          'grid size-5 place-items-center rounded-full text-[10px] font-semibold',
          active ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground',
        ].join(' ')}
        aria-hidden="true"
      >
        {accountInitials}
      </span>
    );
  }

  // The Profile tab is active for both the canonical /users/<self-id>
  // route and the /users/me alias before it redirects.
  function isProfileTabActive(href: string): boolean {
    if (href !== '/users/me') return false;
    if (pathname === '/users/me') return true;
    if (currentUserId && pathname.startsWith(`/users/${currentUserId}`)) {
      return true;
    }
    return false;
  }

  const showBadge = bellBadgeCount > 0;
  const badgeText = formatBadgeCount(bellBadgeCount);

  return (
    <>
      <header className="bg-background/95 z-40 border-b backdrop-blur" aria-label="Primary header">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <Link
            href="/"
            className="text-foreground font-sans text-[22px] leading-none font-semibold tracking-[0.05em]"
          >
            Joshing
          </Link>
          <Link
            href="/activities"
            aria-label={showBadge ? `Activity, ${bellBadgeCount} unread` : 'Activity'}
            className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-md transition focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <Bell className="size-5" strokeWidth={1.9} />
            {showBadge ? (
              <span
                className="absolute top-1 right-1 grid min-w-[18px] items-center rounded-full px-[5px] text-center font-mono text-[9px] leading-[14px] font-semibold text-[var(--brand-card)]"
                style={{ backgroundColor: 'var(--destructive)' }}
                aria-hidden="true"
              >
                {badgeText}
              </span>
            ) : null}
          </Link>
        </div>
      </header>
      {showNewGameShortcut ? (
        <button
          type="button"
          className="bg-primary text-primary-foreground fixed right-5 bottom-24 z-50 grid size-14 place-items-center rounded-full shadow-lg md:hidden"
          aria-label="Create"
          onClick={() => setCreateChooserOpen(true)}
        >
          <Plus className="size-6" />
        </button>
      ) : null}
      <nav
        className="bg-background/95 fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur"
        aria-label="Primary navigation"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div
          className="mx-auto grid max-w-2xl"
          style={{ gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))` }}
          role="list"
        >
          {navItems.map(({ href, label, Icon }) => {
            const isProfile = label === 'Profile';
            const active = isProfile
              ? isProfileTabActive(href)
              : href === '/'
                ? pathname === '/'
                : pathname.startsWith(href);

            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                role="listitem"
                className={[
                  'flex min-h-14 flex-col items-center justify-center gap-1 py-2 transition',
                  // Inactive tabs use a legible secondary navy (--brand-ink-700,
                  // ~7:1 on cream) rather than the old text-foreground/55, which
                  // dimmed to ~2.5:1 and failed AA.
                  active ? 'text-foreground' : 'hover:text-foreground text-[var(--brand-ink-700)]',
                ].join(' ')}
              >
                <span aria-hidden="true" className="relative grid place-items-center">
                  {isProfile ? (
                    <AccountIcon active={active} />
                  ) : (
                    <Icon
                      className="size-5"
                      strokeWidth={active ? 2.4 : 1.8}
                      fill={active && label === 'Home' ? 'currentColor' : 'none'}
                    />
                  )}
                  {/* Discovery indicator for the Friends tab — muted neutral
                      so it doesn't compete with the bell badge accent. */}
                  {friendsDotVisible && label === 'Friends' ? (
                    <span
                      className="absolute -top-1 -right-1 size-2 rounded-full"
                      style={{ backgroundColor: '#8a8a9a' }}
                    />
                  ) : null}
                </span>
                <span
                  className={[
                    'font-mono text-[10px] tracking-[0.06em] uppercase',
                    active ? 'font-semibold' : 'font-medium',
                  ].join(' ')}
                >
                  {label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
      <CreateChooser open={createChooserOpen} onClose={() => setCreateChooserOpen(false)} />
    </>
  );
}
