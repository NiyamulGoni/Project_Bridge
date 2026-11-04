# ProjectBridge

A platform connecting university projects with industry support. This is the CSE 3102 Software Design and Development Project at CSEDU, built by team 38 / 43 / 53 / 58.

**Current milestone: 2 November 2026, F01 Account access (AT01).** The repository also implements the project lifecycle, FR02–FR07: publish, maintain, hide/delete, feed, search and the role-specific project view. Admin review has a minimal approve / request-changes queue.

## Stack

| Layer | Choice |
|---|---|
| Frontend | React 19 + Vite + React Router (`client/`) |
| Backend | Node.js + Express 5 + TypeScript (`server/`) |
| Database | **Supabase Postgres** via Prisma ORM. Tables are in the `public` schema with Row Level Security on, so Supabase's Data API can't read them; only the Express server can. |
| Sign-in | Email + password, or **Sign in with Google** (Google Identity Services) |
| Email | nodemailer over Gmail SMTP, used for password reset only |
| Tests | Vitest + Supertest against a separate `projectbridge_test` schema |

## Setup

You need Node.js 20 or newer (tested on 24) and git.

```bash
npm install
# Get server/.env from the team lead (it holds the database password). Never commit it.
# Template: server/.env.example. Optional: client/.env from client/.env.example.
npx prisma migrate deploy --schema server/prisma/schema.prisma   # after pulling new migrations (e.g. projects_lifecycle)
npm run seed            # demo accounts, 30 published synthetic projects, 1 submission, 1 pending revision (safe to re-run)
npm test                # AT01–AT07 acceptance suite (uses the test schema)
npm run dev             # API on :4000, web app on http://localhost:5173
```

### Database (Supabase)
- **Project**: `ProjectBridge` (ref `cpuxljxqrbpbbutnlgne`, region ap-south-1).
- **Where to see the data**: Supabase dashboard → Table Editor → schema `public`. The tables are `User`, `Project`, `ProjectRevision`, `ProjectMember`, `ProgressEntry`, `Milestone`, `ProjectMedia`, `Session`, `EmailToken`, `AuditLog` and `GuestSession`.
- **Access**: RLS is enabled with no policies (migration `enable_rls`). The anon and publishable API keys therefore get "permission denied", while the server's role `projectbridge_app` owns the tables and has full access.
- **Tests** use their own schema, `projectbridge_test`, which is never shown in the app.
- **Connection URLs** in `server/.env`:

  | Variable | Used for | Port |
  |---|---|---|
  | `DATABASE_URL` | The running app (transaction pooler, `schema=public`) | 6543 |
  | `DIRECT_URL` | Migrations (session pooler, `schema=public`) | 5432 |
  | `TEST_DATABASE_URL` | Automated tests (`projectbridge_test` schema) | 5432 |

- **Schema change**: edit `server/prisma/schema.prisma`, then run `npx prisma migrate dev --name <change>` from `server/`. Commit the generated folder under `prisma/migrations/`.
- **Test schema after `projects_lifecycle`**: that migration changes `Project.tags` from text to `text[]`. The test setup's `prisma db push` refuses to do this on its own. Run it once by hand against the test schema only; it holds throwaway data:
  `DATABASE_URL=<TEST_DATABASE_URL> DIRECT_URL=<TEST_DATABASE_URL> npx prisma db push --skip-generate --accept-data-loss` (from `server/`).

### Project screenshots (Supabase Storage)
Screenshots are optional (FR02) and are stored in a **private** Storage bucket. Viewers get signed links that expire after 1 hour.
1. In the Supabase dashboard, go to Storage → New bucket and name it `project-media`. Leave **Public bucket off**.
2. In `server/.env`, set `SUPABASE_URL=https://cpuxljxqrbpbbutnlgne.supabase.co` and `SUPABASE_SERVICE_ROLE_KEY=<service_role key from Project Settings → API>`. This key is server-only, so never put it in `client/.env`.
3. Restart `npm run dev`.

Until these are set, everything works except uploads, which return "Screenshot uploads are not configured". Tests use an in-memory bucket.

### Sign in with Google (one-time setup)
1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services.
2. Under **OAuth consent screen**, choose External and fill in the app name and support email. Add your teammates as test users while the app is in "Testing".
3. Under **Credentials → Create credentials → OAuth client ID**, choose Web application. Under Authorized JavaScript origins, add `http://localhost:5173`, and the deployed URL later.
4. Copy the client ID into **both** files:
   - `server/.env`: `GOOGLE_CLIENT_ID=...apps.googleusercontent.com`
   - `client/.env`: `VITE_GOOGLE_CLIENT_ID=` with the same value
5. Restart `npm run dev`. The Google button appears on the Sign in and Register pages, and stays hidden while the ID is empty.

New Google users become **Uploaders**. If a Google email matches an existing account, Google is linked to that account; its role is unchanged.

### Password-reset email (Gmail)
In `server/.env` set `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER=<gmail address>` and `SMTP_PASS=<App Password>`. Create the App Password under Google Account → Security → 2-Step Verification → App passwords; it is not your normal password.

If `SMTP_HOST` is empty, emails go to an **Ethereal test inbox and are not delivered**. The server console prints a warning, plus the reset link and a `Preview:` URL for each email.

### Demo accounts (seeded)
The password for every seeded account is **`Password123!`**.

| Email | Role | Status |
|---|---|---|
| admin@projectbridge.test | Admin | Active |
| pro@projectbridge.test | Professional | Active |
| uploader@projectbridge.test | Uploader | Active |
| banned@projectbridge.test | Professional | **Banned** |

## Project structure

```
server/
  prisma/schema.prisma        data model (proposal Section 11.3)
  prisma/migrations/          Postgres migrations
  prisma/seed.ts              demo data (marked isSynthetic)
  src/lib/google.ts           Google ID-token verification
  src/lib/storage.ts          screenshot storage (Supabase Storage, or in-memory for tests)
  src/lib/audit.ts            shared audit-log writer
  src/middleware/             session (NFR-S3), requireAuth/requireRole (I1), rate limits (NFR-S1), validation
  src/modules/accounts/       FR01 register / login / Google / logout / forgot / reset
  src/modules/projects/       FR02–FR04 drafts, submit, revisions, screenshots, team, progress, milestones, hide, delete
  src/modules/discovery/      FR05 feed, FR06 search, FR07 project view; visibility.ts holds the Section 4.2 field table
  src/modules/admin/          Admin-only routes: review queue (reviews.ts); FR13–FR16 will attach here
  tests/                      AT01–AT07 acceptance tests
client/src/
  pages/                      Explore, ProjectPage, ProjectEditor, ProjectPreview, ProjectManage, MyProjects, AdminArea, auth pages
  components/                 ProjectCard, ProjectView, SearchBar, ReviewQueue, FormField, FormControls, ConfirmDeleteDialog, …
```

New features go in a new `server/src/modules/<name>/` folder with `routes.ts` and `service.ts`. Mount the routes in `src/app.ts` and protect them with `requireAuth` / `requireRole`.

## Security notes (F01)
- Passwords are hashed with bcrypt (12 rounds). Session and reset tokens are random 256-bit values, and only their SHA-256 hashes are stored.
- Google ID tokens are verified on the server: signature, expiry, and that they were issued for our client ID. Google accounts with unverified emails are refused.
- Sessions are stored on the server in an httpOnly, SameSite=Lax cookie. The account's status is re-checked on every request, so a ban or suspension signs the user out immediately, including Google sign-ins.
- Registration always creates an **Uploader**; a `role` field in the request is ignored. Professional and Admin roles can only be assigned by an Admin (FR15, later).
- Failed sign-ins are rate-limited: 5 per 15 minutes per IP and email. Forgot-password never reveals whether an email is registered.
- Restricted feed fields are left out of the API response, not just hidden in the browser.

**Scope change to record:** proposal FR01 lists "verify email". Email verification was removed at the team's request, and Google sign-in was added. Record this as a teacher-approved scope change (proposal §7.4).

## AT01 acceptance evidence

Run `npm test`. The verbose reporter prints one line per check (31 tests):

| AT01 check | Test group |
|---|---|
| Register; new accounts start as Uploader and are signed in; no self-assigned role | AT01.1 Registration |
| Sign in / sign out, generic failure message, rate limit | AT01.2 Sign in / sign out |
| Google sign-in: new user, account linking, banned, unverified, forged token | AT01.3 Sign in with Google |
| Password reset revokes old sessions; link can't be reused | AT01.4 Password reset |
| Disabled-account feedback; ban invalidates live sessions | AT01.5 Disabled accounts |
| Deny unauthorized privilege (401 / 403 / 200) | AT01.6 Permission checks |
| Guest / Uploader / Professional fields; 21st guest card blocked | `feed.test.ts` (AT05) |

## AT02–AT07 acceptance evidence

| Requirement | What the tests check | File |
|---|---|---|
| FR02 Publish | A draft saves with only a title; HTTPS demo link required; ownership declaration required; preview; submit → Admin approve → published; request changes with a note; Guest and Admin can't create; screenshots must be real PNG/JPEG/WebP, at most 2 MB | `publish.test.ts` |
| FR03 Maintain | A revision keeps the approved version live until approval; a rejected revision leaves live content unchanged; invitees must accept before editing or being credited; editor rights survive a role change; progress and milestones skip review | `maintain.test.ts` |
| FR04 Hide/delete | Hide removes from feed, search and direct view, and is reversible; delete needs the exact title, wipes content and media, and keeps the audit row; owner only; not contactable afterwards | `hideDelete.test.ts` |
| FR06 Search | Case-insensitive name; all selected tags, whole tags only; name and tags combined; pagination; published only; signed-in only; viewer limits kept | `search.test.ts` |
| FR07 View | Field-by-field Section 4.2 table for Guest, Uploader (with and without public demo) and Professional; no emails; 404 for unpublished, hidden or deleted; guest cap applies to direct links | `projectView.test.ts` |

**Visibility (Section 4.2)** is defined in one table, `FIELDS_BY_TIER` in `server/src/modules/discovery/visibility.ts`:
- Guests get the title, tags, stage, thumbnail and a 150-character summary.
- Uploaders also get 500 characters of the overview, plus the demo link and screenshots only if the owner ticked "Show to other Uploaders".
- Professionals and Admins get the problem, the full overview, demo, screenshots, milestones, progress and team names. No tier ever receives emails.

"Contribution/hiring information" is not modelled yet.

## 2 November demo script
1. Run `npm test` and show all tests passing.
2. **Register** at `/register`. You land straight on the Account page with the role *Uploader*.
3. Visit `/admin` and see "Access denied (HTTP 403)". Sign out, sign in as `admin@projectbridge.test`, and `/admin` grants access.
4. **Sign in with Google** on `/login`. You land on Account with sign-in method "Google". Show the new row in the Supabase Table Editor (schema `public`, table `User`).
5. **Forgot password**: get the email (Gmail inbox, or the console link), reset, then sign in with the new password.
6. Sign in as `banned@projectbridge.test` and see the "Account disabled" message.
7. Sign out. On **Explore**, click "Load more" until the 20-card guest prompt appears. Sign in as Uploader, then as Professional, and compare the overview detail.
8. Restart `npm run dev` and show that the data persists in Supabase.

### FR02–FR07 walkthrough
1. As `uploader@`, go to **+ New project** and create a draft. Add a screenshot, open **Preview**, tick the ownership box and **Submit**.
2. As `admin@`, go to `/admin`. The review queue shows the submission. **Approve** it and it appears on Explore.
3. As `uploader@`, edit the overview of a published project. Explore still shows the old text. In `/admin` the change appears side by side; approve it and the new text goes live.
4. As `uploader@`, open **Progress & team** and invite `pro@projectbridge.test`. As `pro@`, accept on **My projects** and add a milestone.
5. As `pro@`, search Explore by name and click tag chips. Every selected tag must match. Try a search with no results to see the empty state.
6. Open the same project as a guest, as `uploader@` and as `pro@`, and compare the fields.
7. As `uploader@`, **Hide** the project; it disappears from Explore and its direct link shows 404. **Unhide** it, then **Delete** it by typing its title.
