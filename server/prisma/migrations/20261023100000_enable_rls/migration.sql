-- The tables live in Supabase's `public` schema, which the Supabase Data API exposes.
-- Row Level Security with no policies blocks the `anon` and `authenticated` API roles.
-- The app connects as the table owner (projectbridge_app), which bypasses RLS, so only
-- the Express server can read or write this data (proposal Section 11.2).
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmailToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Project" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GuestSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
