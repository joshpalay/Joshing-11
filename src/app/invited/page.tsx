import { redirect } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import {
  getActiveInvitations,
  getPlayerDomainReceipts,
  getUnseenInvitation,
} from '@/server/db/queries/author-invitations';
import { getDurablePoolDepthForDomains } from '@/server/db/queries/retrieval-demand';
import { getCachedDomainRungs, type DomainRung } from '@/server/knowledge/nearness-tree';

import { InvitedClient } from './InvitedClient';

export const dynamic = 'force-dynamic';

// B-CRAFTER-LIFECYCLE-01 Phase 3 — the "you've played through X" screen.
// Full-screen by decision (2026-07-01), completion-framed, three doors. Shown
// as a takeover ONCE per invitation (the post-daily gate only redirects for
// unseen ones); after that this page stays quietly reachable for any active
// invitation. No invitation → home, no ceremony about it.
export default async function InvitedPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const invitation =
    (await getUnseenInvitation(session.userId)) ??
    (await getActiveInvitations(session.userId))[0] ??
    null;
  if (!invitation) redirect('/');

  // The "go broader" door: near-ness rungs for the exhausted domain (cached
  // tree only — no LLM call on a player page load), with real pool counts so
  // "there's more waiting there" is honest. Broader rungs first.
  let rungs: DomainRung[] = [];
  try {
    rungs = await getCachedDomainRungs(invitation.domain);
  } catch {
    rungs = [];
  }
  const rungOrder: Record<DomainRung['rung'], number> = {
    parent: 0,
    grandparent: 1,
    sibling: 2,
    cousin: 3,
  };
  const broaderFirst = [...rungs].sort((a, b) => rungOrder[a.rung] - rungOrder[b.rung]).slice(0, 6);
  const [depths, receipts] = await Promise.all([
    getDurablePoolDepthForDomains(broaderFirst.map((r) => r.domain)),
    // The evidence behind the trophy: what this player actually did here.
    getPlayerDomainReceipts(session.userId, invitation.domain),
  ]);

  return (
    <InvitedClient
      invitation={{
        id: invitation.id,
        domain: invitation.domain,
        seenAt: invitation.seenAt ? invitation.seenAt.toISOString() : null,
      }}
      receipts={{
        answered: receipts.answered,
        correct: receipts.correct,
        firstPlayed: receipts.firstPlayed ? receipts.firstPlayed.toISOString() : null,
      }}
      broaderDomains={broaderFirst.map((r) => ({
        domain: r.domain,
        broadCategory: r.broadCategory,
        rung: r.rung,
        poolDepth: depths.get(r.domain) ?? 0,
      }))}
    />
  );
}
