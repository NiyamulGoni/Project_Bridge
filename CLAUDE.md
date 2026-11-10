# ProjectBridge: notes for Claude Code

ProjectBridge connects university projects with industry support (CSE 3102, CSEDU). Team: Niyamul Goni Sourav (leader), Md. Rakibul Hasan (test/QA), Shezad Mahbub (backend), Md. Shahadat Hossain Riyad (frontend). The SRS is the proposal PDF the team shares; FR and AT numbers in the code refer to it.

Course gates: 7 Dec 2026 needs F01–F07 and F13 accepted; feature freeze 27 Dec 2026; defence 18 Jan 2027. A feature only counts when it works end to end, so every backend step also needs its screens.

This is a semester project. Aim for correct, secure and readable code with focused tests on each step's "Done when" items. Skip production extras the step does not ask for.

## Layout and commands

- `server/`: Node, TypeScript, Express 5, Prisma 6, Postgres on Supabase. Features live in `server/src/modules/<name>/` as `routes.ts`, `service.ts` and `schemas.ts`, mounted in `server/src/app.ts`.
- `client/`: React 19, Vite, React Router. Pages in `client/src/pages/`, shared pieces in `client/src/components/`, API types and the `api()` helper in `client/src/api.ts`.

```bash
npm install      # also regenerates the Prisma client; so do `npm run dev` and `npm test`
npm run dev      # API on :4000, web on http://localhost:5173 (5174 if 5173 is busy)
npm test         # whole suite, uses the projectbridge_test schema
cd server && npx vitest run tests/<file>.test.ts   # one file
cd server && npx tsc --noEmit && cd ../client && npx tsc --noEmit   # typecheck both
```

`server/.env` and `client/.env` are not in git; get them privately from the team lead. Never commit them, print their values, or paste them into a chat. Everyone sharing the database must use the same `ENCRYPTION_KEYS`, or encrypted text (report reasons, contact introductions) reads as blank.

Demo accounts (password `Password123!`): `admin@projectbridge.test` (Sourav, Admin), `pro@projectbridge.test` (Shehzad, Professional), `uploader@projectbridge.test` (Rakibul, Uploader), `banned@projectbridge.test` (Pushy, banned).

## Rules for every change

- Enforce every rule on the server. The client may hide a button, but the API must refuse the action anyway.
- Permissions: use `requirePermission(action)` from `server/src/middleware/auth.ts`. Actions and the roles allowed are in the one table in `server/src/lib/permissions.ts`; RESTRICTED accounts are blocked from everything except signing in, reading and reporting.
- Record-level checks (owner, team member, participant, author) happen in the service. Return 404, not 403, for a record the user may not know exists.
- Build responses from explicit field lists. Never return a whole database row. Never return emails, password hashes, tokens or storage paths. What each role sees of a project is `FIELDS_BY_TIER` in `server/src/modules/discovery/visibility.ts`; Admins get the Professional view.
- Validate input with zod through `validateBody`; throw `HttpError` for failures.
- Status values are strings, listed in `server/src/domain.ts`.
- Multi-step changes that must stay consistent go in one `prisma.$transaction(async (tx) => …, TX_OPTIONS)`. Inside it use only `tx`, never the global `prisma`. Pass `tx` to `audit()` and `notify()`. Admin decisions write an audit row with `oldValue` and `newValue` and notify the affected user in that same transaction. Use a conditional `updateMany` (for example `where: { id, status: 'PENDING' }`) so a decision cannot happen twice.
- Private free text goes through `encrypt(text, '<Model>.<column>')` and `decrypt` from `server/src/lib/crypto.ts`.
- Add tests for the denied cases, not only the allowed ones.

## Database

- One shared Supabase database for the whole team. Real data lives in the `public` schema; tests use the separate `projectbridge_test` schema, rebuilt with `prisma db push` before each run.
- Do not change the shared database without asking the team lead first. That includes `prisma migrate deploy`, `prisma migrate dev` and `npm run setup`.
- To add a migration: edit `server/prisma/schema.prisma`, create `server/prisma/migrations/<timestamp>_<name>/migration.sql` with `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` (run in `server/`, it only reads the database), then append `ALTER TABLE "<Table>" ENABLE ROW LEVEL SECURITY;` for each new table. Tests do not use migrations, so never rely on raw SQL constraints.
- `DATABASE_URL` must use the session pooler (port 5432) with a small `connection_limit` (3). The transaction pooler (port 6543) took 20 seconds or more to connect and often failed. Dropped connections can leave sessions stuck "idle in transaction" on the database, which use up the pooler's slots and make every request queue; check `pg_stat_activity` when the app turns slow.
- The connection to Supabase is often slow or drops for minutes. `server/src/lib/prisma.ts` raises the timeouts and retries plain reads. In tests, errors such as `Can't reach database server`, P1001, P1008, P1017, P2024, P2028 or "Hook timed out" are almost always the connection, not the code. Check with a `SELECT 1` before debugging, and rerun just the affected file. Running the suite with fewer connections helps: set `connection_limit=5` on `TEST_DATABASE_URL` for that run.

## Test-suite tripwires

When you add things, these tests will fail until you update them on purpose:

- `server/tests/helpers.ts` `resetDb()`: add `deleteMany()` for each new table, children before parents.
- `server/tests/security.test.ts`: every router must be in `MOUNTS`, and a route a Guest may call must be in `PUBLIC`.
- `server/tests/views.test.ts`: every GET route must be listed in `GET_ROUTES` with its status per viewer; every router must be in `ROUTERS`; the "app mounts the known routers" test lists the exact mount order. New fields in a role's view change the `CARD`, `FULL_CARD` and `FULL_DETAIL` lists.
- `server/tests/permissions.test.ts`: `PROJECT_ROUTES` and `ADMIN_ROUTES` list every route on those routers with its gate.

## Status (10 Nov 2026)

All 13 backend steps are built, with screens and tests: accounts, projects, feed, search, project view (F01–F07), central permissions, role-based views, encryption and request hardening, audit log, notifications, reports and Admin review (F13), likes and comments (F08, F09), contact requests and private messages (F10), paid offers (F11), share links (F12), project removal (F14), role requests and promotion (F15), account access control and audited message evidence (F16), and the final security check.

`docs/route-security.md` lists every route with its permission, record-level check and tests. Regenerate it after adding a route: `cd server && npx tsx --env-file=.env scripts/route-table.mts`.

Decisions worth knowing:

- A project can be removed only on a CONFIRMED report about it (`POST /api/admin/reports/:id/confirm`, then `POST /api/admin/projects/:id/remove`). Re-review is the only way back.
- Access control (`POST /api/admin/users/:id/status`) applies to Professional accounts only, never the Admin's own, and only along the allowed transitions in `server/src/modules/admin/moderation.ts`.
- Admins read private messages only through `GET /api/admin/reports/:id/conversation`, which needs an OPEN report about that conversation and writes an audit row on every read.
- Paid offers are visible only when APPROVED and OPEN, and only in the Professional project view. Every offer response carries a notice that the platform processes no payments.
- The share page `/p/:id` is served by the API server; Vite proxies `/p` in development.

What is left is polish and acceptance testing: click through each screen, fix what looks wrong, and keep the tests passing.

## Git

- Remote: https://github.com/NiyamulGoni/Project_Bridge (branch `master`). Pull before you start.
- Commit and push only when the person you are working for asks. Write commit messages that say what changed and why.
