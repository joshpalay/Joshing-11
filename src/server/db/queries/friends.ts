import { and, eq, or } from 'drizzle-orm';

import { db, friendships, users } from '@/server/db';

export type User = typeof users.$inferSelect;
export type Friendship = typeof friendships.$inferSelect;

export async function getFriends(userId: string): Promise<User[]> {
  const rows = await db
    .select({ user: users })
    .from(friendships)
    .innerJoin(
      users,
      or(
        and(eq(friendships.userAId, userId), eq(users.id, friendships.userBId)),
        and(eq(friendships.userBId, userId), eq(users.id, friendships.userAId)),
      ),
    )
    .where(and(
      eq(friendships.status, 'active'),
      or(eq(friendships.userAId, userId), eq(friendships.userBId, userId)),
    ));

  return rows.map((row) => row.user);
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
