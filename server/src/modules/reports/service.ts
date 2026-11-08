import type { z } from 'zod';
import type { AuthUser } from '../../domain.js';
import { audit } from '../../lib/audit.js';
import { encrypt } from '../../lib/crypto.js';
import { HttpError } from '../../lib/errors.js';
import { prisma, TX_OPTIONS } from '../../lib/prisma.js';
import type { createReportSchema } from './schemas.js';

/** The context binds the stored value to this column. Admin routes decrypt with the same one. */
export const REASON_CONTEXT = 'Report.reason';

const nothingToReport = () => new HttpError(404, 'NOT_FOUND', 'There is nothing to report here.');

/**
 * Projects, users, comments and conversations are checked here. Offers do not exist yet, so the step
 * that adds them must add its check too.
 */
async function assertReportable(user: AuthUser, targetType: string, targetId: string): Promise<void> {
  if (targetType === 'PROJECT') {
    const project = await prisma.project.findFirst({ where: { id: targetId, status: 'PUBLISHED' }, select: { id: true } });
    if (!project) throw nothingToReport();
  }
  if (targetType === 'USER') {
    if (targetId === user.id) throw new HttpError(400, 'VALIDATION_ERROR', 'You cannot report your own account.');
    const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!target) throw nothingToReport();
  }
  if (targetType === 'COMMENT') {
    const comment = await prisma.comment.findFirst({ where: { id: targetId, project: { status: 'PUBLISHED' } }, select: { authorId: true } });
    if (!comment) throw nothingToReport();
    if (comment.authorId === user.id) throw new HttpError(400, 'VALIDATION_ERROR', 'You cannot report your own comment.');
  }
  // Only someone in the conversation can know it exists, so only they can report it.
  if (targetType === 'CONVERSATION') {
    const participant = await prisma.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId: targetId, userId: user.id } } });
    if (!participant) throw nothingToReport();
  }
}

/** Files a report. It changes nothing about its target; only an Admin decision can. */
export async function createReport(user: AuthUser, input: z.infer<typeof createReportSchema>) {
  const { targetType, targetId, reason } = input;
  await assertReportable(user, targetType, targetId);
  const open = await prisma.report.findFirst({ where: { reporterId: user.id, targetType, targetId, status: 'OPEN' }, select: { id: true } });
  if (open) throw new HttpError(409, 'ALREADY_REPORTED', 'You already have an open report about this.');

  const encrypted = encrypt(reason, REASON_CONTEXT);
  return prisma.$transaction(async (tx) => {
    const report = await tx.report.create({ data: { reporterId: user.id, targetType, targetId, reason: encrypted } });
    await audit({ action: 'REPORT_FILED', actorId: user.id, targetType: 'Report', targetId: report.id }, tx);
    return { id: report.id, status: report.status };
  }, TX_OPTIONS);
}
