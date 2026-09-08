import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { db, users } from '@/server/db';
import { createInviteLink, listLiveInviteLinks } from '@/server/db/queries/invite-links';
import {
  inviteLinkCardTitle,
  MAX_INVITE_LINK_CATEGORIES,
  MAX_INVITE_LINK_TITLE_LENGTH,
  sanitizeInviteLinkCategories,
  sanitizeInviteLinkTitle,
} from '@/lib/invite-links';
import { isTooBroadInterest } from '@/lib/knowledge/interest-specificity';
import {
  buildInviteUrl,
  getBaseUrl,
  getInviteLinkSeedTopics,
} from '@/server/friends/user-invite-token';

export const dynamic = 'force-dynamic';

const CREATE_ERROR_COPY: Record<string, { status: number; message: string }> = {
  limit_reached: { status: 409, message: 'You already have 3 links. Delete one to make another.' },
  invalid_categories: { status: 400, message: 'Choose at least one category for this link.' },
  invalid_title: { status: 400, message: 'Add a title for this link.' },
};

async function requireHandle(userId: string, request: Request) {
  const [row] = await db
    .select({ handle: users.handle })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row?.handle) return null;
  const baseUrl = getBaseUrl(request);
  return { handle: row.handle, baseUrl };
}

// Lists the caller's live invite links, each with its share URL and current
// join count.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const identity = await requireHandle(session.userId, request);
  if (!identity) {
    return NextResponse.json(
      {
        error: 'handle_required',
        message: 'Set a handle in your profile before generating an invite link.',
      },
      { status: 409 },
    );
  }

  const links = await listLiveInviteLinks(session.userId);
  const resolvedLinks = await Promise.all(
    links.map(async (link) => ({
      ...link,
      categories: link.categories ?? (await getInviteLinkSeedTopics(session.userId, link.slot)),
    })),
  );
  return NextResponse.json({
    links: resolvedLinks.map((link) => ({
      id: link.id,
      slot: link.slot,
      title: inviteLinkCardTitle(link.title),
      categories: sanitizeInviteLinkCategories(link.categories),
      url: buildInviteUrl(identity.baseUrl, identity.handle, link.token),
      createdAt: link.createdAt.toISOString(),
      joinedCount: link.joinedCount,
    })),
  });
}

const categorySchema = z.union([
  z.string(),
  z.object({
    label: z.string(),
    broadCategory: z.string().nullable().optional(),
  }),
]);

const bodySchema = z.object({
  title: z.string().min(1).max(MAX_INVITE_LINK_TITLE_LENGTH),
  categories: z.array(categorySchema).min(1).max(MAX_INVITE_LINK_CATEGORIES),
});

// Creates a new live link with its own exact category set, capped at 3 live
// links and 3 categories per link.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const identity = await requireHandle(session.userId, request);
  if (!identity) {
    return NextResponse.json(
      {
        error: 'handle_required',
        message: 'Set a handle in your profile before generating an invite link.',
      },
      { status: 409 },
    );
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', message: `Choose 1–${MAX_INVITE_LINK_CATEGORIES} categories.` },
      { status: 400 },
    );
  }

  const categories = sanitizeInviteLinkCategories(parsed.data.categories);
  const title = sanitizeInviteLinkTitle(parsed.data.title);
  if (!title) {
    return NextResponse.json(
      { error: 'invalid_title', message: 'Add a title for this link.' },
      { status: 400 },
    );
  }
  if (categories.length !== parsed.data.categories.length || categories.length === 0) {
    return NextResponse.json(
      { error: 'invalid_categories', message: 'Choose at least one valid category for this link.' },
      { status: 400 },
    );
  }
  const tooBroad = categories.find((category) => isTooBroadInterest(category.label));
  if (tooBroad) {
    return NextResponse.json(
      {
        error: 'too_broad',
        message: `“${tooBroad.label}” is too broad — try something more specific.`,
      },
      { status: 400 },
    );
  }

  const result = await createInviteLink(session.userId, title, categories);
  if (!result.ok) {
    const copy = CREATE_ERROR_COPY[result.error];
    return NextResponse.json(
      { error: result.error, message: copy.message },
      { status: copy.status },
    );
  }

  return NextResponse.json({
    link: {
      id: result.link.id,
      slot: result.link.slot,
      title: inviteLinkCardTitle(result.link.title),
      categories: result.link.categories ?? [],
      url: buildInviteUrl(identity.baseUrl, identity.handle, result.link.token),
      createdAt: result.link.createdAt.toISOString(),
      joinedCount: result.link.joinedCount,
    },
  });
}
