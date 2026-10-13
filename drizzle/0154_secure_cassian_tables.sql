-- The Cassian tables were created in public by 0151 and 0152 without RLS.
-- Supabase grants its Data API roles DML on new public tables by default.
-- Cassian is accessed only through the server's postgres connection, so its
-- client roles should have no table privileges or RLS policies.
ALTER TABLE public."CassianRun" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE public."CassianRun" FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
ALTER TABLE public."CassianCandidate" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE public."CassianCandidate" FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
ALTER TABLE public."CassianReview" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE public."CassianReview" FROM PUBLIC, anon, authenticated;
