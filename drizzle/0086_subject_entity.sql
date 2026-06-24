-- GeneratedQuestion.subject_entity + Question.subject_entity — the primary
-- subject a question is ABOUT (e.g. "Peter Pettigrew", "Guys and Dolls").
--
-- Why this exists: the Tier 2 subject-cooldown gate (B-DEDUP-SUBJECT-COOLDOWN)
-- spaces out same-subject questions across a window. Two genuinely-different
-- facts about one subject can read as a repeat — observed 2026-06-24: a "what
-- form was Peter Pettigrew hiding in?" question and, weeks later, "whose name
-- does Harry spot on the Marauder's Map?" (answer: Peter Pettigrew). The
-- fact_key/embedding gates treat those as distinct (cosine ~0.70); only a
-- subject-level signal catches the saturation. fact_key encodes the specific
-- fact, so it can't serve double duty here — this is a separate, coarser key.
--
-- The generator emits subject_entity going forward; the canonical promotion
-- (persistGeneratedQuestion) carries it across. Existing rows are backfilled by
-- scripts/backfill-subject-entity.ts (a batched Haiku derivation), so the gate
-- can see a user's pre-existing answered history.
--
-- Additive, nullable, no default. Idempotent. Mirrored by a defensive guard in
-- src/instrumentation.ts (precedent: 0085) so a preview/production DB that
-- records this migration without the columns present still gets them on boot.
--
-- Rollback:
--   ALTER TABLE "GeneratedQuestion" DROP COLUMN IF EXISTS "subject_entity";
--   ALTER TABLE "Question" DROP COLUMN IF EXISTS "subject_entity";

ALTER TABLE "GeneratedQuestion"
  ADD COLUMN IF NOT EXISTS "subject_entity" text;

ALTER TABLE "Question"
  ADD COLUMN IF NOT EXISTS "subject_entity" text;
