import { and, asc, eq, inArray, or } from 'drizzle-orm';

import { db, friendships, users } from '@/server/db';

export type User = typeof users.$inferSelect;
export type Friendship = typeof friendships.$inferSelect;

export async function getFriends(userId: string): Promise<User[]> {
  const rows = await db
    .select({ userAId: friendships.userAId, userBId: friendships.userBId })
    .from(friendships)
    .where(and(
      eq(friendships.status, 'active'),
      or(eq(friendships.userAId, userId), eq(friendships.userBId, userId)),
    ));
  const friendIds = rows.map((friendship) => (
    friendship.userAId === userId ? friendship.userBId : friendship.userAId
  ));
  if (friendIds.length === 0) return [];

  return db
    .select()
    .from(users)
    .where(inArray(users.id, friendIds))
    .orderBy(asc(users.displayName), asc(users.phoneNumber));
}

export async function getFriendship(userAId: string, userBId: string): Promise<Friendship | null> {
  const [friendship] = await db
    .select()
    .from(friendships)
    .where(or(
      and(eq(friendships.userAId, userAId), eq(friendships.userBId, userBId)),
      and(eq(friendships.userAId, userBId), eq(friendships.userBId, userAId)),
    ))
    .limit(1);

  return friendship ?? null;
}

export async function areFriends(userAId: string, userBId: string): Promise<boolean> {
  if (userAId === userBId) return false;
  const friendship = await getFriendship(userAId, userBId);
  return friendship?.status === 'active';
}
