import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { errorHandler, HttpError } from './lib/errors.js';
import { loadSession } from './middleware/session.js';
import { accountsRouter } from './modules/accounts/routes.js';
import { adminRouter } from './modules/admin/routes.js';
import { discoveryRouter } from './modules/discovery/routes.js';
import { projectsRouter } from './modules/projects/routes.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(loadSession);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/auth', accountsRouter);
  // Owner/editor routes first, so /mine and /invites are not read as a project id.
  app.use('/api/projects', projectsRouter);
  app.use('/api/projects', discoveryRouter);
  app.use('/api/admin', adminRouter);

  app.use('/api', () => {
    throw new HttpError(404, 'NOT_FOUND', 'API route not found.');
  });
  app.use(errorHandler);
  return app;
}
