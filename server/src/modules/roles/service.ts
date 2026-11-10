import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { AuthUser } from '../../domain.js';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../lib/errors.js';
import { prisma, TX_OPTIONS } from '../../lib/prisma.js';

export const roleRequestSchema = z.object({
  reason: z.string({ required_error: 'Say why you should be a Professional.' }).trim().min(20, 'Explain in at least 20 characters.').max(1000),
});

const view = (r: { id: string; status: string; reason: string; decisionNote: string | null; createdAt: Date; reviewedAt: Date | null }) => ({
  id: r.id,
  status: r.status,
  reason: r.reason,
  decisionNote: r.decisionNote,
  createdAt: r.createdAt.toISOString(),
  reviewedAt: r.reviewedAt?.toISOString() ?? null,
});

/** FR15: an active Uploader asks to become a Professional. Only an Admin can grant it. */
export async function requestProfessional(user: AuthUser, reason: string) {
  if (user.role !== 'UPLOADER') throw new HttpError(403, 'FORBIDDEN', 'Only Uploaders can request the Professional role.');
  if (user.status !== 'ACTIVE') throw new HttpError(403, 'ACCOUNT_RESTRICTED', 'Your account is restricted, so you cannot do this. Please contact an administrator.');
  try {
    return await prisma.$transaction(async (tx) => {
      const request = await tx.roleRequest.create({ data: { userId: user.id, reason, pendingKey: user.id } });
      await audit({ action: 'ROLE_REQUESTED', actorId: user.id, targetType: 'User', targetId: user.id }, tx);
      return { request: view(request) };
    }, TX_OPTIONS);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new HttpError(409, 'ALREADY_REQUESTED', 'You already have a request waiting for review.');
    }
    throw err;
  }
}

export async function myRoleRequests(user: AuthUser) {
  const rows = await prisma.roleRequest.findMany({ where: { userId: user.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 10 });
  return { items: rows.map(view) };
}
