// F8 (2026-09-10 audit) — the single display-name resolver for surfaces that
// show one user's name to ANOTHER user (friends hub, adjacent /api/users*
// lookups, friend/mutual-friend profile rows). Several of these independently
// fell back to the raw phone number when displayName was empty, which could
// reach a client response body or a rendered row for a legacy/nameless
// account. Precedence: display name -> username -> a neutral generic
// fallback. The phone number never appears here, at any precedence step.
//
// This intentionally does NOT cover src/server/db/queries/account.ts's
// getUserProfile/getEditableProfile, which show a user their OWN phone
// number as part of the same payload (self-view, not a leak to someone
// else) and already use a different, deliberately phone-derived fallback
// ("Player 1234") for that self-view context. Left as-is — see the F8
// report for why that pattern is out of scope here.
const GENERIC_DISPLAY_NAME_FALLBACK = 'Joshing friend';

export function resolveDisplayName(user: {
  displayName?: string | null;
  handle?: string | null;
}): string {
  const name = user.displayName?.trim();
  if (name) return name;
  const handle = user.handle?.trim();
  if (handle) return `@${handle}`;
  return GENERIC_DISPLAY_NAME_FALLBACK;
}
