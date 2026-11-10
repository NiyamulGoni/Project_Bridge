# ProjectBridge: notes for Claude Code

ProjectBridge connects university projects with industry support (CSE 3102, CSEDU). Team: Niyamul Goni Sourav (leader), Md. Rakibul Hasan (test/QA), Shezad Mahbub (backend), Md. Shahadat Hossain Riyad (frontend). The SRS is the proposal PDF the team shares; FR and AT numbers in the code refer to it.

Course gates: 7 Dec 2026 needs F01–F07 and F13 accepted; feature freeze 27 Dec 2026; defence 18 Jan 2027. A feature only counts when it works end to end, so every backend step also needs its screens.

This is a semester project. Aim for correct, secure and readable code with focused tests on each step's "Done when" items. Skip production extras the step does not ask for.

## Layout and commands

- `server/`: Node, TypeScript, Express 5, Prisma 6, Postgres on Supabase. Features live in `server/src/modules/<name>/` as `routes.ts`, `service.ts` and `schemas.ts`, mounted in `server/src/app.ts`.
- `client/`: React 19, Vite, React Router. Pages in `client/src/pages/`, shared pieces in `client/src/components/`, API types and the `api()` helper in `client/src/api.ts`.

```bash
npm install
npx prisma generate --schema server/prisma/schema.prisma
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
- The connection to Supabase is often slow or drops for minutes. `server/src/lib/prisma.ts` raises the timeouts and retries plain reads. In tests, errors such as `Can't reach database server`, P1001, P1008, P1017, P2024, P2028 or "Hook timed out" are almost always the connection, not the code. Check with a `SELECT 1` before debugging, and rerun just the affected file. Running the suite with fewer connections helps: set `connection_limit=5` on `TEST_DATABASE_URL` for that run.

## Test-suite tripwires

When you add things, these tests will fail until you update them on purpose:

- `server/tests/helpers.ts` `resetDb()`: add `deleteMany()` for each new table, children before parents.
- `server/tests/views.test.ts`: every GET route must be listed in `GET_ROUTES` with its status per viewer; every router must be in `ROUTERS`; the "app mounts the known routers" test lists the exact mount order. New fields in a role's view change the `CARD`, `FULL_CARD` and `FULL_DETAIL` lists.
- `server/tests/permissions.test.ts`: `PROJECT_ROUTES` and `ADMIN_ROUTES` list every route on those routers with its gate.

## Status (10 Nov 2026)

Done, with screens and tests (744 tests pass): accounts, projects, feed, search, project view (F01–F07), central permissions, role-based views, encryption and request hardening, audit log with old and new values, notifications, reports and the Admin report queue (F13), atomic Admin review decisions, likes and comments (F08, F09), contact requests (F10 part 1).

Known gaps: reports on `OFFER` targets are not yet checked against a real record (add that in Step 9). Accepted contact requests open a conversation, but there is no messaging yet (Step 8).

## Next steps

Do one step at a time, then typecheck, run the relevant tests, and build the step's screens.

- **Step 8, private messages (FR10 part 2).** Add a Message model with an encrypted body, and routes to list conversations, read messages (cursor pagination) and send messages (rate limited). Only participants can read or send; everyone else, including Admins, gets 404. Existing conversations survive a project being hidden or deleted. Suspended or banned participants lose access. Done when tests prove non-participant denial, that the stored body is not plaintext, and that restricted users can read but not send.
- **Step 9, paid offers (FR11).** Add PaidOffer: skills, type, compensation, currency, application route, OPEN or CLOSED, and a review status. Only an active Professional who owns or edits the project can create one, and all terms are required. Offers go through the Admin review queue. Only approved, open offers are visible, and only to the Professional and Admin tiers. Closing an offer blocks new contact requests that come from it. Responses state that the platform processes no payments. Done when tests prove Uploaders and Guests never receive offer fields.
- **Step 10, public sharing (FR12).** Add `GET /api/projects/:id/share` returning only the canonical URL, title, 150-character summary and thumbnail. Add `GET /p/:id`, returning a small HTML page with escaped Open Graph tags that forwards to the app. Only published projects are shareable. A share link grants no extra access and does not use the guest card budget. Done when tests prove no restricted field appears and a hostile project title is escaped.
- **Step 11, remove a project (FR14).** Admin route to remove a project with a required reason and a confirmed report or review decision. In one transaction: set REMOVED, write the audit row, notify the owner. A re-review route is the only way back (REMOVED to SUBMITTED). Removing a project never changes the owner's account. Done when tests prove a removed project disappears from feed, search and direct links, and an unconfirmed report cannot trigger removal.
- **Step 12, roles, access status and message evidence (FR15, FR16).** RoleRequest model and routes for an Uploader to request Professional. Admin routes: list users, view a user's audit history, approve a role change (Uploader to Professional only, reason required, no self-promotion, ownership kept). An access route sets status with a required reason, allowing only ACTIVE to or from RESTRICTED, ACTIVE to or from SUSPENDED, ACTIVE or SUSPENDED to BANNED, and BANNED to ACTIVE; Professional accounts only; Admins cannot target themselves. In one transaction: status, delete sessions on suspend or ban, audit with old and new values, notify. Never delete owned projects. An Admin can read a conversation only through an open report that references it, and each read writes an audit row. Done when tests prove invalid transitions are refused, a ban ends live sessions, and Admins cannot read a conversation without a linked open report.
- **Step 13, final security check.** No new features. Review every route in `server/src/modules` and produce a table of route, permission, record-level check and the test covering it. Add tests for any gap: changing another user's id in a URL, Guest access to protected routes, role fields sent in request bodies, restricted fields in list and detail responses.

## Git

- Remote: https://github.com/NiyamulGoni/Project_Bridge (branch `master`). Pull before you start.
- Commit and push only when the person you are working for asks. Write commit messages that say what changed and why.
