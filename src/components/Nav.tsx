'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, Brain, Home, Plus, Rss, User } from 'lucide-react';

type ActivitiesResponse = {
  unreadCount?: number;
};

const navItems = [
  { href: '/', label: 'Home', Icon: Home },
  { href: '/feed', label: 'Feed', Icon: Rss },
  { href: '/knowledge', label: 'Knowledge', Icon: Brain },
  { href: '/activities', label: 'Activities', Icon: Bell },
  { href: '/account', label: 'Account', Icon: User },
];

export function Nav() {
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState(0);

  const loadUnreadCount = useCallback(async () => {
    try {
      const response = await fetch('/api/activities', { cache: 'no-store', credentials: 'include' });
      if (!response.ok) {
        setUnreadCount(0);
        return;
      }
      const body = await response.json().catch(() => null) as ActivitiesResponse | null;
      setUnreadCount(body?.unreadCount ?? 0);
    } catch {
      setUnreadCount(0);
    }
  }, []);

  useEffect(() => {
    void loadUnreadCount();
    const timer = window.setInterval(() => {
      void loadUnreadCount();
    }, 60_000);

    return () => window.clearInterval(timer);
  }, [loadUnreadCount]);

  useEffect(() => {
    if (pathname === '/activities') setUnreadCount(0);
  }, [pathname]);

  return (
    <>
      <nav className="hidden border-b bg-background/95 px-4 py-3 backdrop-blur md:block">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <Link href="/" className="font-serif text-lg font-semibold">Joshing</Link>
          <div className="flex items-center gap-2 text-sm">
            {navItems.map(({ href, label, Icon }) => {
              const active = pathname === href;
              const showUnreadDot = label === 'Activities' && unreadCount > 0;

              return (
                <Link
                  key={href}
                  href={href}
                  className={[
                    'inline-flex min-h-10 items-center gap-2 rounded-md px-3 transition hover:bg-muted hover:text-foreground',
                    active ? 'text-foreground' : 'text-muted-foreground',
                  ].join(' ')}
                >
                  <span className="relative grid size-5 place-items-center">
                    <Icon className="size-4" />
                    {showUnreadDot ? (
                      <span className="absolute right-0 top-0 size-2 rounded-full bg-primary" aria-hidden="true" />
                    ) : null}
                  </span>
                  {label}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-2 py-2 backdrop-blur md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5">
          {navItems.map(({ href, label, Icon }) => {
            const active = pathname === href;
            const showUnreadDot = label === 'Activities' && unreadCount > 0;

            return (
              <Link
                key={href}
                href={href}
                className={[
                  'flex min-h-12 flex-col items-center justify-center gap-1 rounded-md text-[11px] transition',
                  active ? 'text-foreground' : 'text-muted-foreground',
                ].join(' ')}
              >
                <span className="relative grid size-5 place-items-center">
                  <Icon className="size-4" />
                  {showUnreadDot ? (
                    <span className="absolute right-0 top-0 size-2 rounded-full bg-primary" aria-hidden="true" />
                  ) : null}
                </span>
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
      <Link
        href="/new-game"
        className="fixed bottom-20 right-5 z-50 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg md:hidden"
        aria-label="New Game"
      >
        <Plus className="size-6" />
      </Link>
    </>
  );
}
