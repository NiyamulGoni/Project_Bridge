import type { Project } from '@prisma/client';
import type { AuthUser } from '../../domain.js';
import { HttpError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

export type ProjectAccess = 'edit' | 'own';

export interface AccessibleProject {
  project: Project;
  isOwner: boolean;
}

const notFound = () => new HttpError(404, 'NOT_FOUND', 'Project not found.');

/**
 * Loads a project the user may edit (owner or accepted editor) or owns.
 * Rights come from ownership/membership only, never from the account role, so they
 * survive a role change (Section 4.2). Anything else is a 404, so the response never
 * reveals that a private project exists.
 */
export async function loadProjectFor(user: AuthUser, id: string, need: ProjectAccess): Promise<AccessibleProject> {
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project || project.status === 'DELETED') throw notFound();
  const isOwner = project.ownerId === user.id;
  if (need === 'own' && !isOwner) throw notFound();
  if (!isOwner) {
    const member = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: id, userId: user.id } },
    });
    if (member?.status !== 'ACCEPTED') throw notFound();
  }
  return { project, isOwner };
}

/** FR04: hidden, removed or deleted projects accept no new contact requests. */
export function isContactable(project: Pick<Project, 'status'>): boolean {
  return project.status === 'PUBLISHED';
}
