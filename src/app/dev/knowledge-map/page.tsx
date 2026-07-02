import { KnowledgeBubblePage } from '@/app/knowledge/KnowledgeBubblePage';

export const dynamic = 'force-dynamic';

// Dev preview for the nested-bubble knowledge map (P5): renders the flag-on
// experience REGARDLESS of KNOWLEDGE_MAP_PAGE, so it can be exercised from the
// profile's Developer-tools section before the flag flips. Session-gated
// inside KnowledgeBubblePage (redirects to /login); the /dev route gate lives
// in src/app/dev/layout.tsx like every other dev tool.
export default function DevKnowledgeMapPage() {
  return <KnowledgeBubblePage />;
}
