'use client';

import { Eye, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

type FriendOption = {
  id: string;
  displayName: string;
};

type Props = {
  // Canonical profile URL the picker uses to build the preview link.
  // Should NOT include any existing ?previewAs= — that's added here.
  profileHref: string;
  // The owner's friends, pre-fetched server-side, used to populate the
  // "specific friend" list. Sorted by displayName upstream. Empty list
  // hides the "specific friend" option.
  friends: FriendOption[];
};

// Opens a bottom-sheet picker with three perspectives the owner can
// preview their profile as. Selecting any option navigates to
// /users/<self-id>?previewAs=<value> — the server then resolves and
// re-renders with the simulated viewer's sectionVisibleTo gates.
//
// JS-required because the picker is interactive; falling back to a
// no-op when JS is off is acceptable because non-owner viewers don't
// see this button at all.
export function PreviewAsButton({ profileHref, friends }: Props) {
  const [open, setOpen] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const close = () => {
    setOpen(false);
    setShowFriends(false);
  };

  const goTo = (previewAs: string) => {
    close();
    router.push(`${profileHref}?previewAs=${encodeURIComponent(previewAs)}`);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs font-medium transition"
      >
        <Eye className="size-3.5" />
        Preview as
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Choose a preview perspective"
          className="fixed inset-0 z-50 flex items-end justify-center"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            onClick={close}
            aria-label="Dismiss"
          />
          <div className="relative w-full max-w-lg rounded-t-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between px-5 pt-5 pb-2">
              <p className="text-[0.68rem] font-semibold tracking-[0.18em] uppercase text-stone-500">
                Preview as
              </p>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="inline-flex size-8 items-center justify-center rounded-full text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
              >
                <X className="size-4" />
              </button>
            </div>

            {!showFriends ? (
              <ul className="px-3 pb-6">
                <PickerOption
                  title="A stranger"
                  subtitle="See only what's public to non-friends."
                  onClick={() => goTo('stranger')}
                />
                <PickerOption
                  title="A friend"
                  subtitle="See what a generic active friend sees."
                  onClick={() => goTo('friend')}
                />
                {friends.length > 0 ? (
                  <PickerOption
                    title="A specific friend"
                    subtitle={`Pick from your ${friends.length} friend${friends.length === 1 ? '' : 's'}.`}
                    onClick={() => setShowFriends(true)}
                  />
                ) : null}
              </ul>
            ) : (
              <div className="px-3 pb-6">
                <button
                  type="button"
                  className="mx-2 mb-2 text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
                  onClick={() => setShowFriends(false)}
                >
                  ← Back
                </button>
                <ul className="max-h-[60vh] overflow-y-auto">
                  {friends.map((f) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => goTo(f.id)}
                        className="w-full rounded-md px-3 py-2 text-left text-base hover:bg-stone-100"
                      >
                        {f.displayName}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

function PickerOption({
  title,
  subtitle,
  onClick,
}: {
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="block w-full rounded-md px-3 py-3 text-left hover:bg-stone-100"
      >
        <p className="font-medium text-stone-950">{title}</p>
        <p className="mt-0.5 text-sm text-stone-500">{subtitle}</p>
      </button>
    </li>
  );
}
