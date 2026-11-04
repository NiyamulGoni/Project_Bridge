import type { RequestHandler } from 'express';
import type { Role } from '../domain.js';
import { HttpError } from '../lib/errors.js';
import { PERMISSIONS, type Permission, type PermissionAction } from '../lib/permissions.js';

/** I1: the request must come from a signed-in, non-blocked account. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
  next();
};

/** I1: the signed-in account must hold one of the given roles. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
    if (!roles.includes(req.user.role)) {
      throw new HttpError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
    }
    next();
  };
}

/**
 * I1: the signed-in account may perform this action, per the table in lib/permissions.ts.
 * Goes before validateBody and upload handlers, so a denied request's body is never processed.
 */
export function requirePermission(action: PermissionAction): RequestHandler {
  const permission: Permission = PERMISSIONS[action];
  const gate: RequestHandler = (req, _res, next) => {
    if (!req.user) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
    if (!permission.roles.includes(req.user.role)) {
      throw new HttpError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
    }
    if (req.user.status === 'RESTRICTED' && !permission.allowedWhenRestricted) {
      throw new HttpError(403, 'ACCOUNT_RESTRICTED', 'Your account is restricted, so you cannot do this. Please contact an administrator.');
    }
    next();
  };
  // Named for its action: several actions share a table entry, so behaviour alone cannot tell which gate a route uses.
  return Object.defineProperty(gate, 'name', { value: `requirePermission(${action})` });
}
