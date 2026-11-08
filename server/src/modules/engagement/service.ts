import type { Comment, User } from '@prisma/client';
import type { AuthUser } from '../../domain.js';
import { HttpError } from '../../lib/errors.js';
import { prisma, TX_OPTIONS } from '../../lib/prisma.js';
import { ELIGIBLE } from '../discovery/visibility.js';
import { notify } from '../notifications/service.js';

/** How many comments the project view carries, newest first. */
export const COMMENTS_SHOWN = 50;

const projectNotFound = () => new HttpError(404, 'NOT_FOUND', 'Project not found.');

async function publishedProject(id: string) {
  const project = await prisma.project.findFirst({ where: { ...ELIGIBLE, id }, select: { id: true, title: true, ownerId: true } });
  if (!project) throw projectNotFound();
  return project;
}

export type CommentSource = Comment & { author: Pick<User, 'id' | 'name'> };

/** The author is named, never emailed. `mine` lets the page offer edit and delete. */
export function toCommentView(c: CommentSource, viewerId: string) {
  return {
    id: c.id,
    body: c.body,
    author: { id: c.author.id, name: c.author.name },
    mine: c.authorId === viewerId,
    edited: c.updatedAt.getTime() - c.createdAt.getTime() > 1000,
    createdAt: c.createdAt.toISOString(),
  };
}

const likeCount = (projectId: string) => prisma.projectLike.count({ where: { projectId } });

/** Idempotent: liking twice still counts once, because (project, user) is the primary key. */
export async function like(user: AuthUser, projectId: string) {
  await publishedProject(projectId);
  await prisma.projectLike.createMany({ data: [{ projectId, userId: user.id }], skipDuplicates: true });
  return { liked: true, likeCount: await likeCount(projectId) };
}

/** Idempotent: unliking a project you never liked is not an error. */
export async function unlike(user: AuthUser, projectId: string) {
  await publishedProject(projectId);
  await prisma.projectLike.deleteMany({ where: { projectId, userId: user.id } });
  return { liked: false, likeCount: await likeCount(projectId) };
}

export async function addComment(user: AuthUser, projectId: string, body: string) {
  const project = await publishedProject(projectId);
  const comment = await prisma.$transaction(async (tx) => {
    const created = await tx.comment.create({ data: { projectId, authorId: user.id, body }, include: { author: { select: { id: true, name: true } } } });
    if (project.ownerId !== user.id) {
      await notify(
        { recipientId: project.ownerId, eventType: 'PROJECT_COMMENTED', message: `${user.name} commented on "${project.title}".`, targetType: 'Project', targetId: projectId },
        tx,
      );
    }
    return created;
  }, TX_OPTIONS);
  return { comment: toCommentView(comment, user.id) };
}

/** Only the author may change a comment, and only while its project is published. */
async function ownComment(user: AuthUser, projectId: string, commentId: string) {
  const comment = await prisma.comment.findFirst({ where: { id: commentId, projectId, project: ELIGIBLE }, select: { authorId: true } });
  if (!comment) throw new HttpError(404, 'NOT_FOUND', 'Comment not found.');
  if (comment.authorId !== user.id) throw new HttpError(403, 'FORBIDDEN', 'Only the author can change this comment.');
}

export async function editComment(user: AuthUser, projectId: string, commentId: string, body: string) {
  await ownComment(user, projectId, commentId);
  const comment = await prisma.comment.update({ where: { id: commentId }, data: { body }, include: { author: { select: { id: true, name: true } } } });
  return { comment: toCommentView(comment, user.id) };
}

export async function deleteComment(user: AuthUser, projectId: string, commentId: string): Promise<void> {
  await ownComment(user, projectId, commentId);
  await prisma.comment.delete({ where: { id: commentId } });
}

/** What the Professional project view adds: whether this viewer liked it, and the latest comments. */
export async function engagementFor(user: AuthUser, projectId: string) {
  const [liked, comments] = await Promise.all([
    prisma.projectLike.findUnique({ where: { projectId_userId: { projectId, userId: user.id } }, select: { userId: true } }),
    prisma.comment.findMany({
      where: { projectId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: COMMENTS_SHOWN,
      include: { author: { select: { id: true, name: true } } },
    }),
  ]);
  return { likedByMe: liked !== null, comments: comments.map((c) => toCommentView(c, user.id)) };
}
