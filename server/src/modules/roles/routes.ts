import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import * as roles from './service.js';

/** FR15: asking for the Professional role. Admins decide under /api/admin/role-requests. */
export const rolesRouter = Router();

rolesRouter.get('/mine', requireAuth, async (req, res) => {
  res.json(await roles.myRoleRequests(req.user!));
});

// The service checks role and status: only an active Uploader may ask.
rolesRouter.post('/', requireAuth, validateBody(roles.roleRequestSchema), async (req, res) => {
  res.status(201).json(await roles.requestProfessional(req.user!, req.body.reason));
});
