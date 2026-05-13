import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { isUsPhoneNumber, normalizePhone } from '@/server/auth';
import { getSession } from '@/server/auth/session';
import { db, friendInvitations, users } from '@/server/db';
import { createFriendInvitation } from '@/server/friends/invitations';
import { createOrReusePendingFriendshipRequest } from '@/server/friends/friendships';

export const dynamic = 'force-dynamic';

const MAX_INVITEE_DISPLAY_NAME_LENGTH = 80;
const MAX_SUGGESTED_INTERESTS = 3;
const MAX_SUGGESTED_INTEREST_LENGTH = 80;

type CreateFriendInvitationBody = {
  inviteeDisplayName: string;
  phone: string;
  suggestedInterests: string[];
};

type ValidationResult =
  | { ok: true; value: CreateFriendInvitationBody }
  | { ok: false; status: number; error: string; message: string };

function getBaseUrl(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL;
  if (configured) return configured.replace(/\/$/, '');

  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const protocol = request.headers.get('x-forwarded-proto') ?? 'https';
  return host ? `${protocol}://${host}` : new URL(request.url).origin;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function validateCreateFriendInvitationBody(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      status: 400,
      error: 'invalid_request',
      message: 'Request body is required.',
    };
  }

  const record = body as Record<string, unknown>;
  const inviteeDisplayName =
    typeof record.inviteeDisplayName === 'string'
      ? normalizeText(record.inviteeDisplayName)
      : '';

  if (!inviteeDisplayName) {
    return {
      ok: false,
      status: 400,
      error: 'missing_invitee_display_name',
      message: 'inviteeDisplayName is required.',
    };
  }

  if (inviteeDisplayName.length > MAX_INVITEE_DISPLAY_NAME_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: 'invalid_invitee_display_name',
      message: `inviteeDisplayName must be ${MAX_INVITEE_DISPLAY_NAME_LENGTH} characters or fewer.`,
    };
  }

  const rawPhone = typeof record.phone === 'string' ? record.phone.trim() : '';
  if (!rawPhone || !isUsPhoneNumber(rawPhone)) {
    return {
      ok: false,
      status: 400,
      error: 'invalid_phone',
      message: 'US phone number required.',
    };
  }

  if (
    record.suggestedInterests !== undefined &&
    (!Array.isArray(record.suggestedInterests) ||
      !record.suggestedInterests.every((interest) => typeof interest === 'string'))
  ) {
    return {
      ok: false,
      status: 400,
      error: 'invalid_suggested_interests',
      message: 'suggestedInterests must be an array of strings.',
    };
  }

  const seen = new Set<string>();
  const suggestedInterests: string[] = [];
  for (const interest of (record.suggestedInterests ?? []) as string[]) {
    const normalizedInterest = normalizeText(interest);
    if (!normalizedInterest) continue;

    if (normalizedInterest.length > MAX_SUGGESTED_INTEREST_LENGTH) {
      return {
        ok: false,
        status: 400,
        error: 'invalid_suggested_interests',
        message: `Each suggested interest must be ${MAX_SUGGESTED_INTEREST_LENGTH} characters or fewer.`,
      };
    }

    const dedupeKey = normalizedInterest.toLocaleLowerCase('en-US');
    if (seen.has(dedupeKey)) continue;

    seen.add(dedupeKey);
    suggestedInterests.push(normalizedInterest);
  }

  if (suggestedInterests.length > MAX_SUGGESTED_INTERESTS) {
    return {
      ok: false,
      status: 400,
      error: 'too_many_suggested_interests',
      message: `suggestedInterests must contain ${MAX_SUGGESTED_INTERESTS} or fewer values.`,
    };
  }

  return {
    ok: true,
    value: {
      inviteeDisplayName,
      phone: normalizePhone(rawPhone),
      suggestedInterests,
    },
  };
}

export function buildFriendInvitationMessage({
  inviteUrl,
  suggestedInterests,
}: {
  inviteUrl: string;
  suggestedInterests: string[];
}): string {
  if (suggestedInterests.length === 1) {
    return `Hey — come play Joshing with me. I added something I think you might like: ${suggestedInterests[0]}. No app to download — just tap this: ${inviteUrl}`;
  }

  if (suggestedInterests.length === 2) {
    return `Hey — come play Joshing with me. I added a couple areas I think you might like: ${suggestedInterests[0]} and ${suggestedInterests[1]}. No app to download — just tap this: ${inviteUrl}`;
  }

  if (suggestedInterests.length === 3) {
    return `Hey — come play Joshing with me. I added a few areas I think you might like: ${suggestedInterests[0]}, ${suggestedInterests[1]}, and ${suggestedInterests[2]}. No app to download — just tap this: ${inviteUrl}`;
  }

  return `Hey — come play Joshing with me. No app to download — just tap this: ${inviteUrl}`;
}

async function getUserByPhone(phone: string) {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.phoneNumber, phone))
    .limit(1);

  return user ?? null;
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = validateCreateFriendInvitationBody(await request.json().catch(() => null));
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.error, message: parsed.message },
      { status: parsed.status },
    );
  }

  try {
    const { inviteeDisplayName, phone, suggestedInterests } = parsed.value;
    const existingUser = await getUserByPhone(phone);

    if (existingUser) {
      if (existingUser.id === session.userId) {
        return NextResponse.json(
          { error: 'self_invite', message: 'You cannot invite yourself.' },
          { status: 400 },
        );
      }

      const { friendship: friendshipRequest, state } = await createOrReusePendingFriendshipRequest({
        inviterUserId: session.userId,
        inviteeUserId: existingUser.id,
        suggestedInterests,
      });

      return NextResponse.json({
        ok: true,
        type: 'friendship_request',
        state,
        id: friendshipRequest.id,
        invitationId: null,
        inviteUrl: null,
        message: null,
        inviteeDisplayName,
        inviteePhone: phone,
        suggestedInterests,
        expiresAt: null,
        friendshipRequest: {
          id: friendshipRequest.id,
          status: friendshipRequest.status,
          state,
          inviteeUserId: existingUser.id,
        },
      });
    }

    const invitation = await createFriendInvitation({
      inviterUserId: session.userId,
      inviteePhone: phone,
      inviteeDisplayName,
      preSeededInterests: suggestedInterests,
    });

    const inviteUrl = `${getBaseUrl(request)}/invite/${invitation.token}`;
    const message = buildFriendInvitationMessage({ inviteUrl, suggestedInterests });

    if (invitation.personalMessage !== message) {
      await db
        .update(friendInvitations)
        .set({ personalMessage: message })
        .where(eq(friendInvitations.id, invitation.id));
    }

    return NextResponse.json({
      ok: true,
      type: 'friend_invitation',
      id: invitation.id,
      invitationId: invitation.id,
      inviteUrl,
      message,
      inviteeDisplayName: invitation.inviteeDisplayName ?? inviteeDisplayName,
      inviteePhone: invitation.inviteePhone,
      suggestedInterests,
      expiresAt: invitation.expiresAt.toISOString(),
    });
  } catch (error) {
    console.error('[friend-invitations] create failed', error);
    return NextResponse.json(
      { error: 'server_error', message: 'Unable to create friend invitation.' },
      { status: 500 },
    );
  }
}
