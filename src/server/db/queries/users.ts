import type { Prisma, User } from '@prisma/client';
import { and, desc, eq, isNotNull } from 'drizzle-orm';

import { prisma } from '@/lib/prisma';
import { db, declaredInterests, friendInvitations, users } from '@/server/db';

export type DeclaredInterestInput = {
  label: string;
  description?: string | null;
  broadCategory?: string | null;
};

export type PreSeededInterest = {
  label: string;
  description?: string | null;
  broadCategory?: string | null;
};

function normalizeDeclaredInterest(interest: DeclaredInterestInput): DeclaredInterestInput | null {
  const label = interest.label.trim().replace(/\s+/g, ' ');
  if (!label) return null;

  return {
    label: label.slice(0, 80),
    description: interest.description?.trim() ? interest.description.trim().slice(0, 180) : null,
    broadCategory: interest.broadCategory?.trim() ? interest.broadCategory.trim().slice(0, 80) : null,
  };
}

function normalizeDeclaredInterests(interests: DeclaredInterestInput[]): DeclaredInterestInput[] {
  const seen = new Set<string>();
  const normalized: DeclaredInterestInput[] = [];

  for (const interest of interests) {
    const clean = normalizeDeclaredInterest(interest);
    if (!clean) continue;

    const key = clean.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(clean);
  }

  return normalized;
}

function parsePreSeededInterests(value: unknown): PreSeededInterest[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (typeof item === 'string') {
      const label = item.trim();
      return label ? [{ label }] : [];
    }

    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const label = typeof record.label === 'string' ? record.label.trim() : '';
    if (!label) return [];

    return [{
      label,
      description: typeof record.description === 'string' ? record.description.trim() : null,
      broadCategory:
        typeof record.broadCategory === 'string'
          ? record.broadCategory.trim()
          : typeof record.broad_category === 'string'
            ? record.broad_category.trim()
            : null,
    }];
  }).slice(0, 3);
}

export function getUserByPhone(phone: string) {
  return prisma.user.findUnique({
    where: { phone_number: phone },
  });
}

export function getUserById(id: string) {
  return prisma.user.findUnique({
    where: { id },
  });
}

export function createUser(phone: string) {
  return prisma.user.create({
    data: {
      phone_number: phone,
      phone_verified: true,
    },
  });
}

export function updateUser(id: string, data: Partial<User>) {
  return prisma.user.update({
    where: { id },
    data: data as Prisma.UserUpdateInput,
  });
}

export async function saveDeclaredInterests(userId: string, interests: DeclaredInterestInput[]) {
  const normalized = normalizeDeclaredInterests(interests);

  if (normalized.length > 5) {
    throw new Error('A player can have at most 5 active declared interests.');
  }

  await db.transaction(async (tx) => {
    await tx
      .update(declaredInterests)
      .set({ isActive: false })
      .where(eq(declaredInterests.userId, userId));

    for (const interest of normalized) {
      await tx
        .insert(declaredInterests)
        .values({
          userId,
          domain: interest.label,
          broadCategory: interest.broadCategory ?? null,
          declaredAt: new Date(),
          isActive: true,
        })
        .onConflictDoUpdate({
          target: [declaredInterests.userId, declaredInterests.domain],
          set: {
            broadCategory: interest.broadCategory ?? null,
            declaredAt: new Date(),
            isActive: true,
          },
        });
    }
  });

  return normalized;
}

export async function markOnboardingComplete(userId: string) {
  await db
    .update(users)
    .set({ onboardingComplete: true, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function getUserOnboardingProfile(userId: string) {
  const [user] = await db
    .select({
      id: users.id,
      phoneNumber: users.phoneNumber,
      displayName: users.displayName,
      timezone: users.timezone,
      preferredTheme: users.preferredTheme,
      onboardingComplete: users.onboardingComplete,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return user ?? null;
}

export async function getPreSeededInterestsForUser(userId: string): Promise<PreSeededInterest[]> {
  const [invitation] = await db
    .select({ preSeededInterests: friendInvitations.preSeededInterests })
    .from(friendInvitations)
    .where(and(eq(friendInvitations.inviteeUserId, userId), isNotNull(friendInvitations.acceptedAt)))
    .orderBy(desc(friendInvitations.acceptedAt))
    .limit(1);

  return parsePreSeededInterests(invitation?.preSeededInterests);
}
