'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';

type CreatorNoteReadButtonProps = {
  noteId: string;
  children: ReactNode;
};

export function CreatorNoteReadButton({ noteId, children }: CreatorNoteReadButtonProps) {
  const [open, setOpen] = useState(false);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      void fetch(`/api/creator-notes/${encodeURIComponent(noteId)}/delivered`, {
        method: 'POST',
        credentials: 'include',
      }).catch(() => undefined);
    }
  }

  return (
    <div className="mt-3">
      <button className="btn-primary" type="button" onClick={toggle}>
        {open ? 'Hide' : 'Read it'}
      </button>
      {open ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}
