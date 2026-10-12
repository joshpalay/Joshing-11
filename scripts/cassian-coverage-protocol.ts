/** New opt-in protocol; completed v4 responses/runners remain untouched. */
import { z } from 'zod';
import { hash } from './cassian-fresh-dispatch-core';
import {
  reviewV4Schema,
  assessReviewV4,
  RECONSTRUCTION_PROMPT_V4,
  type CardV4,
} from './cassian-evidence-v4';
import {
  coverageHash,
  inventoryAuditSchema,
  inventoryCatalog,
  reconcileInventory,
  type InventoryCatalog,
} from './cassian-claim-reconciliation';
import type { PreparedPacket } from './cassian-source-packets';
import type { SourceV3 } from './cassian-evidence-v3';

const claim = reviewV4Schema.shape.fields.element.shape.claims.element
  .extend({
    basis: z.enum(['direct_relationship', 'recommendation', 'subject_mention', 'none']),
  })
  .strict();
export const coverageSourceSchema = reviewV4Schema
  .extend({
    fields: z
      .array(
        reviewV4Schema.shape.fields.element.extend({ claims: z.array(claim).max(10) }).strict(),
      )
      .min(3)
      .max(5),
  })
  .strict();
export type CoverageSourceReply = z.infer<typeof coverageSourceSchema>;
// Identity/independence are supplied by code, never asserted by the model itself.
export const modelInventorySchema = inventoryAuditSchema.omit({ reviewer: true }).strict();
const fold = (s: unknown) => (typeof s === 'string' ? s.toLowerCase() : s);

export function assessCoverageSource(
  raw: string,
  stop: string | null,
  card: CardV4,
  sources: SourceV3[],
) {
  const invalid = () => ({
    decision: 'review' as const,
    protocolValid: false,
    responseFormatValid: false,
    findings: [{ category: 'invalid_coverage_source' }],
    assessment: null,
    records: [],
    projection: null,
    notServingApproval: true as const,
  });
  if (stop !== 'end_turn') return invalid();
  let reply: CoverageSourceReply;
  try {
    const parsed = JSON.parse(raw) as CoverageSourceReply;
    for (const f of parsed.fields ?? []) {
      f.field = fold(f.field) as typeof f.field;
      for (const c of f.claims ?? []) {
        c.status = fold(c.status) as typeof c.status;
        c.basis = fold(c.basis) as typeof c.basis;
      }
      if (f.acceptance)
        for (const k of ['entity', 'answerType', 'language', 'specificity'] as const)
          f.acceptance[k] = fold(f.acceptance[k]) as (typeof f.acceptance)[typeof k];
    }
    reply = coverageSourceSchema.parse(parsed);
  } catch {
    return invalid();
  }
  const indirect = reply.fields.flatMap((f) =>
    f.claims.flatMap((c, n) =>
      c.status !== 'unknown' && c.basis !== 'direct_relationship'
        ? [{ category: 'indirect_support', field: f.field, claim: n }]
        : [],
    ),
  );
  // An indirect quotation cannot establish either support or a contradiction.
  const projection = JSON.stringify({
    ...reply,
    fields: reply.fields.map((f) => ({
      ...f,
      claims: f.claims.map((c) => {
        const { basis, ...plain } = c;
        return {
          ...plain,
          status: c.status !== 'unknown' && basis !== 'direct_relationship' ? 'unknown' : c.status,
        };
      }),
    })),
  });
  const assessed = assessReviewV4(projection, stop, card, sources),
    findings = [...assessed.findings, ...indirect];
  return {
    ...assessed,
    decision:
      assessed.decision === 'pass' && indirect.length ? ('review' as const) : assessed.decision,
    responseFormatValid: true,
    findings,
    assessment: reply,
    projection,
    notServingApproval: true as const,
  };
}

/** Bind the catalog to the actual native receipt, while reconstructing its validated v4 projection. */
export function coverageInventoryCatalog(
  raw: string,
  stop: string | null,
  card: CardV4,
  packet: PreparedPacket,
) {
  const source = assessCoverageSource(raw, stop, card, packet.sources);
  if (!source.protocolValid || !source.projection) return { catalog: null, source };
  const built = inventoryCatalog(card, packet, source.projection, stop);
  if (!built.valid) return { catalog: null, source };
  const { sha: _identity, ...body } = built.catalog;
  const actual = { ...body, rawSha: hash(raw) };
  return { catalog: { ...actual, sha: coverageHash(actual) }, source };
}

export function assessModelInventory(raw: string, stop: string | null, catalog: InventoryCatalog) {
  const invalid = () => ({
    valid: false as const,
    result: null,
    issue: 'invalid_inventory_response',
    notServingApproval: true as const,
  });
  if (stop !== 'end_turn') return invalid();
  try {
    const parsed = JSON.parse(raw);
    for (const row of parsed.claims ?? []) row.status = fold(row.status);
    const model = modelInventorySchema.parse(parsed);
    const result = reconcileInventory(catalog, {
      ...model,
      reviewer: {
        name: 'Anthropic Sonnet 5.5 model reconciliation; author-designed protocol',
        independence: 'same-author',
      },
    });
    return { valid: true as const, result, issue: null, notServingApproval: true as const };
  } catch {
    return invalid();
  }
}

export const COVERAGE_SOURCE_PROMPT =
  RECONSTRUCTION_PROMPT_V4 +
  `
Additional coverage contract: reconstruct only atomic MATERIAL assertions/presuppositions actually in this card. Do not inflate an identifying phrase into a broader source summary. Separate clauses and qualifiers when their support differs. Preserve all stated actors, objects, temporal order, scope, quantities and entity-formation roles. In a formation relation, compare the participating entities and the resulting entity, including whether the result already existed; shared names are insufficient support.
Each claim also has basis: direct_relationship, recommendation, subject_mention or none. Supported/contradicted requires direct_relationship: the quoted passage must establish that exact relationship and its stated qualifiers. A general recommendation cannot establish a measured outcome. A subject mention cannot establish attribution or chronology. Missing direct evidence remains unknown; use the actual indirect basis if useful. The program refuses indirect support even if status says supported. Basis is your attestation, not a proof; reason must explain the relationship. The writer inventory, gold and prior decisions remain unavailable. Return the supplied native JSON schema.`;
