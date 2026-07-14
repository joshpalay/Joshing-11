import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { db, userDomainExclusions } from '@/server/db';

export const dynamic = 'force-dynamic';

// D-DOMAIN-REST-01: how long a "Rest a topic" pause lasts before the domain
// returns to circulation on its own. Env-tunable (adjust without a redeploy);
// defaults to 21 days. The window is decided SERVER-SIDE so a client can't set
// its own expiry — the request only signals `rest: true`.
export function getDomainRestDays(): number {
  const raw = Number(process.env.DOMAIN_REST_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : 21;
}

const exclusionPayloadSchema = z.object({
  canonical_subcategory: z
    .string()
    .trim()
    .min(1)
    .transform((value) => value.replace(/\s+/g, ' ')),
  scope: z.enum(['subcategory', 'broad_category', 'category']).default('subcategory'),
  // When true, this is a temporary Rest (auto-expires after DOMAIN_REST_DAYS)
  // rather than a permanent Mute/"Never appear". Optional + defaults false so
  // existing callers (settings, refine/commit) keep writing permanent rows.
  rest: z.boolean().default(false),
});

async function parsePayload(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = exclusionPayloadSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const payload = await parsePayload(request);
  if (!payload) {
    return NextResponse.json(
      { error: 'validation', message: 'canonical_subcategory is required' },
      { status: 400 },
    );
  }

  // A Rest sets an expiry DOMAIN_REST_DAYS out; a permanent mute leaves it NULL.
  // On conflict we UPDATE rest_until (not DoNothing) so re-resting refreshes the
  // clock, and choosing Rest over an existing permanent mute (or vice versa)
  // switches the row's kind rather than silently keeping the old one.
  const restUntil = payload.rest
    ? new Date(Date.now() + getDomainRestDays() * 24 * 60 * 60 * 1000)
    : null;

  await db
    .insert(userDomainExclusions)
    .values({
      userId: session.userId,
      canonicalSubcategory: payload.canonical_subcategory,
      scope: payload.scope,
      restUntil,
    })
    .onConflictDoUpdate({
      target: [
        userDomainExclusions.userId,
        userDomainExclusions.scope,
        userDomainExclusions.canonicalSubcategory,
      ],
      set: { restUntil },
    });

  return NextResponse.json({ ok: true, restUntil });
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const payload = await parsePayload(request);
  if (!payload) {
    return NextResponse.json(
      { error: 'validation', message: 'canonical_subcategory is required' },
      { status: 400 },
    );
  }

  await db
    .delete(userDomainExclusions)
    .where(and(
      eq(userDomainExclusions.userId, session.userId),
      eq(userDomainExclusions.scope, payload.scope),
      eq(userDomainExclusions.canonicalSubcategory, payload.canonical_subcategory),
    ));

  return NextResponse.json({ ok: true });
}
