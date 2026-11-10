import { Router } from 'express';
import { param } from '../../lib/params.js';
import { requirePermission } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import * as offers from './service.js';

/**
 * FR11: paid offers, posted by active Professionals on projects they own or edit. Approved, open
 * offers are read through the Professional project view; Admins review them under /api/admin/offers.
 */
export const offersRouter = Router();

offersRouter.post('/', requirePermission('postOffer'), validateBody(offers.createOfferSchema), async (req, res) => {
  res.status(201).json(await offers.createOffer(req.user!, req.body));
});

offersRouter.get('/mine', requirePermission('postOffer'), async (req, res) => {
  res.json(await offers.listMyOffers(req.user!));
});

offersRouter.post('/:id/close', requirePermission('postOffer'), async (req, res) => {
  await offers.closeOffer(req.user!, param(req, 'id'));
  res.json({ ok: true });
});
