'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Brain, Home, Menu, Pencil, Plus, Rss, User, X } from 'lucide-react';
import { CreateChooser } from '@/components/CreateChooser';

type MeResponse = {
  user?: {
    id?: string | null;
    display_name?: string | null;
  };
};

const navItems = [
  { href: '/', label: 'Home', Icon: Home },
  { href: '/friends', label: 'Friends', Icon: Rss },
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

export function Nav({ initialUserId = null }: { initialUserId?: string | null }) {
  const pathname = usePathname();
  const [accountInitials, setAccountInitials] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(initialUserId);
  const [menuOpen, setMenuOpen] = useState(false);
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

  const loadCurrentUser = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'include' });
      if (!response.ok) {
        setAccountInitials(null);
        setCurrentUserId(null);
        return;
      }
      const body = await response.json().catch(() => null) as MeResponse | null;
      const initials = body?.user?.display_name ? initialsFor(body.user.display_name) : '';
      setAccountInitials(initials || null);
      setCurrentUserId(body?.user?.id ?? null);
    } catch {
      setAccountInitials(null);
    }
  }, []);

  useEffect(() => {
    if (pathname === '/onboarding') return;

    const initialTimer = window.setTimeout(() => {
      void loadCurrentUser();
    }, 0);
    return () => {
      window.clearTimeout(initialTimer);
    };
  }, [loadCurrentUser, pathname]);

  if (pathname === '/onboarding') {
    return null;
  }

  function AccountIcon({ active }: { active: boolean }) {
    if (!accountInitials) {
      return <User className="size-5" strokeWidth={1.9} />;
    }

    return (
      <span
        className={[
          'grid size-6 place-items-center rounded-full text-[11px] font-semibold',
          active ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground',
        ].join(' ')}
        aria-hidden="true"
      >
        {accountInitials}
      </span>
    );
  }

  return (
    <>
      <nav
        className={[
          'sticky top-0 z-40 border-b bg-background/95 backdrop-blur',
          menuOpen ? 'px-6 pb-16 pt-7 md:pb-16' : 'px-4 py-3',
        ].join(' ')}
        aria-label="Primary navigation"
      >
        <div
          className={[
            'mx-auto flex max-w-4xl items-center justify-between',
            menuOpen ? 'mb-9' : '',
          ].join(' ')}
        >
          <Link
            href="/"
            className={[
              'font-serif font-semibold leading-none text-foreground',
              menuOpen ? 'text-[2rem]' : 'text-lg',
            ].join(' ')}
            onClick={() => setMenuOpen(false)}
          >
            Joshing
          </Link>
          <button
            type="button"
            className={[
              'inline-flex items-center justify-center border text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              menuOpen
                ? 'size-16 rounded-2xl bg-background text-4xl shadow-sm'
                : 'min-h-10 min-w-10 rounded-md',
            ].join(' ')}
            aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={menuOpen}
            aria-controls="nav-menu"
            onClick={() => setMenuOpen((current) => !current)}
          >
            {menuOpen ? <X className="size-8" strokeWidth={1.6} /> : <Menu className="size-5" />}
          </button>
        </div>
        {menuOpen ? (
          <div id="nav-menu" className="mx-auto grid max-w-4xl gap-8 md:gap-5" role="list">
            {navItems.map(({ href, label, Icon }) => {
              const active = pathname === href;
              const isAccount = label === 'Account';

              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMenuOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  className={[
                    'group flex min-h-14 items-center gap-7 rounded-xl px-8 text-[1.65rem] leading-none transition md:min-h-12 md:text-2xl',
                    active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                  ].join(' ')}
                  role="listitem"
                >
                  <span className="relative grid size-7 shrink-0 place-items-center text-muted-foreground transition group-hover:text-foreground">
                    {isAccount ? <AccountIcon active={active} /> : <Icon className="size-6" strokeWidth={1.9} />}
                  </span>
                  {label}
                </Link>
              );
            })}
          </div>
        ) : null}
      </nav>
      {showNewGameShortcut ? (
        <button
          type="button"
          className="fixed bottom-20 right-5 z-50 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg md:hidden"
          aria-label="Create"
          onClick={() => setCreateChooserOpen(true)}
        >
          <Plus className="size-6" />
        </button>
      ) : null}
      <CreateChooser open={createChooserOpen} onClose={() => setCreateChooserOpen(false)} />
    </>
  );
}
