/** Offline inventory reconciliation. Quotes locate records; they never establish equivalence. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { quoteKey } from './cassian-evidence-v3';
import {
  assessReviewV4,
  assessWriterV4,
  cardV4Schema,
  type CardV4,
  type FieldV4,
} from './cassian-evidence-v4';
import type { PreparedPacket } from './cassian-source-packets';

export const coverageHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const text = z
  .string()
  .min(1)
  .refine((s) => !!s.trim());
const verdict = z.enum(['covered', 'missing', 'uncertain']);
export const inventoryAuditSchema = z
  .object({
    schemaVersion: z.literal(1),
    catalogSha: sha,
    reviewer: z
      .object({ name: text, independence: z.enum(['same-author', 'independent']) })
      .strict(),
    claims: z.array(
      z
        .object({ reviewId: text, writerIds: z.array(text), status: verdict, reason: text })
        .strict(),
    ),
  })
  .strict();
export type InventoryAudit = z.infer<typeof inventoryAuditSchema>;
type ClaimRecord = { id: string; field: FieldV4; assertion: string; cardQuote: string };

/** Binding includes the whole card, packet and exact reviewer response, not just selected phrases. */
export function inventoryCatalog(
  card: CardV4,
  packet: PreparedPacket,
  raw: string,
  stop: string | null,
) {
  const writer = assessWriterV4(
    JSON.stringify({ status: 'candidate', reason: '', card }),
    'end_turn',
    packet,
    card.id,
    'strict',
  );
  const review = assessReviewV4(raw, stop, card, packet.sources);
  if (
    writer.status !== 'candidate' ||
    writer.issues.length ||
    !review.protocolValid ||
    !review.assessment
  ) {
    return { valid: false as const, catalog: null, writer, review };
  }
  const writers: ClaimRecord[] = card.claims.map((claim, index) => ({
    id: `writer-${index}-${coverageHash(claim).slice(0, 16)}`,
    field: claim.field,
    assertion: claim.assertion,
    cardQuote: claim.cardQuote,
  }));
  const reviewers: ClaimRecord[] = review.assessment.fields.flatMap((field) =>
    field.claims.map((claim, index) => ({
      id: `review-${field.field.replace(':', '-')}-${index}-${coverageHash(claim).slice(0, 16)}`,
      field: field.field,
      assertion: claim.assertion,
      cardQuote: claim.cardQuote,
    })),
  );
  const body = {
    cardSha: coverageHash(card),
    packetSha: coverageHash(packet),
    rawSha: createHash('sha256').update(raw).digest('hex'),
    writers,
    reviewers,
  };
  return { valid: true as const, catalog: { ...body, sha: coverageHash(body) }, writer, review };
}
export type InventoryCatalog = NonNullable<ReturnType<typeof inventoryCatalog>['catalog']>;

/** Separate reconciliation needs actual card context but never prior decisions, gold or arm labels. */
export function inventoryReconciliationInput(catalog: InventoryCatalog, card: CardV4) {
  cardV4Schema.parse(card);
  if (catalog.cardSha !== coverageHash(card)) throw Error('Reconciliation card changed');
  reconcileInventory(catalog);
  return JSON.stringify({
    schemaVersion: 1,
    catalogSha: catalog.sha,
    card: {
      id: card.id,
      question: card.question,
      answer: card.answer,
      explanation: card.explanation,
      variants: card.variants,
    },
    writerClaims: catalog.writers,
    reconstructedClaims: catalog.reviewers,
  });
}

/** No fuzzy matching, containment heuristic, fact-ID equality or cross-field coverage. */
export function reconcileInventory(catalog: InventoryCatalog, rawAudit?: unknown) {
  const { sha: identity, ...body } = catalog;
  if (coverageHash(body) !== identity) throw Error('Inventory catalog changed');
  let audit: InventoryAudit | undefined;
  if (rawAudit !== undefined) {
    audit = inventoryAuditSchema.parse(rawAudit);
    if (
      audit.catalogSha !== identity ||
      new Set(audit.claims.map((c) => c.reviewId)).size !== catalog.reviewers.length ||
      audit.claims.length !== catalog.reviewers.length ||
      audit.claims.some((c) => !catalog.reviewers.some((r) => r.id === c.reviewId))
    ) {
      throw Error('Incomplete or stale inventory audit');
    }
    for (const claim of audit.claims) {
      const r = catalog.reviewers.find((r) => r.id === claim.reviewId)!;
      if (
        new Set(claim.writerIds).size !== claim.writerIds.length ||
        claim.writerIds.some(
          (id) => !catalog.writers.some((w) => w.id === id && w.field === r.field),
        ) ||
        (claim.status === 'covered' && !claim.writerIds.length) ||
        (claim.status === 'missing' && claim.writerIds.length)
      ) {
        throw Error('Invalid field or claim mapping');
      }
    }
  }
  const rows = catalog.reviewers.map((r) => {
    const attestation = audit?.claims.find((c) => c.reviewId === r.id);
    if (attestation) return { ...attestation, field: r.field, basis: 'explicit-audit' as const };
    const exact = catalog.writers.filter(
      (w) => w.field === r.field && quoteKey(w.assertion) === quoteKey(r.assertion),
    );
    return {
      reviewId: r.id,
      field: r.field,
      writerIds: exact.map((w) => w.id),
      status: exact.length ? ('covered' as const) : ('uncertain' as const),
      reason: exact.length
        ? 'Identical factual assertion in the same field, allowing harmless typography/whitespace.'
        : 'No exact assertion match; equivalence or omission requires explicit review.',
      basis: 'exact-assertion' as const,
    };
  });
  const missing = rows.filter((r) => r.status === 'missing'),
    unresolved = rows.filter((r) => r.status === 'uncertain');
  return {
    catalogSha: identity,
    rows,
    complete: !missing.length && !unresolved.length,
    missing: missing.length,
    unresolved: unresolved.length,
    semanticReview: audit ? audit.reviewer.independence : ('unassessed' as const),
    notServingApproval: true as const,
  };
}

/** New assessment only; never replaces a v4 score or treats a located quote as semantic coverage. */
export function assessCoverageRepair(
  raw: string,
  stop: string | null,
  card: CardV4,
  packet: PreparedPacket,
  audit?: unknown,
) {
  const result = inventoryCatalog(card, packet, raw, stop);
  if (!result.valid)
    return {
      decision: 'review' as const,
      sourceDecision: result.review.decision,
      findings: [
        ...result.review.findings,
        ...result.writer.issues.map((detail) => ({ category: 'incomplete_claim_record', detail })),
      ],
      reconciliation: null,
      catalog: null,
      notServingApproval: true as const,
    };
  let reconciliation: ReturnType<typeof reconcileInventory>;
  try {
    reconciliation = reconcileInventory(result.catalog, audit);
  } catch {
    return {
      decision: 'review' as const,
      sourceDecision: result.review.decision,
      findings: [...result.review.findings, { category: 'invalid_inventory_audit' }],
      reconciliation: null,
      catalog: result.catalog,
      notServingApproval: true as const,
    };
  }
  const findings = [
    ...result.review.findings,
    ...reconciliation.rows
      .filter((r) => r.status !== 'covered')
      .map((r) => ({
        category: r.status === 'missing' ? 'inventory_omission' : 'unresolved_claim_mapping',
        field: r.field,
        detail: r.reason,
      })),
  ];
  return {
    decision:
      result.review.decision === 'pass' && !reconciliation.complete
        ? ('review' as const)
        : result.review.decision,
    sourceDecision: result.review.decision,
    findings,
    reconciliation,
    catalog: result.catalog,
    notServingApproval: true as const,
  };
}

export const INVENTORY_RECONCILIATION_PROMPT = `Compare independently reconstructed factual assertions with the writer inventory, within the SAME card field. Source reconstruction must already be complete before this separate step; never edit it to agree with the writer. Match whole relationships and required qualifiers (actors, objects, dates, chronology, attribution, formation, quantities and scope), not identifying quote boundaries or shared fact IDs. One reconstructed claim may require several writer records. A record in the answer does not cover the explanation. Different quote anchors can identify equivalent assertions. Preserve missing, uncertain and covered separately. An overlapping quote is not proof of equivalence; A and B forming C is not A merging into a preexisting C. Do not invent support from a recommendation or a subject mention. Return one bound reviewId per catalog claim, with matching same-field writerIds, status and a specific reason. Covered requires IDs; missing has none; use uncertain if meaning cannot be settled. This is an explicit attestation, not a source-truth or serving approval.`;
