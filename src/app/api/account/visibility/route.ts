import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession } from '@/server/auth/session';
import { setSectionVisibility } from '@/server/profile/visibility';

export const dynamic = 'force-dynamic';

// Single chokepoint for per-section visibility writes. Validated against
// the same enum + tier values as the underlying PROFILE_SECTION_VISIBILITY
// table; the helper does the upsert.
const bodySchema = z.object({
  section: z.enum([
    'bio',
    'tagline',
    'location',
    'knowledge_map',
    'mind_expanding',
    'friends_list',
    'authored_questions',
  ]),
  visibility: z.enum(['public', 'friends', 'private']),
});

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', message: parsed.error.issues[0]?.message ?? 'Invalid request.' },
      { status: 400 },
    );
  }

  await setSectionVisibility(session.userId, parsed.data.section, parsed.data.visibility);
  return NextResponse.json({
    ok: true,
    section: parsed.data.section,
    visibility: parsed.data.visibility,
  });
}
