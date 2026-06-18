// Pure, UI-free logic for the "Add someone" lookup on the Friends hub. Kept
// out of the component so the result-state branches can be unit-tested without
// rendering (the hub lookup and the FriendsList empty-filter hand-off both
// import from here, so the classification stays in one place).
import type { RelationshipState } from '@/server/db/queries/friend-requests'

export type QueryClassification = 'empty' | 'handle' | 'phone' | 'name'

// Mirrors HANDLE_QUERY_PATTERN in src/server/db/queries/friend-search.ts:20
// (leading letter required) so the client classifies a query the same way the
// search endpoint will route it.
const HANDLE_QUERY_PATTERN = /^@?[a-z][a-z0-9_]{2,19}$/i

// Mirrors looksLikeUsMobileNumber in AddFriendInvite and the server-side
// isUsPhoneNumber: 10 digits, or 11 digits starting with a US country code.
function looksLikeUsPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '')
  return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'))
}

// Classify a typed lookup term. Handle is checked before phone to match the
// server's branch order (a bare digit string can't satisfy the handle pattern's
// leading-letter requirement, so the two never collide). Anything that is
// neither a handle nor a US number is treated as a free-text name — the search
// endpoint can't resolve those (stranger-by-name lookup is out of scope), so
// callers route them to the invite flow instead.
export function classifyQuery(value: string): QueryClassification {
  const trimmed = value.trim()
  if (!trimmed) return 'empty'
  if (HANDLE_QUERY_PATTERN.test(trimmed)) return 'handle'
  if (looksLikeUsPhone(trimmed)) return 'phone'
  return 'name'
}

// What the lookup should offer for a matched account, derived from the existing
// relationship. The match card delegates to AddFriendButton for the actual
// controls; this is the honest top-level summary the branches are tested on.
export type MatchStatus =
  | 'add' // not connected yet — offer to follow / follow back
  | 'pending' // we already have an outbound request — no duplicate send
  | 'respond' // they already asked us — approve / not now
  | 'connected' // already friends or following — no add action

export function describeMatchStatus(state: RelationshipState): MatchStatus {
  switch (state) {
    case 'none':
    case 'follows_you':
      return 'add'
    case 'pending_outbound':
      return 'pending'
    case 'pending_inbound':
      return 'respond'
    case 'friends':
    case 'following':
      return 'connected'
  }
}

// The five honest result states of the lookup, collapsed to one descriptor the
// component renders from (and the tests assert against).
export type AddSomeoneOutcome =
  | { kind: 'idle' } // nothing searched yet
  | { kind: 'searching' }
  | { kind: 'error' }
  | { kind: 'match'; status: MatchStatus }
  | { kind: 'no_match'; classification: QueryClassification }

export function resolveAddSomeoneOutcome(input: {
  query: string
  searching: boolean
  searched: boolean
  error: boolean
  match: { relationship: { state: RelationshipState } } | null
}): AddSomeoneOutcome {
  if (input.searching) return { kind: 'searching' }
  if (input.error) return { kind: 'error' }
  if (input.match) return { kind: 'match', status: describeMatchStatus(input.match.relationship.state) }
  if (input.searched) return { kind: 'no_match', classification: classifyQuery(input.query) }
  return { kind: 'idle' }
}

// Toast copy after a successful add, reflecting the state the POST returned.
// `auto_approved` means the request landed immediately (a public account); if we
// were following them back it's now a mutual friendship, otherwise a one-way
// follow. `created` means an approval-required request is now pending.
export function addSuccessToast(
  sentState: string | undefined,
  priorState: RelationshipState,
): string {
  if (sentState === 'auto_approved') {
    return priorState === 'follows_you' ? "You're now friends." : "You're now following."
  }
  return 'Request sent.'
}
