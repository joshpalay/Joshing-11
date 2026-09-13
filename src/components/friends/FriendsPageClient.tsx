'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';

import { PersonalInviteFlow } from '@/components/friends/PersonalInviteFlow';

type Tab = 'friends' | 'links';

// D-FRIENDS-RESTRUCTURE-01: the tabbed shell for /friends. All the data
// fetching still happens server-side in page.tsx -- this component only owns
// tab selection and the personal-invite sheet, driven by ?invite=1 so the
// universal FAB's "Add a friend" chooser option (and any other surface) can
// open it by navigating here.
export function FriendsPageClient({
  findFriendsSearch,
  contactMatchBlock,
  suggested,
  friendsList,
  mutualFriendSuggestions,
  inviteLinksSection,
}: {
  findFriendsSearch: ReactNode;
  contactMatchBlock: ReactNode;
  suggested: ReactNode;
  friendsList: ReactNode;
  mutualFriendSuggestions: ReactNode;
  inviteLinksSection: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>('friends');
  const inviteOpen = searchParams.get('invite') === '1';
  const friendsTabRef = useRef<HTMLButtonElement | null>(null);
  const linksTabRef = useRef<HTMLButtonElement | null>(null);

  function selectTab(next: Tab, { focus = false }: { focus?: boolean } = {}) {
    setTab(next);
    if (focus) (next === 'friends' ? friendsTabRef : linksTabRef).current?.focus();
  }

  // §3.5's ratified tab recipe requires roving tabIndex, which means the
  // inactive tab is removed from the normal Tab order -- so Left/Right must
  // move focus between them, or a keyboard user could never reach it.
  function handleTabListKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    selectTab(tab === 'friends' ? 'links' : 'friends', { focus: true });
  }
  // Holds a hand-off detail (from FindFriendsSearch's "no match" state, etc.)
  // for the brief window between requesting the sheet and PersonalInviteFlow
  // actually mounting. A ref, not state: nothing renders off this value, so
  // there's no reason to trigger a re-render when it's written or cleared.
  const pendingPrefillRef = useRef<Record<string, unknown> | undefined>(undefined);

  function openInviteSheet() {
    if (searchParams.get('invite') === '1') return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('invite', '1');
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function closeInviteSheet() {
    pendingPrefillRef.current = undefined;
    const params = new URLSearchParams(searchParams.toString());
    params.delete('invite');
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  // PersonalInviteFlow only mounts inside the sheet now (never inline in the
  // default tab view), but other surfaces still hand off to it the same way
  // they always have: dispatching 'friend-invitations:create-new' on
  // window. If the sheet is already open, PersonalInviteFlow is already
  // mounted and its own listener receives this same event directly -- no
  // action needed here. If it's closed, this page-level listener stashes the
  // detail and opens it; the effect below re-dispatches the same event once
  // PersonalInviteFlow has mounted and attached its own listener (React runs
  // a newly-mounted child's effects before its parent's in the same commit,
  // so the re-dispatch always finds it already listening).
  useEffect(() => {
    function onCreateNew(event: Event) {
      if (searchParams.get('invite') === '1') return;
      const detail = (event as CustomEvent<Record<string, unknown>>).detail ?? {};
      pendingPrefillRef.current = detail;
      openInviteSheet();
    }
    window.addEventListener('friend-invitations:create-new', onCreateNew);
    return () => window.removeEventListener('friend-invitations:create-new', onCreateNew);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!inviteOpen || pendingPrefillRef.current === undefined) return;
    const detail = pendingPrefillRef.current;
    pendingPrefillRef.current = undefined;
    window.dispatchEvent(new CustomEvent('friend-invitations:create-new', { detail }));
  }, [inviteOpen]);

  // FindFriendsSearch's no-match state also links to "#invite-links" as a
  // fallback -- that section now lives on the Links tab instead of inline, so
  // a plain anchor jump would land on a hidden panel. Switch tabs first, then
  // scroll once the target is actually visible.
  useEffect(() => {
    function jumpToLinks() {
      if (window.location.hash !== '#invite-links') return;
      setTab('links');
      window.requestAnimationFrame(() => {
        document.getElementById('invite-links')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    jumpToLinks();
    window.addEventListener('hashchange', jumpToLinks);
    return () => window.removeEventListener('hashchange', jumpToLinks);
  }, []);

  return (
    <>
      <div
        className="mb-5 flex border-b"
        role="tablist"
        aria-label="Friends sections"
        onKeyDown={handleTabListKeyDown}
      >
        <button
          ref={friendsTabRef}
          type="button"
          className={`min-h-11 px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${tab === 'friends' ? 'border-b-2 border-foreground text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          role="tab"
          id="friends-tab-your-friends"
          aria-selected={tab === 'friends'}
          aria-controls="friends-panel-your-friends"
          tabIndex={tab === 'friends' ? 0 : -1}
          onClick={() => selectTab('friends')}
        >
          Your Friends
        </button>
        <button
          ref={linksTabRef}
          type="button"
          className={`min-h-11 px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${tab === 'links' ? 'border-b-2 border-foreground text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          role="tab"
          id="friends-tab-links"
          aria-selected={tab === 'links'}
          aria-controls="friends-panel-links"
          tabIndex={tab === 'links' ? 0 : -1}
          onClick={() => selectTab('links')}
        >
          Links
        </button>
      </div>

      {/* Both panels stay mounted (toggled via `hidden`, not unmounted) so
          switching tabs never refetches, and the "#invite-links" deep link
          above can find the section even before the tab switch commits. */}
      <div id="friends-panel-your-friends" role="tabpanel" aria-labelledby="friends-tab-your-friends" hidden={tab !== 'friends'}>
        <div className="mb-5 space-y-3">
          {findFriendsSearch}
          {contactMatchBlock}
        </div>
        {suggested}
        {friendsList}
        {mutualFriendSuggestions}
      </div>

      <div id="friends-panel-links" role="tabpanel" aria-labelledby="friends-tab-links" hidden={tab !== 'links'}>
        {inviteLinksSection}
      </div>

      {inviteOpen ? (
        <div
          className="fixed inset-0 z-[var(--z-sheet)] flex items-end bg-[var(--scrim)] md:items-stretch md:justify-end"
          role="dialog"
          aria-modal="true"
        >
          <button
            className="absolute inset-0 cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            type="button"
            aria-label="Close"
            onClick={closeInviteSheet}
          />
          <aside className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-lg bg-background px-5 pt-5 shadow-[var(--shadow-overlay)] md:h-full md:max-h-none md:w-[440px] md:rounded-none">
            <div className="mb-2 flex items-center justify-end">
              <button
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border p-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                type="button"
                onClick={closeInviteSheet}
                title="Close"
              >
                <X className="size-4" />
              </button>
            </div>
            <PersonalInviteFlow />
          </aside>
        </div>
      ) : null}
    </>
  );
}
