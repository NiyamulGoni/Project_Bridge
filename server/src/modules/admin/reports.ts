import type { Report } from '@prisma/client';
import { z } from 'zod';
import { REPORT_STATUSES, type AuthUser } from '../../domain.js';
import { audit } from '../../lib/audit.js';
import { decrypt } from '../../lib/crypto.js';
import { HttpError } from '../../lib/errors.js';
import { prisma, TX_OPTIONS } from '../../lib/prisma.js';
import { notify } from '../notifications/service.js';
import { REASON_CONTEXT } from '../reports/service.js';

const PAGE_SIZE = 20;

export const reportListQuery = z.object({
  status: z.enum(REPORT_STATUSES).default('OPEN'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

/** A value that cannot be decrypted, for example after a key mix-up, must not take down the whole queue. */
function readReason(stored: string): string | null {
  try {
    return decrypt(stored, REASON_CONTEXT);
  } catch {
    return null;
  }
}

const reportView = (r: Report & { reporter: { name: string } }) => ({
  id: r.id,
  targetType: r.targetType,
  targetId: r.targetId,
  reason: readReason(r.reason),
  status: r.status,
  decisionNote: r.decisionNote,
  reporter: { name: r.reporter.name },
  createdAt: r.createdAt.toISOString(),
  reviewedAt: r.reviewedAt?.toISOString() ?? null,
});

const REPORTER = { reporter: { select: { name: true } } };

export async function listReports({ status, page }: z.infer<typeof reportListQuery>) {
  const rows = await prisma.report.findMany({
    where: { status },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: REPORTER,
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE + 1,
  });
  return { page, items: rows.slice(0, PAGE_SIZE).map(reportView), hasMore: rows.length > PAGE_SIZE };
}

export async function getReport(id: string) {
  const report = await prisma.report.findUnique({ where: { id }, include: REPORTER });
  if (!report) throw new HttpError(404, 'NOT_FOUND', 'Report not found.');
  return { report: reportView(report) };
}

/** Closes a report with no action on its target. */
export async function dismissReport(admin: AuthUser, id: string, note: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const report = await tx.report.findUnique({ where: { id }, select: { reporterId: true } });
    const { count } = await tx.report.updateMany({
      where: { id, status: 'OPEN' },
      data: { status: 'DISMISSED', decisionNote: note, reviewedById: admin.id, reviewedAt: new Date() },
    });
    if (!report || count === 0) throw new HttpError(404, 'NOT_FOUND', 'No open report with that id.');
    await audit({ action: 'REPORT_DISMISSED', actorId: admin.id, targetType: 'Report', targetId: id, reason: note, oldValue: 'OPEN', newValue: 'DISMISSED' }, tx);
    await notify({ recipientId: report.reporterId, eventType: 'REPORT_CLOSED', message: 'Your report was reviewed and closed with no action.', targetType: 'Report', targetId: id }, tx);
  }, TX_OPTIONS);
}
