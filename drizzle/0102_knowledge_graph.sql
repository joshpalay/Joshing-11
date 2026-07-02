-- 0102_knowledge_graph (B-KNOWLEDGE-TAXONOMY-01 P1 / D-KNOWLEDGE-TAXONOMY-MODEL-01)
--
-- The leaf/parent knowledge graph's two tables — structure only, dark until the
-- KNOWLEDGE_GRAPH_* flags flip and a human authors content (B-KNOWLEDGE-ADMIN-01).
--
--   KnowledgeNode: one row per territory node. domain_key (the domainKey() fold
--   of label) is UNIQUE — the fragmentation tripwire: a new label that folds
--   onto an existing node must surface that node, never mint a sibling.
--   node_kind: a node can be a leaf, a parent, or BOTH (Bach is masterable AND
--   parent of WTC — D-doc §3). mastery_threshold is the human-set absolute bar
--   (§5); NULL on pure parents → code default.
--
--   KnowledgeEdge: typed child→parent membership (§7). edge_type 'substantive'
--   (depth-eligible credit) vs 'collection' (coverage-only). A leaf may have
--   many parents; unique (child, parent) prevents duplicate edges. Deliberately
--   SEPARATE from DomainRelation (0099): that table is the serving-side
--   near-ness cache keyed on raw canonical_subcategory strings; this one is the
--   authored taxonomy keyed on domain_key. A later reconcile doc may seed edges
--   from DomainRelation rung='parent' rows — not this migration.
--
-- Plain-text CHECK vocabularies, not pg enums (0099 rationale: additive vocab
-- changes without ALTER TYPE ceremonies). RLS enabled with no policies per
-- B-SECURITY-RLS-01 / migration 0081 (owner-role app connection bypasses RLS).
-- Idempotent; mirrored by a guard in src/instrumentation.ts. No question
-- backfill — forbidden by D-doc §6.
--
-- Rollback:
--   DROP TABLE IF EXISTS "KnowledgeEdge";
--   DROP TABLE IF EXISTS "KnowledgeNode";
CREATE TABLE IF NOT EXISTS "KnowledgeNode" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "label" text NOT NULL,
  "domain_key" text NOT NULL,
  "node_kind" text NOT NULL DEFAULT 'leaf' CHECK ("node_kind" IN ('leaf', 'parent', 'both')),
  "mastery_threshold" integer,
  "broad_category" text,
  "field_hue" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "KnowledgeNode" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeNode_domain_key_key" ON "KnowledgeNode" ("domain_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "KnowledgeEdge" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "child_domain_key" text NOT NULL,
  "parent_domain_key" text NOT NULL,
  "edge_type" text NOT NULL CHECK ("edge_type" IN ('substantive', 'collection')),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "KnowledgeEdge" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeEdge_child_parent_key"
  ON "KnowledgeEdge" ("child_domain_key", "parent_domain_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "KnowledgeEdge_parent_domain_key_idx" ON "KnowledgeEdge" ("parent_domain_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "KnowledgeEdge_child_domain_key_idx" ON "KnowledgeEdge" ("child_domain_key");
