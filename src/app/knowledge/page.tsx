import { redirect } from 'next/navigation';

import { KnowledgeFlatClient } from './KnowledgeFlatClient';
import { KnowledgeViewSwitcher, type KnowledgeView } from '@/components/knowledge/KnowledgeViewSwitcher';
import { getSession } from '@/server/auth/session';
import { getKnowledgeMapData } from '@/server/knowledge/knowledge-tree';
import { getFullyExploredDomains } from '@/server/knowledge/fully-explored';
import { getDailyPreferences } from '@/server/db/queries/daily-preferences';

export const dynamic = 'force-dynamic';

// The knowledge page now offers three interchangeable views, chosen live via
// ?view= (replacing the old build-time KNOWLEDGE_MAP_PAGE env gate):
//   - previous (default) → the flat portrait page (per-circle frequency + the
//                          tapped-circle detail pop-up)
//   - peaks              → the leaf-first "what you're smart at" gallery
//   - current            → the nested circle-pack bubble map
// Each view owns its own header + switcher chrome; only the selected one's
// server component runs, so we never double-fetch the tree. The friend page
// keeps its own flag for now — this switch is the owner surface only.
function parseView(raw: string | string[] | undefined): KnowledgeView {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === 'current' || value === 'peaks') return value;
  return 'previous';
}

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const view = parseView((await searchParams).view);

  if (view === 'current') {
    const { KnowledgeBubblePage } = await import('./KnowledgeBubblePage');
    return <KnowledgeBubblePage />;
  }

  if (view === 'peaks') {
    const { KnowledgePeaksPage } = await import('./KnowledgePeaksPage');
    return <KnowledgePeaksPage />;
  }

  // Default view: the flat portrait. It still self-loads /api/knowledge, but the
  // per-circle frequency word and the tapped-circle detail pop-up need the
  // knowledge tree + rotation preferences (same reads the "peaks" view makes).
  // Fetch them here and thread them in — an additive read, no change to the
  // portrait's own load.
  const session = await getSession();
  if (!session) redirect('/login');

  const [{ tree }, preferences, fullyExplored] = await Promise.all([
    getKnowledgeMapData(session.userId),
    getDailyPreferences(session.userId),
    getFullyExploredDomains(session.userId),
  ]);

  return (
    <>
      <div className="mx-auto flex w-[min(672px,94vw)] items-center justify-center pt-5">
        <KnowledgeViewSwitcher current="previous" />
      </div>
      <KnowledgeFlatClient
        tree={tree}
        frequencyByDomain={preferences.domainPreferenceFrequency}
        fullyExploredDomains={fullyExplored}
      />
    </>
  );
}
