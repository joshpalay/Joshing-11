-- ActivityItem.actorUserId is SET NULL when that account is deleted (FK
-- onDelete: 'set null'), which otherwise leaves the row with no way to say
-- who did this -- the feed falls back to the generic "Someone" copy. This
-- adds a plain-text snapshot of the actor's display name, written once at
-- insert time, so the row keeps a name even after the account is gone.
-- Additive and nullable: existing rows stay NULL and keep falling back to
-- "Someone" exactly as before. Rollback: drop the column.
ALTER TABLE "ActivityItem" ADD COLUMN IF NOT EXISTS "actorNameSnapshot" text;
