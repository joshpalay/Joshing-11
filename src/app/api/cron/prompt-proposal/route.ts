import { NextRequest, NextResponse } from 'next/server';

import { isCronAuthorized } from '@/server/auth/cron';
import { buildPromptProposals } from '@/server/quality/prompt-proposer';

export const dynamic = 'force-dynamic';
// One Sonnet call over the aggregation; mirror the report routes' headroom.
export const maxDuration = 120;

// B-QUESTION-QUALITY-AGENTS-01 Phase 5 — the prompt-diff proposer. PROPOSAL ONLY.
// Deliberately NOT on a vercel.json schedule: proposals are for human review and
// shouldn't auto-spend weekly. The owner triggers it on demand (same cron auth) to
// get a fresh artifact; it reads the LIVE generation prompt, emits markdown diffs
// against the above-floor clusters, and writes NOTHING to any prompt file.
const WINDOW_DAYS = 30;

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const { markdown, clusters, usedLlm } = await buildPromptProposals(WINDOW_DAYS);
    // The markdown IS the artifact (returned for the owner to review). Also logged
    // so it's retrievable from runtime logs without a UI.
    console.info('[prompt-proposal] generated', { clusters, usedLlm });
    return NextResponse.json({ clusters, usedLlm, markdown });
  } catch (error) {
    console.error('[prompt-proposal] failed', error);
    return NextResponse.json({ error: 'proposal_failed' }, { status: 500 });
  }
}
