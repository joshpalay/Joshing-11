// B-KNOWLEDGE-TAXONOMY-01 P5 — the flag gating the nested-bubble knowledge map
// (own page AND the friend page's read-only variant). Default off: both pages
// render the flat portrait exactly as before.
export function isKnowledgeMapPageEnabled(): boolean {
  const raw = process.env.KNOWLEDGE_MAP_PAGE?.trim().toLowerCase();
  if (raw === undefined || raw === '') return false;
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}
