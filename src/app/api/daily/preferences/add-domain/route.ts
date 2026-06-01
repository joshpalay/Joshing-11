import { NextRequest, NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getKnowledgeBase } from '@/server/db/queries/daily';
import { getDailyPreferences, updateDailyPreferences } from '@/server/db/queries/daily-preferences';

export const dynamic = 'force-dynamic';

function parseDomain(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const domain = (value as Record<string, unknown>).domain;
  return typeof domain === 'string' && domain.trim() ? domain.trim() : null;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const domain = parseDomain(await request.json().catch(() => null));
  if (!domain) {
    return NextResponse.json(
      { error: 'validation', message: 'domain is required' },
      { status: 400 },
    );
  }

  const [preferences, knowledgeBase] = await Promise.all([
    getDailyPreferences(session.userId),
    getKnowledgeBase(session.userId),
  ]);

  const knownDomains = knowledgeBase.map((entry) => entry.domain);
  const domainKey = domain.toLowerCase();
  const matched = knownDomains.find((d) => d.toLowerCase() === domainKey) ?? domain;

  // Custom mode: append the new domain (dedup, preserve order).
  // Random mode: switch to custom and seed with every opened territory the
  // user currently has, plus the new one. Preserves variety while honoring
  // their pick — see "i-think-i-want-synchronous-hanrahan" plan.
  let nextDomainMode: 'custom' | 'random' = preferences.domainMode;
  let nextSelected: string[];

  if (preferences.domainMode === 'custom') {
    const set = new Set(preferences.selectedDomains.map((d) => d.toLowerCase()));
    if (set.has(domainKey)) {
      nextSelected = preferences.selectedDomains;
    } else {
      nextSelected = [...preferences.selectedDomains, matched];
    }
  } else {
    nextDomainMode = 'custom';
    const seeded = new Map<string, string>();
    for (const d of knownDomains) {
      seeded.set(d.toLowerCase(), d);
    }
    seeded.set(domainKey, matched);
    nextSelected = [...seeded.values()];
  }

  const updated = await updateDailyPreferences(session.userId, {
    domainMode: nextDomainMode,
    selectedDomains: nextSelected,
  });

  return NextResponse.json({
    ok: true,
    domainMode: updated.domainMode,
    selectedDomains: updated.selectedDomains,
  });
}
