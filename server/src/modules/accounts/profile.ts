import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../../domain.js';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { getCoverStorage } from '../../lib/storage.js';
import { imageExtension } from '../projects/media.js';

interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
}

/** P2021: the UserProfile table is not in this database yet (its migration has not been applied). */
function isMissingTable(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2021';
}

function profilesUnavailable(): HttpError {
  return new HttpError(503, 'PROFILE_UNAVAILABLE', 'Cover photos are not available yet. Please try again later.');
}

/** Storage path of a cover uploaded here; null for none. */
function coverPath(userId: string, coverUrl: string | null | undefined): string | null {
  const start = coverUrl?.indexOf(`users/${userId}/`) ?? -1;
  return start >= 0 ? coverUrl!.slice(start) : null;
}

async function readCoverUrl(userId: string): Promise<string | null> {
  try {
    const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { coverUrl: true } });
    return profile?.coverUrl ?? null;
  } catch (err) {
    // Without the table the rest of the account page still works; there is simply no cover.
    if (isMissingTable(err)) return null;
    throw err;
  }
}

/**
 * The signed-in user's own profile: cover photo and activity since the account was created.
 * Only counts, so nothing about other people is exposed.
 */
export async function myProfile(user: AuthUser) {
  const owned = { ownerId: user.id, status: { not: 'DELETED' } };
  const [account, coverUrl, byStatus, teamProjects, likesReceived, commentsReceived, likesGiven, commentsWritten, requestsSent, requestsReceived, messagesSent, offersPosted] =
    await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { createdAt: true } }),
      readCoverUrl(user.id),
      prisma.project.groupBy({ by: ['status'], where: owned, _count: { _all: true } }),
      prisma.projectMember.count({ where: { userId: user.id, status: 'ACCEPTED', project: { status: { not: 'DELETED' } } } }),
      prisma.projectLike.count({ where: { project: owned, userId: { not: user.id } } }),
      prisma.comment.count({ where: { project: owned, authorId: { not: user.id } } }),
      prisma.projectLike.count({ where: { userId: user.id } }),
      prisma.comment.count({ where: { authorId: user.id } }),
      prisma.contactRequest.count({ where: { senderId: user.id } }),
      prisma.contactRequest.count({ where: { recipientId: user.id } }),
      prisma.message.count({ where: { senderId: user.id } }),
      prisma.paidOffer.count({ where: { authorId: user.id } }),
    ]);

  const countOf = (...statuses: string[]) =>
    byStatus.filter((g) => statuses.includes(g.status)).reduce((sum, g) => sum + g._count._all, 0);

  return {
    coverUrl,
    memberSince: account.createdAt.toISOString(),
    stats: {
      projects: {
        uploaded: countOf('DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'PUBLISHED', 'HIDDEN', 'REMOVED'),
        published: countOf('PUBLISHED'),
        inReview: countOf('SUBMITTED'),
        drafts: countOf('DRAFT', 'CHANGES_REQUESTED'),
        hidden: countOf('HIDDEN'),
        removed: countOf('REMOVED'),
        team: teamProjects,
      },
      likesReceived,
      commentsReceived,
      likesGiven,
      commentsWritten,
      contactRequestsSent: requestsSent,
      contactRequestsReceived: requestsReceived,
      messagesSent,
      offersPosted,
    },
  };
}

/** Sets or replaces the user's own cover photo. It lives in the public cover bucket, as project covers do. */
export async function setProfileCover(user: AuthUser, file: UploadedFile | undefined) {
  if (!file) throw new HttpError(400, 'VALIDATION_ERROR', 'Choose an image.');
  const ext = imageExtension(file.mimetype, file.buffer);
  if (!ext) throw new HttpError(400, 'INVALID_FILE', 'The cover photo must be a PNG, JPEG or WebP image.');

  // Checked before uploading, so a database without the table leaves no orphan file behind.
  const previous = await prisma.userProfile.findUnique({ where: { userId: user.id } }).catch((err) => {
    if (isMissingTable(err)) throw profilesUnavailable();
    throw err;
  });

  const storage = getCoverStorage();
  const path = `users/${user.id}/cover-${randomUUID()}.${ext}`;
  await storage.upload(path, file.buffer, file.mimetype);
  const coverUrl = storage.publicUrl(path);
  try {
    await prisma.userProfile.upsert({ where: { userId: user.id }, create: { userId: user.id, coverUrl }, update: { coverUrl } });
  } catch (err) {
    await storage.remove([path]).catch(() => undefined);
    throw err;
  }
  const old = coverPath(user.id, previous?.coverUrl);
  if (old) await storage.remove([old]).catch((err) => console.error(`[storage] Could not remove old profile cover: ${(err as Error).message}`));
  await audit({ action: 'PROFILE_COVER_SET', actorId: user.id, targetType: 'User', targetId: user.id });
  return { coverUrl };
}

export async function removeProfileCover(user: AuthUser): Promise<void> {
  let previous: string | null | undefined;
  try {
    previous = (await prisma.userProfile.findUnique({ where: { userId: user.id } }))?.coverUrl;
    if (previous) await prisma.userProfile.update({ where: { userId: user.id }, data: { coverUrl: null } });
  } catch (err) {
    if (isMissingTable(err)) return; // Nothing can have been stored.
    throw err;
  }
  const old = coverPath(user.id, previous);
  if (old) await getCoverStorage().remove([old]).catch((err) => console.error(`[storage] Could not remove profile cover: ${(err as Error).message}`));
  if (previous) await audit({ action: 'PROFILE_COVER_REMOVED', actorId: user.id, targetType: 'User', targetId: user.id });
}
