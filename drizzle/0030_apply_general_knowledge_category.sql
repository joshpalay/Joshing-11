-- Now that drizzle/0028 has committed the enum value, it is safe to use it
-- in column defaults and data updates.
ALTER TABLE "Question" ALTER COLUMN "category" SET DEFAULT 'general_knowledge';
UPDATE "Question" SET "category" = 'general_knowledge' WHERE "category" = 'other';
