import { KnowledgeFlatClient } from './KnowledgeFlatClient';
import { KnowledgeViewSwitcher, type KnowledgeView } from '@/components/knowledge/KnowledgeViewSwitcher';

export const dynamic = 'force-dynamic';

// The knowledge page now offers three interchangeable views, chosen live via
// ?view= (replacing the old build-time KNOWLEDGE_MAP_PAGE env gate):
//   - peaks    (default) → the leaf-first "what you're smart at" gallery
//   - current            → the nested circle-pack bubble map
//   - previous           → the flat portrait page that predates the map
// Each view owns its own header + switcher chrome; only the selected one's
// server component runs, so we never double-fetch the tree. The friend page
// keeps its own flag for now — this switch is the owner surface only.
function parseView(raw: string | string[] | undefined): KnowledgeView {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === 'current' || value === 'previous') return value;
  return 'peaks';
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

  if (view === 'previous') {
    return (
      <>
        <div className="mx-auto flex w-[min(672px,94vw)] items-center justify-center pt-5">
          <KnowledgeViewSwitcher current="previous" />
        </div>
        <KnowledgeFlatClient />
      </>
    );
  }

  const { KnowledgePeaksPage } = await import('./KnowledgePeaksPage');
  return <KnowledgePeaksPage />;
}
