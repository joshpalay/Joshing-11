/**
 * Refine Your Game — copy generation (pure).
 *
 * Each item answers "why am I seeing this now?" with fresh evidence, then asks
 * for the single decision. The doing-nothing default is always the safe status
 * quo, so the prose frames the action as the change away from it.
 */

import type { RefineCandidate } from './types';

/**
 * Inactivity nudge copy. This item is global (no subdomain) and navigational, so
 * its text is fixed rather than evidence-templated. resolvedText is never shown —
 * tapping it links out to /daily/setup — but it's kept for switch exhaustiveness.
 */
export const ADD_TERRITORIES_OPEN_TEXT =
  "You haven't added anything new in a while. Want to add some categories to your game?";
export const ADD_TERRITORIES_RESOLVED_TEXT = 'Opening your categories…';

/**
 * Human-readable subdomain phrase for prose. Replaces separators and collapses
 * whitespace but preserves the source casing so proper nouns ("Sondheim") and
 * snake_case domains ("subprime_mortgage" → "subprime mortgage") both read well.
 */
export function subdomainLabel(domain: string): string {
  return domain.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Evidence + the decision question, shown in the open state. */
export function openText(candidate: RefineCandidate): string {
  const label = candidate.subdomainLabel;
  switch (candidate.type) {
    case 'friend_expansion': {
      const friend = candidate.friendName?.trim() || 'a friend';
      return `You got a ${label} question from ${friend}'s world right. Add it to your rotation?`;
    }
    case 'difficulty_escalation':
      return `You're mastering ${label}, so its questions are getting harder. Ease off?`;
    case 'struggle_pruning':
      return `You've missed the last ${candidate.missCount ?? 0} ${label} questions. Rest them for now?`;
    case 'add_territories':
      return ADD_TERRITORIES_OPEN_TEXT;
  }
}

/** The choice restated as a completed fact, shown in the resolved state. */
export function resolvedText(candidate: RefineCandidate): string {
  const label = candidate.subdomainLabel;
  switch (candidate.type) {
    case 'friend_expansion':
      return `Added ${label} to your rotation.`;
    case 'difficulty_escalation':
      return `We'll keep ${label} at this level for the next month.`;
    case 'struggle_pruning':
      return `Moving ${label} to Never for now — it won't be asked.`;
    case 'add_territories':
      return ADD_TERRITORIES_RESOLVED_TEXT;
  }
}
