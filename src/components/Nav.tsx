'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Brain, Home, Menu, Pencil, Plus, Rss, User, X } from 'lucide-react';
import { CreateChooser } from '@/components/CreateChooser';

type MeResponse = {
  user?: {
    display_name?: string | null;
  };
};

const navItems = [
  { href: '/', label: 'Home', Icon: Home },
  { href: '/feed', label: 'Friends', Icon: Rss },
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

export function Nav() {
  const pathname = usePathname();
  const [accountInitials, setAccountInitials] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [createChooserOpen, setCreateChooserOpen] = useState(false);
  const hidesNewGameShortcut =
    pathname.startsWith('/daily') ||
    pathname === '/replay' ||
    pathname.startsWith('/games/');
  const showNewGameShortcut = !hidesNewGameShortcut;

  const loadCurrentUser = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'include' });
      if (!response.ok) {
        setAccountInitials(null);
        return;
      }
      const body = await response.json().catch(() => null) as MeResponse | null;
      const initials = body?.user?.display_name ? initialsFor(body.user.display_name) : '';
      setAccountInitials(initials || null);
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
      return <User className="size-4" />;
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

  return (
    <>
      <nav className="sticky top-0 z-40 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <Link href="/" className="font-serif text-lg font-semibold">Joshing</Link>
          <button
            type="button"
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={menuOpen}
            aria-controls="nav-menu"
            onClick={() => setMenuOpen((current) => !current)}
          >
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
        {menuOpen ? (
          <div id="nav-menu" className="mx-auto mt-3 grid max-w-4xl gap-1">
            {navItems.map(({ href, label, Icon }) => {
              const active = pathname === href;
              const isAccount = label === 'Account';

              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMenuOpen(false)}
                  className={[
                    'flex min-h-11 items-center gap-3 rounded-md px-3 text-sm transition',
                    active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  ].join(' ')}
                >
                  <span className="relative grid size-5 place-items-center">
                    {isAccount ? <AccountIcon active={active} /> : <Icon className="size-4" />}
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
