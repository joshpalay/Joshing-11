import { NextResponse } from 'next/server';
import { z } from 'zod';

import { MAX_INVITE_LINK_CATEGORIES, sanitizeInviteLinkCategories } from '@/lib/invite-links';
import { isTooBroadInterest } from '@/lib/knowledge/interest-specificity';
import { getSession } from '@/server/auth/session';
import { updateInviteLinkCategories } from '@/server/db/queries/invite-links';

export const dynamic = 'force-dynamic';

const categorySchema = z.union([
  z.string(),
  z.object({
    label: z.string(),
    broadCategory: z.string().nullable().optional(),
  }),
]);

const bodySchema = z.object({
  categories: z.array(categorySchema).min(1).max(MAX_INVITE_LINK_CATEGORIES),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ linkId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', message: `Choose 1–${MAX_INVITE_LINK_CATEGORIES} categories.` },
      { status: 400 },
    );
  }

  const categories = sanitizeInviteLinkCategories(parsed.data.categories);
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

  const { linkId } = await params;
  const result = await updateInviteLinkCategories(session.userId, linkId, categories);
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404 : 400;
    const message =
      result.error === 'not_found'
        ? 'That link is no longer available.'
        : 'Choose at least one category for this link.';
    return NextResponse.json({ error: result.error, message }, { status });
  }

  return NextResponse.json({ categories: result.categories });
}
