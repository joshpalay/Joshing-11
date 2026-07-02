import { isKnowledgeMapPageEnabled } from '@/server/knowledge/map-page-flag';

import { KnowledgeFlatClient } from './KnowledgeFlatClient';

export const dynamic = 'force-dynamic';

// B-KNOWLEDGE-TAXONOMY-01 P5 — flag gate for the nested-bubble knowledge map.
// Flag OFF (default): the flat portrait page renders exactly as before — the
// entire previous client page moved verbatim into KnowledgeFlatClient.tsx
// (named export; no other change), and this off-path imports NEITHER new map
// file. Flag ON: the circle-pack map (knowledge-bubbles direction) renders via
// a dynamic import, so the map's code never loads on the off path.

export default async function KnowledgePage() {
  if (isKnowledgeMapPageEnabled()) {
    const { KnowledgeBubblePage } = await import('./KnowledgeBubblePage');
    return <KnowledgeBubblePage />;
  }
  return <KnowledgeFlatClient />;
}
