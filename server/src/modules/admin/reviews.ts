import type { AuthUser } from '../../domain.js';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { signScreenshots } from '../projects/media.js';

/**
 * Minimal review queue for FR02/FR03: approve submissions and revisions, or send them back
 * with a note. The rest of moderation (FR13–FR16) builds on this later.
 */

function reviewAudit(action: string, admin: AuthUser, projectId: string, reason?: string) {
  return audit({ action, actorId: admin.id, targetType: 'Project', targetId: projectId, reason });
}

const content = (p: { title: string; summary: string; problem: string; overview: string; tags: string[]; demoUrl: string | null }) => ({
  title: p.title,
  summary: p.summary,
  problem: p.problem,
  overview: p.overview,
  tags: p.tags,
  demoUrl: p.demoUrl,
});

export async function listReviews() {
  const [submissions, revisions] = await Promise.all([
    prisma.project.findMany({
      where: { status: 'SUBMITTED' },
      orderBy: { submittedAt: 'asc' },
      include: { owner: { select: { name: true, email: true } }, media: true },
    }),
    prisma.projectRevision.findMany({
      where: { status: 'PENDING', project: { status: { in: ['PUBLISHED', 'HIDDEN'] } } },
      orderBy: { updatedAt: 'asc' },
      include: { project: { include: { owner: { select: { name: true, email: true } } } } },
    }),
  ]);

  return {
    submissions: await Promise.all(
      submissions.map(async (p) => ({
        id: p.id,
        ...content(p),
        stage: p.stage,
        owner: p.owner,
        submittedAt: p.submittedAt?.toISOString() ?? null,
        ownershipDeclaredAt: p.ownershipDeclaredAt?.toISOString() ?? null,
        screenshots: await signScreenshots(p.media),
      })),
    ),
    revisions: revisions.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      owner: r.project.owner,
      submittedAt: r.updatedAt.toISOString(),
      current: content(r.project),
      proposed: content(r),
    })),
  };
}

export async function approveProject(admin: AuthUser, id: string) {
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project || project.status !== 'SUBMITTED') throw new HttpError(404, 'NOT_FOUND', 'No submission waiting for review.');
  await prisma.project.update({
    where: { id },
    data: { status: 'PUBLISHED', publishedAt: project.publishedAt ?? new Date(), reviewNote: null },
  });
  await reviewAudit('PROJECT_APPROVED', admin, id);
}

export async function requestChanges(admin: AuthUser, id: string, note: string) {
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project || project.status !== 'SUBMITTED') throw new HttpError(404, 'NOT_FOUND', 'No submission waiting for review.');
  await prisma.project.update({ where: { id }, data: { status: 'CHANGES_REQUESTED', reviewNote: note } });
  await reviewAudit('PROJECT_CHANGES_REQUESTED', admin, id, note);
}

/** Copies the proposed content onto the live project in one transaction. */
export async function approveRevision(admin: AuthUser, revisionId: string) {
  const revision = await prisma.projectRevision.findUnique({ where: { id: revisionId }, include: { project: true } });
  if (!revision || revision.status !== 'PENDING' || !['PUBLISHED', 'HIDDEN'].includes(revision.project.status)) {
    throw new HttpError(404, 'NOT_FOUND', 'No revision waiting for review.');
  }
  await prisma.$transaction([
    prisma.project.update({ where: { id: revision.projectId }, data: content(revision) }),
    prisma.projectRevision.update({ where: { id: revisionId }, data: { status: 'APPROVED', reviewNote: null } }),
  ]);
  await reviewAudit('REVISION_APPROVED', admin, revision.projectId, revisionId);
}

/** The previously approved content simply stays live. */
export async function rejectRevision(admin: AuthUser, revisionId: string, note: string) {
  const revision = await prisma.projectRevision.findUnique({ where: { id: revisionId } });
  if (!revision || revision.status !== 'PENDING') throw new HttpError(404, 'NOT_FOUND', 'No revision waiting for review.');
  await prisma.projectRevision.update({ where: { id: revisionId }, data: { status: 'REJECTED', reviewNote: note } });
  await reviewAudit('REVISION_REJECTED', admin, revision.projectId, note);
}
