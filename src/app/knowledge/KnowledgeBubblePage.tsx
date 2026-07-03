import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { db, users } from '@/server/db';
import { getSession } from '@/server/auth/session';
import type { MasteryTier } from '@/types/db';
import { getKnowledgeMapData } from '@/server/knowledge/knowledge-tree';
import { KnowledgeBubbleMap } from '@/components/knowledge/KnowledgeBubbleMap';

import { BubblePageChrome } from './BubblePageChrome';

// The share card's one-line mind statement — same construction the flat
// portrait surfaces use (top three territories, natural-language joined).
function buildMindStatement(topDomains: readonly { displayName: string }[]): string {
  const top = topDomains.slice(0, 3).map((d) => d.displayName);
  if (top.length >= 2) {
    return `You're building around ${top.slice(0, -1).join(', ')} and ${top.at(-1)}.`;
  }
  if (top.length === 1) return `You're building around ${top[0]}.`;
  return 'Your mind will take shape as you answer and write questions.';
}

// B-KNOWLEDGE-TAXONOMY-01 P5 — the flag-on knowledge page: nested circle-pack
// map over the player's real mastery + the authored graph, with the flat
// page's share/tidy chrome (P5 follow-up), the collections coverage strip, and
// the grow-rim. Reached only via the KNOWLEDGE_MAP_PAGE gate in page.tsx
// (dynamic import — never loaded on the off path) or the /dev preview.
export async function KnowledgeBubblePage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const [{ tree, collections, ownedDomains }, [user]] = await Promise.all([
    getKnowledgeMapData(session.userId),
    db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1),
  ]);

  const sorted = [...ownedDomains].sort((a, b) => b.points - a.points);
  const topDomains = sorted.slice(0, 5);
  const totalPoints = sorted.reduce((sum, d) => sum + d.points, 0);

  return (
    <main className="mx-auto flex h-dvh max-w-3xl flex-col px-4 py-5">
      <header className="mb-1 flex items-baseline justify-between gap-3">
        <h1 className="font-serif text-2xl font-semibold text-[var(--brand-ink)]">
          What you <em className="italic text-[var(--brand-ink-700)]">know</em>
        </h1>
        <BubblePageChrome
          playerDisplayName={user?.displayName ?? 'You'}
          portraitStatement={buildMindStatement(topDomains)}
          domains={topDomains.map((d) => ({
            canonicalSubcategory: d.displayName,
            currentTier: d.tier as MasteryTier,
            lifetimePoints: d.points,
            iconKey: d.iconKey,
            broadCategory: d.broadCategory,
          }))}
          overflowCount={Math.max(0, sorted.length - topDomains.length)}
          tierSignature={`${new Intl.NumberFormat().format(Math.round(totalPoints))} knowledge points across ${sorted.length} territories`}
          existingLabels={sorted.map((d) => d.displayName)}
        />
      </header>
      <KnowledgeBubbleMap data={tree} collections={collections} />
    </main>
  );
}
