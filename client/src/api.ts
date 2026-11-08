export type Role = 'UPLOADER' | 'PROFESSIONAL' | 'ADMIN';
export type AccountStatus = 'ACTIVE' | 'RESTRICTED' | 'SUSPENDED' | 'BANNED';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: AccountStatus;
  hasPassword: boolean;
  googleLinked: boolean;
}

export interface ProjectCard {
  id: string;
  title: string;
  tags: string[];
  stage: string;
  thumbnailUrl: string | null;
  summary: string;
  overview?: string;
  owner?: { name: string };
  /** Professional tier only (FR08, FR09). */
  likeCount?: number;
  commentCount?: number;
  isSynthetic: boolean;
}

export interface ProjectComment {
  id: string;
  body: string;
  author: { id: string; name: string };
  mine: boolean;
  edited: boolean;
  createdAt: string;
}

export type ViewerTier = 'GUEST' | 'UPLOADER' | 'PROFESSIONAL';

export interface FeedPage {
  tier: ViewerTier;
  page: number;
  items: ProjectCard[];
  hasMore: boolean;
  guest?: { limit: number; cardsServed: number; capReached: boolean };
}

export interface SearchPage extends FeedPage {
  total: number;
  query: { q: string; tags: string[] };
}

export const STAGES = ['IDEA', 'PROTOTYPE', 'MVP', 'PILOT', 'LAUNCHED'] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<string, string> = {
  IDEA: 'Idea',
  PROTOTYPE: 'Prototype',
  MVP: 'MVP',
  PILOT: 'Pilot',
  LAUNCHED: 'Launched',
};

export type ProjectStatus = 'DRAFT' | 'SUBMITTED' | 'CHANGES_REQUESTED' | 'PUBLISHED' | 'HIDDEN' | 'REMOVED' | 'DELETED';
export const STATUS_LABELS: Record<ProjectStatus, { label: string; badge: string }> = {
  DRAFT: { label: 'Draft', badge: '' },
  SUBMITTED: { label: 'In review', badge: 'badge-navy' },
  CHANGES_REQUESTED: { label: 'Changes requested', badge: 'badge-amber' },
  PUBLISHED: { label: 'Published', badge: 'badge-success' },
  HIDDEN: { label: 'Hidden', badge: '' },
  REMOVED: { label: 'Removed by Admin', badge: 'badge-amber' },
  DELETED: { label: 'Deleted', badge: '' },
};

export type MilestoneStatus = 'PLANNED' | 'IN_PROGRESS' | 'DONE';
export const MILESTONE_LABELS: Record<MilestoneStatus, string> = { PLANNED: 'Planned', IN_PROGRESS: 'In progress', DONE: 'Done' };

/** FR07: what the server chose to send for this viewer; absent fields are not available to them. */
export interface ProjectDetail extends ProjectCard {
  problem?: string;
  demoUrl?: string | null;
  screenshots?: Array<{ id: string; url: string }>;
  team?: Array<{ name: string; role: 'OWNER' | 'EDITOR' }>;
  milestones?: Array<{ id: string; title: string; status: MilestoneStatus; dueDate: string | null }>;
  progress?: Array<{ id: string; body: string; createdAt: string }>;
  /** Professional tier only. */
  likedByMe?: boolean;
  comments?: ProjectComment[];
}

export interface ProjectContent {
  title: string;
  summary: string;
  problem: string;
  overview: string;
  tags: string[];
  demoUrl: string | null;
}

export interface Revision extends ProjectContent {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewNote: string | null;
  createdAt: string;
}

export interface Workspace {
  myRole: 'OWNER' | 'EDITOR';
  project: ProjectContent & {
    id: string;
    stage: Stage;
    publicDemo: boolean;
    thumbnailUrl: string | null;
    status: ProjectStatus;
    reviewNote: string | null;
    submittedAt: string | null;
    publishedAt: string | null;
    updatedAt: string;
    owner: { name: string };
  };
  revision: Revision | null;
  media: Array<{ id: string; url: string | null; mimeType: string; sizeBytes: number }>;
  /** Someone who has not accepted has no name or user id here. */
  members: Array<{ id: string; userId: string; name: string; status: 'ACCEPTED' } | { id: string; userId?: undefined; name?: undefined; status: 'INVITED' | 'DECLINED' }>;
  milestones: Array<{ id: string; title: string; status: MilestoneStatus; dueDate: string | null }>;
  progress: Array<{ id: string; body: string; createdAt: string; authorName: string }>;
}

export interface MyProject {
  id: string;
  title: string;
  status: ProjectStatus;
  stage: Stage;
  tags: string[];
  reviewNote: string | null;
  updatedAt: string;
  publishedAt: string | null;
  myRole: 'OWNER' | 'EDITOR';
  hasPendingRevision: boolean;
}

export interface Invite {
  projectId: string;
  title: string;
  ownerName: string;
  invitedAt: string;
}

export interface ReviewQueue {
  submissions: Array<
    ProjectContent & {
      id: string;
      stage: Stage;
      owner: { name: string; email: string };
      submittedAt: string | null;
      ownershipDeclaredAt: string | null;
      screenshots: Array<{ id: string; url: string }>;
    }
  >;
  revisions: Array<{
    id: string;
    projectId: string;
    owner: { name: string; email: string };
    submittedAt: string;
    current: ProjectContent;
    proposed: ProjectContent;
  }>;
}

export interface AppNotification {
  id: string;
  eventType: string;
  message: string;
  targetType: string | null;
  targetId: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface ContactRequest {
  id: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'WITHDRAWN';
  /** Null if it cannot be decrypted. */
  introduction: string | null;
  from: { id: string; name: string } | null;
  to: { id: string; name: string } | null;
  project: { id: string; title: string } | null;
  conversationId: string | null;
  createdAt: string;
  respondedAt: string | null;
}

export interface AdminReport {
  id: string;
  targetType: 'PROJECT' | 'COMMENT' | 'OFFER' | 'USER' | 'CONVERSATION';
  targetId: string;
  reason: string | null;
  status: 'OPEN' | 'CONFIRMED' | 'DISMISSED';
  decisionNote: string | null;
  reporter: { name: string };
  createdAt: string;
  reviewedAt: string | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: options.method ?? (options.body ? 'POST' : 'GET'),
      credentials: 'include',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
  }
  return parse<T>(res);
}

async function parse<T>(res: Response): Promise<T> {
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.code ?? 'UNKNOWN', err.message ?? 'Something went wrong.', err.fields ?? {});
  }
  return data as T;
}

/** Multipart upload; the browser sets the multipart Content-Type and boundary itself. */
export async function upload<T>(path: string, form: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method: 'POST', credentials: 'include', body: form });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
  }
  return parse<T>(res);
}

export const ROLE_LABELS: Record<Role, string> = {
  UPLOADER: 'Uploader (Project Developer)',
  PROFESSIONAL: 'Professional (Industry Expert)',
  ADMIN: 'Admin',
};
