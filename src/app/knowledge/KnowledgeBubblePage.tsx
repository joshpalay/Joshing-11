import { redirect } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import { getKnowledgeTree } from '@/server/knowledge/knowledge-tree';
import { KnowledgeBubbleMap } from '@/components/knowledge/KnowledgeBubbleMap';

// B-KNOWLEDGE-TAXONOMY-01 P5 — the flag-on knowledge page: nested circle-pack
// map over the player's real mastery + the authored graph. Reached only via
// the KNOWLEDGE_MAP_PAGE gate in page.tsx (dynamic import — never loaded on
// the off path). Share/tidy chrome from the flat page is a noted follow-up —
// this phase renders the map direction itself.
export async function KnowledgeBubblePage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const tree = await getKnowledgeTree(session.userId);

  return (
    <main className="mx-auto flex h-dvh max-w-3xl flex-col px-4 py-5">
      <header className="mb-1 flex items-baseline justify-between">
        <h1 className="font-serif text-2xl font-semibold text-[var(--brand-ink)]">
          What you <em className="italic text-[var(--brand-ink-700)]">know</em>
        </h1>
      </header>
      <KnowledgeBubbleMap data={tree} />
    </main>
  );
}
