// D-NEARNESS-LADDER-HYBRID-01 — the global near-ness tree cache (rungs half).
//
// For a thin domain, the STRUCTURAL, player-independent rungs one step away:
// nearest siblings / cousins / a parent / a grandparent. Computed ONCE per domain
// by a lazy Haiku call (curated-first, decision E1) and cached in DomainRelation
// (decision B2). The per-player "which rungs are safe to serve" overlay (decision
// C2) lives elsewhere; this module only produces + reads the universal rungs.
//
// Everything here fails OPEN: a missing client, a disabled flag, or a malformed
// model response yields an empty rung set, never a throw — supply simply falls
// back to today's behavior (done-when §9).
import { eq } from 'drizzle-orm';

import {
  HAIKU_MODEL,
  extractTextContent,
  getAnthropicClient,
  loggedMessagesCreate,
  parseJsonObject,
} from '@/lib/llm';
import { db, domainRelations } from '@/server/db';
import { domainKey } from '@/lib/knowledge/domain-key';
import { isNearnessTreeEnabled } from '@/server/daily/kb-exhaustion';
import { CURATED_BROADER_PARENTS } from '@/server/llm/interests';

export type NearnessRung = 'sibling' | 'cousin' | 'parent' | 'grandparent';
export type DomainRung = { domain: string; broadCategory: string | null; rung: NearnessRung };

const RUNGS: readonly NearnessRung[] = ['sibling', 'cousin', 'parent', 'grandparent'];
// Rung → the JSON key the tree-generation prompt returns it under.
const RUNG_KEYS: Record<NearnessRung, string> = {
  sibling: 'siblings',
  cousin: 'cousins',
  parent: 'parents',
  grandparent: 'grandparents',
};
const PER_RUNG_CAP = 4;

type RawSuggestion = { label: string; broadCategory: string | null };
type StoredRung = DomainRung & { source: 'curated' | 'llm' };

function emptyTree(): Record<NearnessRung, RawSuggestion[]> {
  return { sibling: [], cousin: [], parent: [], grandparent: [] };
}

/**
 * Pure parse of the tree-generation JSON into per-rung suggestion lists. Tolerant:
 * a non-object, a missing key, or a malformed item yields an empty rung rather
 * than throwing. Exported for unit testing.
 */
export function parseNearnessTree(rawText: string): Record<NearnessRung, RawSuggestion[]> {
  const result = emptyTree();
  const obj = parseJsonObject(rawText);
  if (!obj || typeof obj !== 'object') return result;
  for (const rung of RUNGS) {
    const arr = (obj as Record<string, unknown>)[RUNG_KEYS[rung]];
    if (!Array.isArray(arr)) continue;
    const items: RawSuggestion[] = [];
    for (const raw of arr) {
      if (!raw || typeof raw !== 'object') continue;
      const label = typeof (raw as { label?: unknown }).label === 'string'
        ? (raw as { label: string }).label.trim()
        : '';
      if (!label) continue;
      const bcRaw = (raw as { broadCategory?: unknown }).broadCategory;
      const broadCategory = typeof bcRaw === 'string' && bcRaw.trim() ? bcRaw.trim() : null;
      items.push({ label, broadCategory });
    }
    result[rung] = items;
  }
  return result;
}

/**
 * Shape parsed suggestions into stored rungs: drop self-references, dedupe by
 * folded domain key WITHIN a rung and ACROSS rungs (nearest rung wins:
 * sibling > cousin > parent > grandparent), cap each rung. Pure. Exported for tests.
 */
export function shapeDomainRungs(
  childDomain: string,
  parsed: Record<NearnessRung, RawSuggestion[]>,
  source: 'curated' | 'llm',
): StoredRung[] {
  const childKey = domainKey(childDomain);
  const seen = new Set<string>();
  const out: StoredRung[] = [];
  for (const rung of RUNGS) {
    let kept = 0;
    for (const s of parsed[rung]) {
      const key = domainKey(s.label);
      if (!key || key === childKey || seen.has(key)) continue;
      seen.add(key);
      out.push({ domain: s.label, broadCategory: s.broadCategory, rung, source });
      if (++kept >= PER_RUNG_CAP) break;
    }
  }
  return out;
}

// Read the cached rungs for a domain (empty when never computed).
export async function getCachedDomainRungs(childDomain: string): Promise<DomainRung[]> {
  const rows = await db
    .select({
      domain: domainRelations.relatedDomain,
      broadCategory: domainRelations.broadCategory,
      rung: domainRelations.rung,
    })
    .from(domainRelations)
    .where(eq(domainRelations.childDomain, childDomain));
  return rows.map((r) => ({ domain: r.domain, broadCategory: r.broadCategory, rung: r.rung }));
}

// One Haiku call producing all four rungs (A2). Constrained to answerable,
// specific labels — never bare top-level buckets. Returns the parsed tree; fails
// open to an empty tree.
async function generateRungsViaLlm(childDomain: string, broadCategory: string | null): Promise<Record<NearnessRung, RawSuggestion[]>> {
  const client = getAnthropicClient();
  if (!client) return emptyTree();
  const clean = childDomain.trim().replace(/\s+/g, ' ').slice(0, 100);
  const broadHint = broadCategory ? `\nThe domain sits in the broad category "${broadCategory}".` : '';
  const systemPrompt = `A player has run a small, specific trivia domain dry. Map its NEAR-NESS TREE — the structural neighbours one step away — so we can serve adjacent questions or offer a graduation. Return four labelled rungs.
Rules:
- "siblings": the nearest peers at the SAME level (e.g. for "Tears of the Kingdom": "Breath of the Wild", "Ocarina of Time").
- "cousins": near-but-not-immediate peers (e.g. "Super Mario Odyssey", "Metroid Dread").
- "parents": the body of knowledge one level UP that CONTAINS the domain (e.g. "The Legend of Zelda series"). Never a bare bucket like "Video Games".
- "grandparents": two levels up (e.g. "Nintendo franchises"). Still a named, answerable body — never a bare top-level bucket.
- Each item must be specific enough to write real trivia about. Do NOT include the player's own domain. No duplicates across rungs.
- broadCategory is a stable top-level bucket (Music, Film & Television, History, Science, Sports, Pop Culture, Philosophy, Literature, Video Games, etc.). Never "Other" or "General".${broadHint}
Respond in JSON only, no markdown: { "siblings": [ { "label": "...", "broadCategory": "..." } ], "cousins": [...], "parents": [...], "grandparents": [...] }`;
  try {
    const response = await loggedMessagesCreate(client, 'nearness-tree', {
      model: HAIKU_MODEL,
      max_tokens: 600,
      temperature: 0.3,
      system: systemPrompt,
      messages: [{ role: 'user', content: clean }],
    });
    return parseNearnessTree(extractTextContent(response.content));
  } catch {
    return emptyTree();
  }
}

// Curated PARENT rungs for known-small domains (curated-first, E1). Empty unless
// the domain is in the launch curated map.
function curatedParentRungs(childDomain: string): StoredRung[] {
  const curated = CURATED_BROADER_PARENTS[childDomain.trim().toLowerCase()];
  if (!curated || curated.length === 0) return [];
  return shapeDomainRungs(
    childDomain,
    { ...emptyTree(), parent: curated.map((c) => ({ label: c.label, broadCategory: c.broadCategory })) },
    'curated',
  );
}

async function storeRungs(childDomain: string, rungs: StoredRung[]): Promise<void> {
  if (rungs.length === 0) return;
  try {
    await db
      .insert(domainRelations)
      .values(rungs.map((r) => ({
        childDomain,
        relatedDomain: r.domain,
        broadCategory: r.broadCategory,
        rung: r.rung,
        source: r.source,
      })))
      // (child_domain, related_domain) is unique; a concurrent build or a re-run is a no-op.
      .onConflictDoNothing();
  } catch (err) {
    console.warn('[nearness-tree] store failed (best-effort)', {
      childDomain,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Return the near-ness rungs for a domain, computing + caching them on first miss.
 * Flag-gated (NEARNESS_TREE_ENABLED): when off, or on any failure, returns whatever
 * is cached (usually empty) — never triggers the LLM and never throws. Curated
 * parents are layered over the LLM rungs and win on a folded-key collision.
 */
export async function getOrBuildDomainRungs(childDomain: string, broadCategory: string | null = null): Promise<DomainRung[]> {
  const cached = await getCachedDomainRungs(childDomain).catch(() => [] as DomainRung[]);
  if (cached.length > 0) return cached;
  if (!isNearnessTreeEnabled()) return cached;

  const parsed = await generateRungsViaLlm(childDomain, broadCategory);
  const llmRungs = shapeDomainRungs(childDomain, parsed, 'llm');
  const curated = curatedParentRungs(childDomain);

  // Curated-first: curated parents win on a folded-key collision with LLM rows.
  const curatedKeys = new Set(curated.map((r) => domainKey(r.domain)));
  const merged = [...curated, ...llmRungs.filter((r) => !curatedKeys.has(domainKey(r.domain)))];
  if (merged.length === 0) return cached;

  await storeRungs(childDomain, merged);
  return merged.map(({ domain, broadCategory: bc, rung }) => ({ domain, broadCategory: bc, rung }));
}
