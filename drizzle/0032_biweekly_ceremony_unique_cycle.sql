-- F3.3: prevent duplicate ceremonies for the same (user, cycle) window.
-- Cron retries, concurrent fires, and post-SMS-error retries could all
-- previously produce >1 row per (userId, cycleStart, cycleEnd).

-- Step 1: de-dup existing rows. For each (userId, cycleStart, cycleEnd)
-- group, keep the row with the earliest firedAt and delete the rest.
-- Activity rows referencing the deleted ceremonies are removed alongside.
WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "userId", "cycleStart", "cycleEnd"
      ORDER BY "firedAt" ASC, "id" ASC
    ) AS rn
  FROM "BiweeklyCeremony"
),
duplicates AS (
  SELECT "id" FROM ranked WHERE rn > 1
)
DELETE FROM "ActivityItem"
WHERE "referenceType" = 'ceremony'
  AND "referenceId" IN (SELECT "id" FROM duplicates);

WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "userId", "cycleStart", "cycleEnd"
      ORDER BY "firedAt" ASC, "id" ASC
    ) AS rn
  FROM "BiweeklyCeremony"
)
DELETE FROM "BiweeklyCeremony"
WHERE "id" IN (SELECT "id" FROM ranked WHERE rn > 1);

-- Step 2: add the unique index.
CREATE UNIQUE INDEX IF NOT EXISTS "BiweeklyCeremony_user_cycle_key"
  ON "BiweeklyCeremony" ("userId", "cycleStart", "cycleEnd");
