import type { Role } from '../domain.js';

export interface Permission {
  /** Account roles that may perform the action. */
  roles: readonly Role[];
  /** Whether a RESTRICTED account (FR16) may still perform it. */
  allowedWhenRestricted: boolean;
}

/**
 * The one table of who may do what (I1). This decides by account role and status only; rights
 * on a particular project come from ownership and membership, see modules/projects/access.ts.
 */
export const PERMISSIONS = {
  /** Create a project, submit it, accept a team invite. */
  publish: { roles: ['UPLOADER', 'PROFESSIONAL'], allowedWhenRestricted: false },
  /** Change a project the user already has rights on, or their own profile. All roles, so those rights survive a role change. */
  edit: { roles: ['UPLOADER', 'PROFESSIONAL', 'ADMIN'], allowedWhenRestricted: false },
  like: { roles: ['PROFESSIONAL'], allowedWhenRestricted: false },
  comment: { roles: ['PROFESSIONAL'], allowedWhenRestricted: false },
  contact: { roles: ['UPLOADER', 'PROFESSIONAL'], allowedWhenRestricted: false },
  message: { roles: ['UPLOADER', 'PROFESSIONAL'], allowedWhenRestricted: false },
  postOffer: { roles: ['PROFESSIONAL'], allowedWhenRestricted: false },
  report: { roles: ['UPLOADER', 'PROFESSIONAL'], allowedWhenRestricted: true },
  review: { roles: ['ADMIN'], allowedWhenRestricted: false },
  removeProject: { roles: ['ADMIN'], allowedWhenRestricted: false },
  changeRole: { roles: ['ADMIN'], allowedWhenRestricted: false },
  controlAccess: { roles: ['ADMIN'], allowedWhenRestricted: false },
} as const satisfies Record<string, Permission>;

export type PermissionAction = keyof typeof PERMISSIONS;
