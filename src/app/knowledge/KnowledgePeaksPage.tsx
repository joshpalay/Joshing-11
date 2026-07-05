import { redirect } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import { getKnowledgeMapData } from '@/server/knowledge/knowledge-tree';
import { KnowledgePeaksView } from '@/components/knowledge/KnowledgePeaksView';
import { KnowledgeViewSwitcher } from '@/components/knowledge/KnowledgeViewSwitcher';

// The leaf-first "New" knowledge view: lead with the specific things you're
// smart at, then roll up to their areas and the siblings you could add. Same
// tree payload as the bubble map (KnowledgeBubblePage) — this is a different
// presentation of the same data, selected via ?view=peaks in page.tsx.
export async function KnowledgePeaksPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const { tree } = await getKnowledgeMapData(session.userId);

  return (
    <main className="mx-auto flex h-dvh max-w-3xl flex-col px-4 py-5">
      <div className="mb-2 flex items-center justify-center">
        <KnowledgeViewSwitcher current="peaks" />
      </div>
      <header className="mb-2">
        <h1 className="font-serif text-2xl font-semibold text-[var(--brand-ink)]">
          What you <em className="italic text-[var(--brand-ink-700)]">know</em>
        </h1>
      </header>
      <KnowledgePeaksView data={tree} />
    </main>
  );
}
