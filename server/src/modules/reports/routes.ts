import { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';
import { reportLimiter } from '../../middleware/rateLimit.js';
import { validateBody } from '../../middleware/validate.js';
import { createReportSchema } from './schemas.js';
import * as reports from './service.js';

/** FR13: signed-in users file reports here. Admins handle them under /api/admin/reports. */
export const reportsRouter = Router();

reportsRouter.post('/', requirePermission('report'), reportLimiter, validateBody(createReportSchema), async (req, res) => {
  res.status(201).json(await reports.createReport(req.user!, req.body));
});
