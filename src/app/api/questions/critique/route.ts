import { and, eq, sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { db, critiqueUsageDaily } from '@/server/db';
import { critiqueQuestion } from '@/server/llm/critique';

export const dynamic = 'force-dynamic';

const DAILY_LIMIT = 5;

const bodySchema = z.object({ questionText: z.string().optional().catch(undefined) });

type CritiqueResponse = {
  ok: boolean;
  issues?: string[];
  reformulations?: string[];
  limitReached: boolean;
  remaining: number | null;
};

function utcDateString(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function passResponse(extra: Partial<CritiqueResponse> = {}): CritiqueResponse {
  return { ok: true, limitReached: false, remaining: null, ...extra };
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    const questionText = parsed.success && typeof parsed.data.questionText === 'string'
      ? parsed.data.questionText.trim()
      : '';
    if (!questionText) return NextResponse.json(passResponse({ remaining: null }));

    const usageDate = utcDateString();
    const [usage] = await db
      .select({ critiqueCount: critiqueUsageDaily.critiqueCount })
      .from(critiqueUsageDaily)
      .where(and(eq(critiqueUsageDaily.userId, session.userId), eq(critiqueUsageDaily.usageDate, usageDate)))
      .limit(1);

    if ((usage?.critiqueCount ?? 0) >= DAILY_LIMIT) {
      return NextResponse.json(passResponse({ limitReached: true, remaining: 0 }));
    }

    const critiqueResult = await critiqueQuestion({ questionText });

    const rows = await db.execute<{ critique_count: number }>(sql`
      INSERT INTO "CritiqueUsageDaily" ("user_id", "usage_date", "critique_count", "updated_at")
      VALUES (${session.userId}, ${usageDate}::date, 1, now())
      ON CONFLICT ("user_id", "usage_date") DO UPDATE
      SET "critique_count" = "CritiqueUsageDaily"."critique_count" + 1,
          "updated_at" = now()
      WHERE "CritiqueUsageDaily"."critique_count" < ${DAILY_LIMIT}
      RETURNING "critique_count"
    `);
    const incremented = Array.isArray(rows) ? rows[0] : rows.rows?.[0];
    if (!incremented) {
      return NextResponse.json(passResponse({ limitReached: true, remaining: 0 }));
    }

    const newCount = Number(incremented.critique_count ?? DAILY_LIMIT);
    return NextResponse.json({
      ...critiqueResult,
      limitReached: false,
      remaining: Math.max(DAILY_LIMIT - newCount, 0),
    } satisfies CritiqueResponse);
  } catch (error) {
    console.warn('[api/questions/critique] fail_open', error);
    return NextResponse.json(passResponse());
  }
}
