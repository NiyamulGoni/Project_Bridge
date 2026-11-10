import { Router } from 'express';
import { param } from '../../lib/params.js';
import { shareInfo, sharePage } from './service.js';

/** FR12: /p/:id, the public link people paste into social media. Published projects only. */
export const shareRouter = Router();

shareRouter.get('/:id', async (req, res) => {
  res.type('html').send(sharePage(await shareInfo(param(req, 'id'))));
});
