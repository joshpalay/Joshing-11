'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, Brain, Home, Pencil, Plus, User, Users } from 'lucide-react';
import { CreateChooser } from '@/components/CreateChooser';

const navItems = [
  { href: '/', label: 'Home', Icon: Home },
  { href: '/questions', label: 'Questions', Icon: Pencil },
  { href: '/knowledge', label: 'Knowledge', Icon: Brain },
  { href: '/friends', label: 'Friends', Icon: Users },
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

function AccountIcon({
  active,
  initials,
}: {
  active: boolean;
  initials: string | null;
}) {
  if (!initials) {
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
      {initials}
    </span>
  );
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
  const router = useRouter();
  const currentUserId = initialUserId;
  const [createChooserOpen, setCreateChooserOpen] = useState(false);

  // Badge values seed from props (kept for any caller that still passes them) and
  // are refreshed client-side after mount. The root layout no longer blocks HTML
  // streaming on these DB queries — it passes only initialUserId — so Nav pulls
  // them from GET /api/nav once mounted. Badges pop in slightly late by design.
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [badgeCount, setBadgeCount] = useState(bellBadgeCount);
  const [friendsDot, setFriendsDot] = useState(friendsDotVisible);

  useEffect(() => {
    if (!initialUserId) return;
    let active = true;
    fetch('/api/nav', { credentials: 'include' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { displayName?: string | null; bellBadgeCount?: number; friendsDotVisible?: boolean } | null) => {
        if (!active || !data) return;
        setDisplayName(data.displayName ?? null);
        setBadgeCount(typeof data.bellBadgeCount === 'number' ? data.bellBadgeCount : 0);
        setFriendsDot(Boolean(data.friendsDotVisible));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [initialUserId]);

  const accountInitials = displayName ? initialsFor(displayName) || null : null;
  // On Home and the Questions page the FAB is a dedicated "add a question"
  // shortcut: it drops straight into the composer (?create=1) rather than the
  // generic three-way Create chooser. The composer still surfaces every
  // destination control, so nothing is lost by skipping the chooser here. The
  // chooser stays as the FAB action on the other surfaces.
  const isQuestionComposerShortcut = pathname === '/' || pathname.startsWith('/questions');
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

  // The weekly ceremony (/ceremony/<id>) is a full-screen, self-contained
  // takeover with its own progress dots and X-to-exit — same as the game play
  // screen — so the global chrome (header, FAB, bottom nav) is suppressed. The
  // bottom nav was previously covering the ceremony's progress dots and the FAB
  // floated over the experience.
  const isCeremonyScreen = pathname.startsWith('/ceremony/');

  if (
    pathname === '/onboarding' ||
    pathname.startsWith('/daily') ||
    pathname === '/login' ||
    pathname.startsWith('/invite/') ||
    isGamePlayScreen ||
    isCeremonyScreen
  ) {
    return null;
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

  const showBadge = badgeCount > 0;
  const badgeText = formatBadgeCount(badgeCount);

  return (
    <>
      <header
        className="z-40 border-b bg-background/95 backdrop-blur"
        aria-label="Primary header"
      >
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <Link
            href="/"
            className="font-sans text-[22px] font-semibold leading-none tracking-[0.05em] text-foreground"
          >
            Joshing
          </Link>
          <div className="flex items-center gap-1">
            <Link
              href="/activities"
              aria-label={
                showBadge ? `Activity, ${badgeCount} unread` : 'Activity'
              }
              className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Bell className="size-5" strokeWidth={1.9} />
              {showBadge ? (
                <span
                  className="absolute right-1 top-1 grid min-w-[18px] items-center rounded-full px-1.5 text-center font-mono text-[9px] font-semibold leading-[14px] text-[var(--brand-card)]"
                  style={{ backgroundColor: 'var(--destructive)' }}
                  aria-hidden="true"
                >
                  {badgeText}
                </span>
              ) : null}
            </Link>
            <Link
              href="/users/me"
              aria-label="Account and settings"
              aria-current={isProfileTabActive('/users/me') ? 'page' : undefined}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <AccountIcon active={isProfileTabActive('/users/me')} initials={accountInitials} />
            </Link>
          </div>
        </div>
      </header>
      {showNewGameShortcut ? (
        <button
          type="button"
          className={[
            'fixed bottom-24 right-5 z-50 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg',
            // The dedicated add-a-question FAB shows on every viewport; the
            // generic Create chooser FAB stays mobile-only as before.
            isQuestionComposerShortcut ? '' : 'md:hidden',
          ].join(' ')}
          aria-label={isQuestionComposerShortcut ? 'Add a question' : 'Create'}
          onClick={() =>
            isQuestionComposerShortcut
              ? router.push('/questions?create=1')
              : setCreateChooserOpen(true)
          }
        >
          <Plus className="size-6" />
        </button>
      ) : null}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur"
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
                  active ? 'text-foreground' : 'text-[var(--brand-ink-700)] hover:text-foreground',
                ].join(' ')}
              >
                <span aria-hidden="true" className="relative grid place-items-center">
                  {isProfile ? (
                    <AccountIcon active={active} initials={accountInitials} />
                  ) : (
                    <Icon
                      className="size-5"
                      strokeWidth={active ? 2.4 : 1.8}
                      fill={active && label === 'Home' ? 'currentColor' : 'none'}
                    />
                  )}
                  {/* Discovery indicator for the Friends tab — muted neutral
                      so it doesn't compete with the bell badge accent. */}
                  {friendsDot && label === 'Friends' ? (
                    <span
                      className="absolute -right-1 -top-1 size-2 rounded-full"
                      style={{ backgroundColor: '#8a8a9a' }}
                    />
                  ) : null}
                </span>
                <span
                  className={[
                    'font-mono text-[10px] uppercase tracking-[0.06em]',
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
