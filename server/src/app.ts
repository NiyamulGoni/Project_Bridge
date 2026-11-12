import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { errorHandler, HttpError } from './lib/errors.js';
import { checkOrigin, requireHttps } from './middleware/security.js';
import { loadSession } from './middleware/session.js';
import { accountsRouter } from './modules/accounts/routes.js';
import { adminRouter } from './modules/admin/routes.js';
import { discoveryRouter } from './modules/discovery/routes.js';
import { engagementRouter } from './modules/engagement/routes.js';
import { messagingRouter } from './modules/messaging/routes.js';
import { offersRouter } from './modules/offers/routes.js';
import { notificationsRouter } from './modules/notifications/routes.js';
import { projectsRouter } from './modules/projects/routes.js';
import { rolesRouter } from './modules/roles/routes.js';
import { shareRouter } from './modules/sharing/routes.js';
import { reportsRouter } from './modules/reports/routes.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use(requireHttps);
  app.use(
    helmet({
      strictTransportSecurity: config.isProd ? { maxAge: 15552000, includeSubDomains: true } : false,
    }),
  );
  app.use(checkOrigin);
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
  app.use('/api/projects', engagementRouter);
  app.use('/api/messaging', messagingRouter);
  app.use('/api/offers', offersRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/role-requests', rolesRouter);
  app.use('/api/admin', adminRouter);
  app.use('/p', shareRouter);

  app.use('/api', () => {
    throw new HttpError(404, 'NOT_FOUND', 'API route not found.');
  });
  app.use(errorHandler);
  return app;
}
