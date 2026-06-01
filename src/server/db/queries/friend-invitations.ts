import { sql } from 'drizzle-orm';

import { db } from '@/server/db';
import { getRelationships, type RelationshipResult } from '@/server/db/queries/friend-requests';

export type InviteReflection = {
  invitationId: string;
  inviteeUserId: string;
  handle: string | null;
  displayName: string | null;
  avatarColor: string | null;
  joinedAt: Date;
  invitedAt: Date;
  acceptedAt: Date | null;
  relationship: RelationshipResult;
};

// Lists users that this player previously invited (via the SMS-style
// FriendInvitation flow) who have since joined Joshing AND don't already
// have an active or pending Friendship with the player. Used by the Find
// Friends page Block 3 ("here are people you nudged who showed up").
//
// Filters out blocked rows (isBlocked === true from getRelationships).
export async function listInviteReflections(
  userId: string,
  limit = 20,
): Promise<InviteReflection[]> {
  const rows = await db.execute<{
    invitation_id: string;
    invitee_user_id: string;
    handle: string | null;
    display_name: string | null;
    avatar_color: string | null;
    joined_at: Date;
    invited_at: Date;
    accepted_at: Date | null;
  }>(sql`
    SELECT
      fi."id"             AS invitation_id,
      fi."inviteeUserId"  AS invitee_user_id,
      u."handle"          AS handle,
      u."display_name"    AS display_name,
      u."avatar_color"    AS avatar_color,
      u."created_at"      AS joined_at,
      fi."sentAt"         AS invited_at,
      fi."acceptedAt"     AS accepted_at
    FROM "FriendInvitation" fi
    JOIN "User" u ON u."id" = fi."inviteeUserId"
    WHERE fi."inviterUserId" = ${userId}
      AND fi."inviteeUserId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "Friendship" f
        WHERE f."status" IN ('active', 'pending')
          AND (
            (f."userAId" = ${userId} AND f."userBId" = u."id")
            OR (f."userAId" = u."id" AND f."userBId" = ${userId})
          )
      )
    ORDER BY u."created_at" DESC
    LIMIT ${limit}
  `);

  if (rows.rows.length === 0) return [];

  const inviteeIds = rows.rows.map((row) => row.invitee_user_id);
  const relationships = await getRelationships(userId, inviteeIds);

  const result: InviteReflection[] = [];
  for (const row of rows.rows) {
    const relationship = relationships.get(row.invitee_user_id);
    if (!relationship || relationship.isBlocked) continue;
    result.push({
      invitationId: row.invitation_id,
      inviteeUserId: row.invitee_user_id,
      handle: row.handle,
      displayName: row.display_name,
      avatarColor: row.avatar_color,
      joinedAt: new Date(row.joined_at),
      invitedAt: new Date(row.invited_at),
      acceptedAt: row.accepted_at ? new Date(row.accepted_at) : null,
      relationship,
    });
  }
  return result;
}
