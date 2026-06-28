import { isNull, sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { db, generatedQuestions } from '@/server/db';
import { domainKey } from '@/lib/knowledge/domain-key';
import { isCronAuthorized } from '@/server/auth/cron';

export const dynamic = 'force-dynamic';

// TS backfill for GeneratedQuestion.domain_key (migration 0074, BP-7 / C5):
// populate the column with the domainKey() fold of canonical_subcategory. The
// fold is TS-only by design (replicating it in SQL would be a second
// implementation that can drift), so the backfill runs here rather than in the
// migration or a boot guard. pickBankSource also has a legacy exact-string
// fallback, so a stale/NULL key never breaks matching — it just misses the
// cross-spelling variant hits the column exists to enable.
//
// Two modes:
//   default  — fill only rows where domain_key IS NULL (the original 0074 backfill).
//   ?full=1  — RECOMPUTE every row's key. Run this once after the domainKey()
//              fold is strengthened (e.g. the colon/dash/& connector fold), so
//              previously-stored keys pick up the new variant merges.
//
// Run (cron-authorized): curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
//   "$BASE_URL/api/admin/backfill-domain-keys?full=1"
export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const full = request.nextUrl.searchParams.get('full') === '1';

  const spellings = await db
    .selectDistinct({ canonicalSubcategory: generatedQuestions.canonicalSubcategory })
    .from(generatedQuestions)
    .where(full ? sql`canonical_subcategory IS NOT NULL` : isNull(generatedQuestions.domainKey));

  let rowsUpdated = 0;
  for (const { canonicalSubcategory } of spellings) {
    if (!canonicalSubcategory) continue;
    const folded = domainKey(canonicalSubcategory);
    // In full mode, only touch rows whose key actually changes (idempotent
    // re-runs are free); in fill mode, only the NULL rows as before.
    const guard = full
      ? sql`${generatedQuestions.canonicalSubcategory} = ${canonicalSubcategory} AND ${generatedQuestions.domainKey} IS DISTINCT FROM ${folded}`
      : sql`${generatedQuestions.canonicalSubcategory} = ${canonicalSubcategory} AND ${generatedQuestions.domainKey} IS NULL`;
    const result = await db.update(generatedQuestions).set({ domainKey: folded }).where(guard);
    rowsUpdated += (result as { rowCount?: number }).rowCount ?? 0;
  }

  return NextResponse.json({
    mode: full ? 'full-recompute' : 'fill-null',
    distinctSpellings: spellings.length,
    rowsUpdated,
  });
}
