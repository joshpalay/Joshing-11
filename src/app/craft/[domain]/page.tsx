import { notFound, redirect } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import { hasActiveInvitation } from '@/server/db/queries/author-invitations';

import { PlayerCraftClient } from './PlayerCraftClient';

export const dynamic = 'force-dynamic';

// B-CRAFTER-LIFECYCLE-01 Phase 3 — the PLAYER creation surface. Reachable only
// with an ACTIVE author invitation for this exact domain (the manual checkbox a
// crafter flipped); anyone else gets 404, same don't-reveal posture as the
// admin surfaces. The surface itself is the SAME one the crafters use — the
// player just became a contributor.
export default async function PlayerCraftPage({
  params,
}: {
  params: Promise<{ domain: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/login');

  const { domain: rawDomain } = await params;
  const domain = decodeURIComponent(rawDomain);

  const invited = await hasActiveInvitation(session.userId, domain);
  if (!invited) notFound();

  return <PlayerCraftClient domain={domain} />;
}
