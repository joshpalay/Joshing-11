-- Security: enable Row Level Security on every public table (B-SECURITY-RLS-01).
--
-- Supabase exposes a PostgREST Data API to the `anon` and `authenticated` roles,
-- and Supabase's default privileges GRANT those roles full DML on every table in
-- `public` (confirmed: anon had SELECT/INSERT/UPDATE on "User", incl. plaintext
-- phone_number, OtpCode, SmsLog, sessions). With RLS disabled, anyone holding the
-- project's anon key could read or modify every row over that API. The Supabase
-- security advisor flags this as `rls_disabled` (critical).
--
-- This app NEVER uses the Data API / supabase-js — it reaches Postgres only
-- through Drizzle over DATABASE_URL, which connects as `postgres`. `postgres`
-- both OWNS every public table and has rolbypassrls=true, so it bypasses RLS
-- entirely. Enabling RLS *without* FORCE therefore:
--   - denies anon/authenticated (no policies => deny-all over the Data API), and
--   - leaves the app's `postgres` connection completely unaffected.
-- No policies are added by design: the only intended database client is the
-- owner connection, which bypasses RLS. If a Data-API consumer is ever added,
-- add per-table policies then.
--
-- Idempotent: ENABLE ROW LEVEL SECURITY is a no-op when already enabled, so this
-- is safe to re-run (incl. the boot guard chain and a re-applied migration).
--
-- Rollback (re-exposes the tables — do not run without restoring grants/policy):
--   ALTER TABLE "User" DISABLE ROW LEVEL SECURITY;  -- ...and so on per table.
ALTER TABLE "ActivityItem" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "BiweeklyCeremony" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ContactHash" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ContentReport" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "CreatorNote" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "CritiqueUsageDaily" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "DAILY_REFINE_DECISION" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "DailyPreference" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "DailyQueue" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "DeclaredInterest" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "EmailVerificationToken" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "FeedDismissedDomain" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "FeedItem" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "Follow" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "FriendInvitation" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "Friendship" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "GeneratedQuestion" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "GradeDispute" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "JoshingGame" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "JoshingGameQuestion" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "JoshingGameRecipient" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "JoshingGameResponse" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "MASTERY_EVENTS" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "OtpCode" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "PLAYER_MASTERY" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "PROFILE_DOMAIN_VISIBILITY" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "PROFILE_SECTION_VISIBILITY" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "Question" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "QuestionAudienceTag" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "QuestionFeedback" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "QuestionRating" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "QuestionReaction" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "SkippedDailyQuestion" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "SmsLog" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "USER_DOMAIN_DIFFICULTY" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "USER_DOMAIN_EXCLUSIONS" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "UserQuestionBank" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "UserSession" ENABLE ROW LEVEL SECURITY;
