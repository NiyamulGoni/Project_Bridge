# Route security table

Step 13 of the backend plan. Every route, the permission that gates it, its record-level check, and the test files that cover it (in `server/tests/`, without the `.test.ts` ending).

This file is generated from the routers by `server/scripts/route-table.mts`; regenerate it after adding a route. `security.test.ts` walks the same routers and checks that a Guest gets 401 on every route not marked Public, and `views.test.ts` scans every GET route as every role for fields that role must not receive.

Gates: **Public** needs no sign-in. **requireAuth** needs any signed-in account that is not suspended or banned. **requirePermission(x)** looks up action `x` in `server/src/lib/permissions.ts`, which also blocks Restricted accounts where the table says so. Every Admin route also sits behind `requireRole('ADMIN')`.

## Accounts

| Method | Route | Permission | Record-level check | Tests |
|---|---|---|---|---|
| GET | `/api/auth/config` | Public | None: public | accounts, hardening |
| POST | `/api/auth/register` | Public | None: public, rate limited | accounts, hardening |
| POST | `/api/auth/login` | Public | None: public, rate limited | accounts, hardening |
| POST | `/api/auth/google` | Public | None: public, rate limited | accounts, hardening |
| POST | `/api/auth/logout` | Public | None: public | accounts, hardening |
| GET | `/api/auth/me` | requireAuth | Own account only | accounts, hardening |
| POST | `/api/auth/forgot-password` | Public | None: public, rate limited | accounts, hardening |
| POST | `/api/auth/reset-password` | Public | None: public, rate limited | accounts, hardening |

## Projects (owner and team)

| Method | Route | Permission | Record-level check | Tests |
|---|---|---|---|---|
| GET | `/api/projects/mine` | requireAuth | Own records only | permissions, publish, maintain, hideDelete, security |
| GET | `/api/projects/invites` | requireAuth | Own records only | permissions, publish, maintain, hideDelete, security |
| POST | `/api/projects/invites/:projectId/accept` | requirePermission(publish) | The invited user only | permissions, publish, maintain, hideDelete, security |
| POST | `/api/projects/invites/:projectId/decline` | requireAuth | The invited user only | permissions, publish, maintain, hideDelete, security |
| POST | `/api/projects` | requirePermission(publish) | Own records only | permissions, publish, maintain, hideDelete, security |
| GET | `/api/projects/:id/workspace` | requireAuth | Owner or accepted editor, else 404 | permissions, publish, maintain, hideDelete, security |
| GET | `/api/projects/:id/preview` | requireAuth | Owner or accepted editor, else 404 | permissions, publish, maintain, hideDelete, security |
| PATCH | `/api/projects/:id` | requirePermission(edit) | Owner or accepted editor, else 404 | permissions, publish, maintain, hideDelete, security |
| POST | `/api/projects/:id/submit` | requirePermission(publish) | Owner or accepted editor, else 404 | permissions, publish, maintain, hideDelete, security |
| POST | `/api/projects/:id/media` | requirePermission(edit) | Owner or accepted editor, else 404 | permissions, publish, maintain, hideDelete, security |
| DELETE | `/api/projects/:id/media/:mediaId` | requirePermission(edit) | Owner or accepted editor, else 404 | permissions, publish, maintain, hideDelete, security |
| POST | `/api/projects/:id/cover` | requirePermission(edit) | Owner or accepted editor, else 404 | permissions, publish, maintain, hideDelete, security |
| DELETE | `/api/projects/:id/cover` | requirePermission(edit) | Owner or accepted editor, else 404 | permissions, publish, maintain, hideDelete, security |
| POST | `/api/projects/:id/progress` | requirePermission(edit) | Owner or accepted editor, else 404 | permissions, publish, maintain, hideDelete, security |
| DELETE | `/api/projects/:id/progress/:entryId` | requirePermission(edit) | Owner or accepted editor, else 404 | permissions, publish, maintain, hideDelete, security |
| POST | `/api/projects/:id/milestones` | requirePermission(edit) | Owner or accepted editor, else 404 | permissions, publish, maintain, hideDelete, security |
| PATCH | `/api/projects/:id/milestones/:milestoneId` | requirePermission(edit) | Owner or accepted editor, else 404 | permissions, publish, maintain, hideDelete, security |
| DELETE | `/api/projects/:id/milestones/:milestoneId` | requirePermission(edit) | Owner or accepted editor, else 404 | permissions, publish, maintain, hideDelete, security |
| POST | `/api/projects/:id/members` | requirePermission(edit) | Owner or accepted editor, else 404 | permissions, publish, maintain, hideDelete, security |
| DELETE | `/api/projects/:id/members/:userId` | requireSelfOrEdit | Owner or accepted editor, else 404 | permissions, publish, maintain, hideDelete, security |
| POST | `/api/projects/:id/hide` | requireAuth | Owner or accepted editor, else 404 | permissions, publish, maintain, hideDelete, security |
| POST | `/api/projects/:id/unhide` | requirePermission(edit) | Owner or accepted editor, else 404 | permissions, publish, maintain, hideDelete, security |
| DELETE | `/api/projects/:id` | requireAuth | Owner or accepted editor, else 404 | permissions, publish, maintain, hideDelete, security |

## Discovery (public views)

| Method | Route | Permission | Record-level check | Tests |
|---|---|---|---|---|
| GET | `/api/projects/feed` | Public | Published only; fields by role (FIELDS_BY_TIER); Guest 20-project budget | views, feed, search, projectView |
| GET | `/api/projects/search` | requireAuth | Published only; fields by role (FIELDS_BY_TIER); Guest 20-project budget | views, feed, search, projectView |
| GET | `/api/projects/tags` | requireAuth | Published only; fields by role (FIELDS_BY_TIER); Guest 20-project budget | views, feed, search, projectView |
| GET | `/api/projects/:id/share` | Public | Published only; Guest card fields | sharing, views |
| GET | `/api/projects/:id` | Public | Published only; fields by role (FIELDS_BY_TIER); Guest 20-project budget | views, feed, search, projectView |

## Likes and comments

| Method | Route | Permission | Record-level check | Tests |
|---|---|---|---|---|
| PUT | `/api/projects/:id/like` | requirePermission(like) | Published project, else 404 | engagement, security |
| DELETE | `/api/projects/:id/like` | requirePermission(like) | Published project, else 404 | engagement, security |
| POST | `/api/projects/:id/comments` | requirePermission(comment) | Published project, else 404 | engagement, security |
| PATCH | `/api/projects/:id/comments/:commentId` | requirePermission(comment) | Comment author only (403), published project | engagement, security |
| DELETE | `/api/projects/:id/comments/:commentId` | requirePermission(comment) | Comment author only (403), published project | engagement, security |

## Contact requests and messages

| Method | Route | Permission | Record-level check | Tests |
|---|---|---|---|---|
| POST | `/api/messaging/requests` | requirePermission(contact) | Own records only | messaging, security |
| GET | `/api/messaging/requests` | requireAuth | Own records only | messaging, security |
| POST | `/api/messaging/requests/:id/accept` | requirePermission(contact) | Recipient (accept, decline) or sender (withdraw), else 404 | messaging, security |
| POST | `/api/messaging/requests/:id/decline` | requireAuth | Recipient (accept, decline) or sender (withdraw), else 404 | messaging, security |
| POST | `/api/messaging/requests/:id/withdraw` | requireAuth | Recipient (accept, decline) or sender (withdraw), else 404 | messaging, security |
| GET | `/api/messaging/conversations` | requireAuth | Own records only | messages, security |
| GET | `/api/messaging/conversations/:id/messages` | requireAuth | Participant only, else 404 | messages, security |
| POST | `/api/messaging/conversations/:id/messages` | requirePermission(message) | Participant only, else 404 | messages, security |

## Paid offers

| Method | Route | Permission | Record-level check | Tests |
|---|---|---|---|---|
| POST | `/api/offers` | requirePermission(postOffer) | Project owner or accepted editor, else 404 | offers, security |
| GET | `/api/offers/mine` | requirePermission(postOffer) | Own offers only, else 404 | offers, security |
| POST | `/api/offers/:id/close` | requirePermission(postOffer) | Own offers only, else 404 | offers, security |

## Notifications

| Method | Route | Permission | Record-level check | Tests |
|---|---|---|---|---|
| GET | `/api/notifications` | requireAuth | Own notifications only, else 404 | notifications, security |
| GET | `/api/notifications/unread-count` | requireAuth | Own notifications only, else 404 | notifications, security |
| POST | `/api/notifications/read-all` | requireAuth | Own notifications only, else 404 | notifications, security |
| POST | `/api/notifications/:id/read` | requireAuth | Own notifications only, else 404 | notifications, security |

## Reports

| Method | Route | Permission | Record-level check | Tests |
|---|---|---|---|---|
| POST | `/api/reports` | requirePermission(report) | Target must be visible to the reporter, else 404 | reports |

## Role requests

| Method | Route | Permission | Record-level check | Tests |
|---|---|---|---|---|
| GET | `/api/role-requests/mine` | requireAuth | Own requests only | moderation |
| POST | `/api/role-requests` | requireAuth | Active Uploader only (checked in the service) | moderation |

## Admin

| Method | Route | Permission | Record-level check | Tests |
|---|---|---|---|---|
| GET | `/api/admin/ping` | requireRole(ADMIN) | Record must be in the expected state, else 404 | permissions, reports, publish |
| GET | `/api/admin/reviews` | requireRole(ADMIN) + requirePermission(review) | Record must be in the expected state, else 404 | permissions, reports, publish |
| POST | `/api/admin/reviews/projects/:id/approve` | requireRole(ADMIN) + requirePermission(review) | Record must be in the expected state, else 404 | permissions, reports, publish |
| POST | `/api/admin/reviews/projects/:id/request-changes` | requireRole(ADMIN) + requirePermission(review) | Record must be in the expected state, else 404 | permissions, reports, publish |
| POST | `/api/admin/reviews/revisions/:id/approve` | requireRole(ADMIN) + requirePermission(review) | Record must be in the expected state, else 404 | permissions, reports, publish |
| POST | `/api/admin/reviews/revisions/:id/reject` | requireRole(ADMIN) + requirePermission(review) | Record must be in the expected state, else 404 | permissions, reports, publish |
| GET | `/api/admin/reports` | requireRole(ADMIN) + requirePermission(review) | Record must be in the expected state, else 404 | permissions, reports |
| GET | `/api/admin/reports/:id` | requireRole(ADMIN) + requirePermission(review) | Record must be in the expected state, else 404 | permissions, reports |
| POST | `/api/admin/reports/:id/dismiss` | requireRole(ADMIN) + requirePermission(review) | Record must be in the expected state, else 404 | permissions, reports |
| POST | `/api/admin/reports/:id/confirm` | requireRole(ADMIN) + requirePermission(review) | Record must be in the expected state, else 404 | permissions, moderation |
| GET | `/api/admin/reports/:id/conversation` | requireRole(ADMIN) + requirePermission(review) | Open report about that conversation; read is audited | permissions, moderation |
| GET | `/api/admin/offers` | requireRole(ADMIN) + requirePermission(review) | Record must be in the expected state, else 404 | permissions, offers |
| POST | `/api/admin/offers/:id/approve` | requireRole(ADMIN) + requirePermission(review) | Record must be in the expected state, else 404 | permissions, offers |
| POST | `/api/admin/offers/:id/reject` | requireRole(ADMIN) + requirePermission(review) | Record must be in the expected state, else 404 | permissions, offers |
| GET | `/api/admin/projects/removed` | requireRole(ADMIN) + requirePermission(removeProject) | Confirmed report about that project | permissions, moderation |
| POST | `/api/admin/projects/:id/remove` | requireRole(ADMIN) + requirePermission(removeProject) | Confirmed report about that project | permissions, moderation |
| POST | `/api/admin/projects/:id/re-review` | requireRole(ADMIN) + requirePermission(removeProject) | Record must be in the expected state, else 404 | permissions, moderation |
| GET | `/api/admin/users` | requireRole(ADMIN) + requirePermission(controlAccess) | Record must be in the expected state, else 404 | permissions, moderation |
| GET | `/api/admin/users/:id/audit` | requireRole(ADMIN) + requirePermission(controlAccess) | Record must be in the expected state, else 404 | permissions, moderation |
| POST | `/api/admin/users/:id/status` | requireRole(ADMIN) + requirePermission(controlAccess) | Professional target, not self, allowed transition | permissions, moderation |
| GET | `/api/admin/role-requests` | requireRole(ADMIN) + requirePermission(changeRole) | Record must be in the expected state, else 404 | permissions, moderation |
| POST | `/api/admin/role-requests/:id/approve` | requireRole(ADMIN) + requirePermission(changeRole) | Record must be in the expected state, else 404 | permissions, moderation |
| POST | `/api/admin/role-requests/:id/reject` | requireRole(ADMIN) + requirePermission(changeRole) | Record must be in the expected state, else 404 | permissions, moderation |

## Share page

| Method | Route | Permission | Record-level check | Tests |
|---|---|---|---|---|
| GET | `/p/:id` | Public | Published only; Guest card fields, HTML-escaped | sharing |

83 routes in all.

## Checked and left as they are

- **Register (409) and team invites (201 or 404) reveal whether an email has an account.** Both are rate limited. Hiding this would need email verification, which the project does not have.
- **Admins get 403, not 404, on routes their role can never use** (sending messages, accepting contact requests). The role gate refuses them before any record is looked up, so the answer is the same for every id and reveals nothing.
- **A signed URL for a screenshot contains its storage path.** This is how Supabase signed URLs work, and the URL expires. The path is never returned as its own field.
- **Project removal needs a confirmed report.** The plan also allowed "a review decision" as the basis; only the report route is built, because it leaves a clear record of why.
