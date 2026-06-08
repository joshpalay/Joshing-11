import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { convergeDomain } from '@/server/knowledge/converge-domain';

// POST /api/knowledge/converge
//
// Given an already-specific category label (typed, expanded from a broad topic,
// or pre-seeded by a friend), return the candidates it converges onto: any
// existing canonical subcategory across the game it matches (exact or fuzzy),
// plus a "create new" fallback. Deterministic and DB-only — no LLM call, so the
// default maxDuration is fine (contrast /api/interests/expand which needs 30s
// for its Haiku expansion). Convergence is meant to run AFTER broad-topic
// expansion, on specific labels.
const bodySchema = z.object({
  label: z.string().trim().min(1).max(100),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Enter a topic (up to 100 characters).' },
      { status: 400 },
    );
  }

  const result = await convergeDomain(parsed.data.label);
  return NextResponse.json(result);
}
