'use client';

import { useEffect, useState } from 'react';

// The floating "+" (Nav.tsx) is universal chrome (D-FRIENDS-RESTRUCTURE-01), but
// at phone width it sat on top of the delete-account DELETE field and other
// inline confirms (QA 2026-09-26 N21, 2026-09-27 N26). It steps aside while the
// player is typing in a field, or while a confirm panel marked `data-hide-fab`
// is on the page — both moments when "create something" isn't what they want.

const TEXT_INPUT_TYPES = new Set([
  '',
  'text',
  'search',
  'tel',
  'email',
  'url',
  'password',
  'number',
]);

type FocusLike = {
  tagName: string;
  isContentEditable?: boolean;
  getAttribute(name: string): string | null;
  closest(selector: string): unknown;
};

function isEditable(element: FocusLike | null): boolean {
  if (!element) return false;
  if (element.closest('[data-app-chrome]')) return false;
  const tag = element.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    return TEXT_INPUT_TYPES.has((element.getAttribute('type') ?? '').toLowerCase());
  }
  return element.isContentEditable === true;
}

type DocLike = { querySelector(selector: string): unknown; activeElement: FocusLike | null };

export function shouldSuppressFab(doc: DocLike): boolean {
  if (doc.querySelector('[data-hide-fab]')) return true;
  return isEditable(doc.activeElement);
}

export function useFabSuppressed(): boolean {
  const [suppressed, setSuppressed] = useState(false);

  useEffect(() => {
    const update = () => setSuppressed(shouldSuppressFab(document));
    // focusout fires before focus lands on the next element; re-check after it.
    const updateSoon = () => window.setTimeout(update, 0);

    document.addEventListener('focusin', update);
    document.addEventListener('focusout', updateSoon);
    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-hide-fab'],
    });
    update();

    return () => {
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', updateSoon);
      observer.disconnect();
    };
  }, []);

  return suppressed;
}
