// Shared client logic for editing a still-pending friend invitation. Two
// surfaces let you fix a fat-fingered invite — the standalone "People you
// invited" card (PeopleYouInvited) and the Friends hub's "Waiting for Response"
// section (FriendsList) — so the PATCH call and its error copy live here to keep
// the two from drifting. The server contract is PATCH /api/friend-invitations
// (see src/app/api/friend-invitations/route.ts).

export const INVITE_EDIT_ERROR_COPY: Record<string, string> = {
  invalid_phone: 'Use a US mobile number.',
  too_many_suggested_interests: 'Choose up to three ideas.',
  missing_invitee_display_name: 'Add their name first.',
  invalid_invitee_display_name: 'Use a shorter, real display name.',
  invalid_suggested_interests: 'Keep each idea short and friendly.',
  already_on_joshing:
    'That number already belongs to someone on Joshing. Set this note aside and send them a friend request instead.',
  duplicate_pending: 'You already have a pending note out to that number.',
  self_invite: 'You cannot invite yourself.',
}

export type SaveInviteEditInput = {
  invitationId: string
  inviteeDisplayName: string
  phone: string
  suggestedInterests: string[]
}

export type SaveInviteEditResult = { ok: true } | { ok: false; message: string }

export async function saveInviteEdit(
  input: SaveInviteEditInput
): Promise<SaveInviteEditResult> {
  try {
    const response = await fetch('/api/friend-invitations', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(input),
    })
    const body = (await response.json().catch(() => null)) as {
      error?: string
      message?: string
    } | null

    if (!response.ok) {
      const apiError = body?.error
      return {
        ok: false,
        message:
          (apiError && INVITE_EDIT_ERROR_COPY[apiError]) ??
          body?.message ??
          'Could not save your changes.',
      }
    }

    return { ok: true }
  } catch {
    return { ok: false, message: 'Could not save your changes.' }
  }
}
