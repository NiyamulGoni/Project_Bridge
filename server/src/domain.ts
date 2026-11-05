import type { User } from '@prisma/client';

export const ROLES = ['UPLOADER', 'PROFESSIONAL', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const ACCOUNT_STATUSES = ['ACTIVE', 'RESTRICTED', 'SUSPENDED', 'BANNED'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** Statuses that revoke signed-in access entirely (FR16, NFR-S3). */
export const BLOCKED_STATUSES: readonly string[] = ['SUSPENDED', 'BANNED'];

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: AccountStatus;
  /** False for Google-only accounts that have never set a password. */
  hasPassword: boolean;
  googleLinked: boolean;
}

export function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as Role,
    status: user.status as AccountStatus,
    hasPassword: user.passwordHash !== null,
    googleLinked: user.googleId !== null,
  };
}

/** What a sign-in response says about the account. Only /api/auth/me returns the email. */
export function toSignInView(user: AuthUser) {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    status: user.status,
    hasPassword: user.hasPassword,
    googleLinked: user.googleLinked,
  };
}

export const PROJECT_STAGES = ['IDEA', 'PROTOTYPE', 'MVP', 'PILOT', 'LAUNCHED'] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

/** DRAFT → SUBMITTED → PUBLISHED (or CHANGES_REQUESTED → SUBMITTED); PUBLISHED ↔ HIDDEN; any → DELETED. */
export const PROJECT_STATUSES = ['DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'PUBLISHED', 'HIDDEN', 'REMOVED', 'DELETED'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Statuses an owner may still edit directly, without review. */
export const EDITABLE_DRAFT_STATUSES: readonly string[] = ['DRAFT', 'CHANGES_REQUESTED'];
/** Statuses where overview/demo changes go through a revision (FR03). */
export const LIVE_STATUSES: readonly string[] = ['PUBLISHED', 'HIDDEN'];

export const REVISION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export const MEMBER_STATUSES = ['INVITED', 'ACCEPTED', 'DECLINED'] as const;
export const MILESTONE_STATUSES = ['PLANNED', 'IN_PROGRESS', 'DONE'] as const;
