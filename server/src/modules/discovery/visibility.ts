import type { Milestone, Prisma, ProgressEntry, Project, User } from '@prisma/client';
import type { AuthUser } from '../../domain.js';

/** A paid offer as the Professional tier sees it; built in modules/offers. */
export type OfferView = { id: string; title: string; skills: string[]; type: string; compensation: string; currency: string; applicationRoute: string; status: string; createdAt: string; paymentNotice: string };

/** I2: what each viewer may see (proposal Section 4.2). */
export type ViewerTier = 'GUEST' | 'UPLOADER' | 'PROFESSIONAL';

/** Only published projects are eligible for feeds, search and direct views. */
export const ELIGIBLE: Prisma.ProjectWhereInput = { status: 'PUBLISHED' };
export const NEWEST_FIRST: Prisma.ProjectOrderByWithRelationInput[] = [{ publishedAt: 'desc' }, { id: 'desc' }];

export const GUEST_SUMMARY_LIMIT = 150;
export const UPLOADER_OVERVIEW_LIMIT = 500;

interface TierRules {
  /** Max summary characters; null = full. */
  summaryLimit: number | null;
  /** Max overview characters; 0 = none, null = full. */
  overviewLimit: number | null;
  /** Problem statement (part of the Professional expanded overview). */
  problem: boolean;
  /** Demo link and screenshots: never, only when the owner marked them public, or always. */
  demo: 'never' | 'ifPublic' | 'always';
  /** Progress entries and milestones (the roadmap), shown as the project bulletin. Every signed-in tier gets it. */
  roadmap: boolean;
  /** Owner and accepted team members, by name only. */
  team: boolean;
  /** Like and comment counts, and in the detail view the comments themselves (FR08, FR09). */
  engagement: boolean;
  /** Approved, open paid offers (FR11). */
  offers: boolean;
}

/**
 * Section 4.2, in one place. Guest: title, tags, thumbnail, 150-character summary.
 * Uploader: adds 500 characters of overview, owner-designated public demo material, and the roadmap
 * (milestones and progress, for the project bulletin).
 * Professional: full overview, demo, progress and public team profile.
 * No tier ever receives contact details, drafts or unpublished material.
 */
export const FIELDS_BY_TIER: Record<ViewerTier, TierRules> = {
  GUEST: { summaryLimit: GUEST_SUMMARY_LIMIT, overviewLimit: 0, problem: false, demo: 'never', roadmap: false, team: false, engagement: false, offers: false },
  UPLOADER: { summaryLimit: GUEST_SUMMARY_LIMIT, overviewLimit: UPLOADER_OVERVIEW_LIMIT, problem: false, demo: 'ifPublic', roadmap: true, team: false, engagement: false, offers: false },
  PROFESSIONAL: { summaryLimit: null, overviewLimit: null, problem: true, demo: 'always', roadmap: true, team: true, engagement: true, offers: true },
};

export function viewerTier(user: AuthUser | undefined): ViewerTier {
  if (!user) return 'GUEST';
  // Admins review full content, so they get the most complete view.
  return user.role === 'PROFESSIONAL' || user.role === 'ADMIN' ? 'PROFESSIONAL' : 'UPLOADER';
}

/** Cuts text to at most `max` characters, including the ellipsis. */
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function limitText(text: string, limit: number | null): string | undefined {
  if (limit === 0) return undefined;
  return limit === null ? text : truncate(text, limit);
}

/** Whether this tier may see the demo link and screenshots of this project. */
export function showsDemo(project: Pick<Project, 'publicDemo'>, tier: ViewerTier): boolean {
  const rule = FIELDS_BY_TIER[tier].demo;
  return rule === 'always' || (rule === 'ifPublic' && project.publicDemo);
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
  likeCount?: number;
  commentCount?: number;
  isSynthetic: boolean;
}

/** Counted inside the card query itself, so a page of cards costs one query, not one per card. */
export const ENGAGEMENT_COUNTS = { _count: { select: { likes: true, comments: true } } } as const;
type Counts = { _count?: { likes: number; comments: number } };

/** What to load with each card for this tier: always the owner's name, counts only where shown. */
export function cardInclude(tier: ViewerTier) {
  return { owner: { select: { name: true } }, ...(FIELDS_BY_TIER[tier].engagement ? ENGAGEMENT_COUNTS : {}) };
}

/**
 * Builds the card for one viewer. Restricted fields are left out of the response
 * instead of being hidden in the browser (NFR-S2).
 */
export function toCard(project: Project & { owner: Pick<User, 'name'> } & Counts, tier: ViewerTier): ProjectCard {
  const rules = FIELDS_BY_TIER[tier];
  const card: ProjectCard = {
    id: project.id,
    title: project.title,
    tags: project.tags,
    stage: project.stage,
    thumbnailUrl: project.thumbnailUrl,
    summary: limitText(project.summary, rules.summaryLimit) ?? '',
    isSynthetic: project.isSynthetic,
  };
  const overview = limitText(project.overview, rules.overviewLimit);
  if (overview !== undefined) card.overview = overview;
  if (rules.team) card.owner = { name: project.owner.name };
  if (rules.engagement && project._count) {
    card.likeCount = project._count.likes;
    card.commentCount = project._count.comments;
  }
  return card;
}

export interface TeamMember {
  name: string;
  role: 'OWNER' | 'EDITOR';
}

export interface ProjectDetail extends ProjectCard {
  problem?: string;
  demoUrl?: string | null;
  screenshots?: Array<{ id: string; url: string }>;
  team?: TeamMember[];
  milestones?: Array<{ id: string; title: string; status: string; dueDate: string | null }>;
  progress?: Array<{ id: string; body: string; createdAt: string }>;
  /** The team's own "how much is done", 0–100, or null when it is left to milestones and stage. */
  completion?: number | null;
  likedByMe?: boolean;
  comments?: Array<{ id: string; body: string; author: { id: string; name: string }; mine: boolean; edited: boolean; createdAt: string }>;
  offers?: OfferView[];
  // Contribution/hiring information (Section 4.2, Professional) attaches here once it exists.
}

export type DetailSource = Project & Counts & {
  owner: Pick<User, 'name'>;
  members: Array<{ role: string; status: string; user: Pick<User, 'name'> }>;
  milestones: Milestone[];
  progress: ProgressEntry[];
};

/**
 * FR07: the expanded project view for one viewer. `screenshots` must already be signed;
 * they are only attached when the tier may see demo material.
 */
export function toDetail(
  project: DetailSource,
  tier: ViewerTier,
  screenshots: Array<{ id: string; url: string }> = [],
  engagement?: Pick<ProjectDetail, 'likedByMe' | 'comments'>,
  offers?: OfferView[],
): ProjectDetail {
  const rules = FIELDS_BY_TIER[tier];
  const detail: ProjectDetail = toCard(project, tier);
  if (rules.problem) detail.problem = project.problem;
  if (showsDemo(project, tier)) {
    detail.demoUrl = project.demoUrl;
    detail.screenshots = screenshots;
  }
  if (rules.roadmap) {
    detail.completion = project.completion ?? null;
    detail.milestones = [...project.milestones]
      .sort((a, b) => a.position - b.position)
      .map((m) => ({ id: m.id, title: m.title, status: m.status, dueDate: m.dueDate?.toISOString() ?? null }));
    detail.progress = [...project.progress]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((e) => ({ id: e.id, body: e.body, createdAt: e.createdAt.toISOString() }));
  }
  if (rules.team) {
    detail.team = [
      { name: project.owner.name, role: 'OWNER' },
      ...project.members.filter((m) => m.status === 'ACCEPTED').map((m) => ({ name: m.user.name, role: 'EDITOR' as const })),
    ];
  }
  if (rules.engagement && engagement) {
    detail.likedByMe = engagement.likedByMe;
    detail.comments = engagement.comments;
  }
  if (rules.offers && offers) detail.offers = offers;
  return detail;
}
