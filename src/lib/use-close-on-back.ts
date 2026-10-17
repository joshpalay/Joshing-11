'use client';

import { useEffect, useRef } from 'react';

// Make the phone/browser Back button close an open sheet instead of leaving the
// page (QA 2026-10-17 S3: Back with the "Not for me" sheet open dropped the
// player out of the round onto home). Call it from a component that is mounted
// only while the sheet is open.
//
// While mounted, one extra history entry (same URL, state tagged with MARK) sits
// on top of the page's own entry:
//   - Back pops that entry → the popstate handler sees the tag gone → onClose.
//   - The sheet closes some other way (a choice, ×, Escape, the scrim) → the
//     cleanup steps back over the entry so it isn't left behind for the next
//     Back press.
// Next's App Router keeps its own data in history.state, so the pushed entry
// copies it and only adds the tag; going back to the original entry is then an
// ordinary same-URL restore for the router.
//
// The cleanup's step-back is deferred and counted so React's dev double-mount
// (mount → cleanup → mount in the same tick) neither pushes a second entry nor
// pops the one the remount still needs. If the close was followed by a real
// navigation, history.state no longer carries the tag and nothing is popped.

const MARK = '__joshingSheetOpen';

let openSheets = 0;

type HistoryWindow = Pick<Window, 'addEventListener' | 'removeEventListener' | 'setTimeout'> & {
  history: Pick<History, 'state' | 'pushState' | 'back'>;
};

function hasMark(win: HistoryWindow): boolean {
  const state = win.history.state as Record<string, unknown> | null;
  return Boolean(state && state[MARK]);
}

/** The effect body, separate from React so it can be tested with a fake window. */
export function bindCloseOnBack(win: HistoryWindow, onClose: () => void): () => void {
  openSheets += 1;
  if (!hasMark(win)) {
    const state = (win.history.state as Record<string, unknown> | null) ?? {};
    win.history.pushState({ ...state, [MARK]: true }, '');
  }

  const onPopState = () => {
    if (!hasMark(win)) onClose();
  };
  win.addEventListener('popstate', onPopState);

  return () => {
    win.removeEventListener('popstate', onPopState);
    openSheets -= 1;
    win.setTimeout(() => {
      if (openSheets === 0 && hasMark(win)) win.history.back();
    }, 0);
  };
}

export function useCloseOnBack(onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => bindCloseOnBack(window, () => onCloseRef.current()), []);
}
