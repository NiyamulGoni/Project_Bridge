import { Router } from 'express';
import { HttpError } from '../../lib/errors.js';
import { param } from '../../lib/params.js';
import { requirePermission, requireRole } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { reviewNoteSchema } from '../projects/schemas.js';
import { dismissReportSchema } from '../reports/schemas.js';
import * as offers from '../offers/service.js';
import * as moderation from './moderation.js';
import * as reports from './reports.js';
import * as reviews from './reviews.js';

/** Admin area. UC13–UC16 attach here: the review queue and the report queue so far. */
export const adminRouter = Router();

adminRouter.use(requireRole('ADMIN'));

adminRouter.get('/ping', (req, res) => {
  res.json({ ok: true, message: `Admin access granted to ${req.user!.name}.` });
});

adminRouter.get('/reviews', requirePermission('review'), async (_req, res) => {
  res.json(await reviews.listReviews());
});

adminRouter.post('/reviews/projects/:id/approve', requirePermission('review'), async (req, res) => {
  await reviews.approveProject(req.user!, param(req, 'id'));
  res.json({ ok: true });
});

adminRouter.post('/reviews/projects/:id/request-changes', requirePermission('review'), validateBody(reviewNoteSchema), async (req, res) => {
  await reviews.requestChanges(req.user!, param(req, 'id'), req.body.note);
  res.json({ ok: true });
});

adminRouter.post('/reviews/revisions/:id/approve', requirePermission('review'), async (req, res) => {
  await reviews.approveRevision(req.user!, param(req, 'id'));
  res.json({ ok: true });
});

adminRouter.post('/reviews/revisions/:id/reject', requirePermission('review'), validateBody(reviewNoteSchema), async (req, res) => {
  await reviews.rejectRevision(req.user!, param(req, 'id'), req.body.note);
  res.json({ ok: true });
});

adminRouter.get('/reports', requirePermission('review'), async (req, res) => {
  const parsed = reports.reportListQuery.safeParse(req.query);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid report filter.');
  res.json(await reports.listReports(parsed.data));
});

adminRouter.get('/reports/:id', requirePermission('review'), async (req, res) => {
  res.json(await reports.getReport(param(req, 'id')));
});

adminRouter.post('/reports/:id/dismiss', requirePermission('review'), validateBody(dismissReportSchema), async (req, res) => {
  await reports.dismissReport(req.user!, param(req, 'id'), req.body.note);
  res.json({ ok: true });
});

adminRouter.post('/reports/:id/confirm', requirePermission('review'), validateBody(dismissReportSchema), async (req, res) => {
  await moderation.confirmReport(req.user!, param(req, 'id'), req.body.note);
  res.json({ ok: true });
});

adminRouter.get('/reports/:id/conversation', requirePermission('review'), async (req, res) => {
  res.json(await moderation.reportedConversation(req.user!, param(req, 'id')));
});

adminRouter.get('/offers', requirePermission('review'), async (_req, res) => {
  res.json(await offers.listPendingOffers());
});

adminRouter.post('/offers/:id/approve', requirePermission('review'), async (req, res) => {
  await offers.reviewOffer(req.user!, param(req, 'id'), 'APPROVED');
  res.json({ ok: true });
});

adminRouter.post('/offers/:id/reject', requirePermission('review'), validateBody(reviewNoteSchema), async (req, res) => {
  await offers.reviewOffer(req.user!, param(req, 'id'), 'REJECTED', req.body.note);
  res.json({ ok: true });
});

adminRouter.get('/projects/removed', requirePermission('removeProject'), async (_req, res) => {
  res.json(await moderation.listRemovedProjects());
});

adminRouter.post('/projects/:id/remove', requirePermission('removeProject'), validateBody(moderation.removeProjectSchema), async (req, res) => {
  await moderation.removeProject(req.user!, param(req, 'id'), req.body);
  res.json({ ok: true });
});

adminRouter.post('/projects/:id/re-review', requirePermission('removeProject'), validateBody(moderation.reasonSchema), async (req, res) => {
  await moderation.reReviewProject(req.user!, param(req, 'id'), req.body.reason);
  res.json({ ok: true });
});

adminRouter.get('/users', requirePermission('controlAccess'), async (req, res) => {
  const parsed = moderation.userListQuery.safeParse(req.query);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid user search.');
  res.json(await moderation.listUsers(parsed.data));
});

adminRouter.get('/users/:id/audit', requirePermission('controlAccess'), async (req, res) => {
  res.json(await moderation.userAudit(param(req, 'id')));
});

adminRouter.post('/users/:id/status', requirePermission('controlAccess'), validateBody(moderation.statusSchema), async (req, res) => {
  await moderation.setAccess(req.user!, param(req, 'id'), req.body);
  res.json({ ok: true });
});

adminRouter.get('/role-requests', requirePermission('changeRole'), async (_req, res) => {
  res.json(await moderation.listRoleRequests());
});

adminRouter.post('/role-requests/:id/approve', requirePermission('changeRole'), validateBody(moderation.reasonSchema), async (req, res) => {
  await moderation.decideRoleRequest(req.user!, param(req, 'id'), 'APPROVED', req.body.reason);
  res.json({ ok: true });
});

adminRouter.post('/role-requests/:id/reject', requirePermission('changeRole'), validateBody(moderation.reasonSchema), async (req, res) => {
  await moderation.decideRoleRequest(req.user!, param(req, 'id'), 'REJECTED', req.body.reason);
  res.json({ ok: true });
});
