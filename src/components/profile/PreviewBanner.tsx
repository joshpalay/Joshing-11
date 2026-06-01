'use client';

import { Eye, X } from 'lucide-react';
import Link from 'next/link';

type Props = {
  // What the owner is previewing as. The label is rendered into the
  // banner sentence so the owner always knows whose perspective they're
  // simulating.
  label: string;
  // Where the "Exit preview" link goes — typically /users/<self-id>
  // without the ?previewAs= query string. The server-rendered href keeps
  // exit working even if JS is off.
  exitHref: string;
};

// Top-of-page strip rendered whenever ?previewAs= is active. The icon +
// amber palette intentionally mimics the "edit pending" affordances used
// elsewhere in the app — preview mode is a temporary, owner-only state
// you exit, not a permanent setting.
export function PreviewBanner({ label, exitHref }: Props) {
  return (
    <div className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <div className="flex min-w-0 items-center gap-2">
        <Eye className="size-4 flex-none" />
        <span className="truncate">Previewing your profile as {label}.</span>
      </div>
      <Link
        href={exitHref}
        className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-900 transition hover:bg-amber-100"
      >
        <X className="size-3" />
        Exit preview
      </Link>
    </div>
  );
}
