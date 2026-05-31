import { NextResponse } from 'next/server';

import { getSession } from '@/server/auth/session';
import { getAreaTopUpContext } from '@/server/db/queries/area-top-up';
import { filterTopUpSuggestions } from '@/server/area-top-up/rules';
import { proposeInterests, type CulturalAnchor, type WarmupAnswers } from '@/server/llm/interests';

// GET /api/declared-interests/top-up/suggestions
//
// Lazily generates area suggestions for the top-up prompt. Called when the
// modal opens (not on the daily-page eligibility check) so the LLM cost is
// only paid when a user actually engages. Reuses the onboarding
// proposeInterests() helper, seeding it with the user's stored cultural
// anchor and treating their existing declared interests as warm-up signal —
// this keeps birthYear server-side and avoids re-collecting warm-up answers.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const context = await getAreaTopUpContext(session.userId);
  if (!context) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Defensive: only spend an LLM call for users who are actually eligible.
  if (!context.eligible) return NextResponse.json({ suggestions: [] });

  // Treat the user's three existing interests as warm-up answers. proposeInterests
  // requires at least one non-empty answer to call the model; three domains give
  // it strong, personalised signal to extend from.
  const [first, second, third] = context.existing;
  const warmupAnswers: WarmupAnswers = {
    deepDive: first?.domain,
    hourLongTopic: second?.domain,
    anythingElse: third?.domain,
  };

  const culturalAnchor: CulturalAnchor | undefined = context.anchor
    ? {
        birthYear: context.anchor.birthYear,
        grewUpCountry: context.anchor.grewUpCountry,
        grewUpRegion: context.anchor.grewUpRegion ?? undefined,
      }
    : undefined;

  try {
    const proposed = await proposeInterests({ warmupAnswers, culturalAnchor });

    // Drop anything the user already has so we never suggest a duplicate.
    const suggestions = filterTopUpSuggestions(
      proposed,
      context.existing.map((interest) => interest.domain),
    );

    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json(
      { error: "We couldn't generate suggestions. Please try again." },
      { status: 500 },
    );
  }
}
