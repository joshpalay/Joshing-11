-- Add the replacement Category enum value separately from the default/data
-- migration that consumes it. The app startup preflight also commits this enum
-- addition before Drizzle's transaction when multiple migrations are pending.
ALTER TYPE "public"."Category" ADD VALUE IF NOT EXISTS 'general_knowledge';
