'use client'

import { useSyncExternalStore } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

function hasMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
}

function subscribe(onChange: () => void): () => void {
  if (!hasMatchMedia()) return () => {}
  const query = window.matchMedia(QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function getSnapshot(): boolean {
  return hasMatchMedia() ? window.matchMedia(QUERY).matches : false
}

function getServerSnapshot(): boolean {
  return false
}

/**
 * Tracks the user's `prefers-reduced-motion` setting via the matchMedia store.
 * SSR-safe (returns false on the server) and live-updates if the OS preference
 * changes. Used to skip the swipe snap-back and collapse animations.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
