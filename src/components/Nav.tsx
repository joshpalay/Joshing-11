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
  { href: '/account', label: 'Account', Icon: User },
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

  if (pathname === '/onboarding' || pathname.startsWith('/daily')) {
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

  const showBadge = bellBadgeCount > 0;
  const badgeText = formatBadgeCount(bellBadgeCount);

  return (
    <>
      <header
        className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur"
        aria-label="Primary header"
      >
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link
            href="/"
            className="font-serif text-lg font-semibold leading-none text-foreground"
          >
            Joshing
          </Link>
          <Link
            href="/activities"
            aria-label={
              showBadge ? `Activity, ${bellBadgeCount} unread` : 'Activity'
            }
            className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Bell className="size-5" strokeWidth={1.9} />
            {showBadge ? (
              <span
                className="absolute right-1 top-1 grid min-w-[18px] items-center rounded-full px-[5px] text-center font-mono text-[9px] font-semibold leading-[14px] text-white"
                style={{ backgroundColor: 'var(--accent)' }}
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
          className="fixed bottom-24 right-5 z-50 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg md:hidden"
          aria-label="Create"
          onClick={() => setCreateChooserOpen(true)}
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
          className="mx-auto grid max-w-4xl"
          style={{ gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))` }}
          role="list"
        >
          {navItems.map(({ href, label, Icon }) => {
            const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
            const isAccount = label === 'Account';

            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                role="listitem"
                className={[
                  'flex min-h-14 flex-col items-center justify-center gap-1 py-2 transition',
                  active ? 'text-foreground opacity-100' : 'text-foreground/55 hover:text-foreground',
                ].join(' ')}
              >
                <span aria-hidden="true" className="relative grid place-items-center">
                  {isAccount ? (
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
                      className="absolute -right-1 -top-1 size-2 rounded-full"
                      style={{ backgroundColor: '#8a8a9a' }}
                    />
                  ) : null}
                </span>
                <span
                  className={[
                    'font-mono text-[9px] uppercase tracking-[0.08em]',
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
