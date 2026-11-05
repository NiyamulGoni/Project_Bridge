import type { RequestHandler } from 'express';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const APP_ORIGIN = new URL(config.appUrl).origin;
// Vite moves to another port when its usual one is taken.
const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;

/**
 * Production only: sends plain HTTP to the same path on the HTTPS site. The target comes from
 * APP_URL and never the Host header, so it cannot become an open redirect. Health checks are exempt
 * because hosting platforms usually call them over HTTP.
 */
export const requireHttps: RequestHandler = (req, res, next) => {
  if (!config.isProd || req.secure) return next();
  if (req.method === 'GET' && req.path === '/api/health') return next();
  // An absolute-form request target ("GET http://other/") has no path of ours to keep.
  const path = req.originalUrl.startsWith('/') ? req.originalUrl : '/';
  res.redirect(308, config.appUrl + path);
};

/**
 * Refuses state-changing requests sent from another site, before the body is parsed. A request with
 * no Origin header passes, since SameSite=Lax cookies already cover browsers.
 */
export const checkOrigin: RequestHandler = (req, _res, next) => {
  const origin = req.headers.origin;
  if (SAFE_METHODS.has(req.method) || origin === undefined || origin === APP_ORIGIN) return next();
  if (config.isExplicitDev && DEV_ORIGIN.test(origin)) return next();
  throw new HttpError(403, 'BAD_ORIGIN', 'This request came from a site that is not allowed.');
};
