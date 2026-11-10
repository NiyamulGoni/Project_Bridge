import { z } from 'zod';
import type { AuthUser } from '../../domain.js';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../lib/errors.js';
import { prisma, TX_OPTIONS } from '../../lib/prisma.js';
import { readBody } from '../messaging/conversations.js';
import { notify } from '../notifications/service.js';

const reason = z.string({ required_error: 'Give a reason.' }).trim().min(3, 'Give a reason.').max(1000);
export const reasonSchema = z.object({ reason });
export const removeProjectSchema = z.object({ reason, reportId: z.string({ required_error: 'Name the confirmed report this is based on.' }).trim().min(1).max(100) });

// ---------------------------------------------------------------- FR14: removing a project

/**
 * Needs a CONFIRMED report about this project: an open or dismissed one cannot trigger removal.
 * Status, audit row and owner notice commit together. The owner's account is never touched.
 */
export async function removeProject(admin: AuthUser, id: string, input: z.infer<typeof removeProjectSchema>) {
  await prisma.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id }, select: { ownerId: true, title: true, status: true } });
    if (!project || !['PUBLISHED', 'HIDDEN'].includes(project.status)) throw new HttpError(404, 'NOT_FOUND', 'No live project with that id.');
    const report = await tx.report.findFirst({ where: { id: input.reportId, targetType: 'PROJECT', targetId: id, status: 'CONFIRMED' }, select: { id: true } });
    if (!report) throw new HttpError(409, 'NO_CONFIRMED_REPORT', 'A project can only be removed on a confirmed report about it.');
    const { count } = await tx.project.updateMany({ where: { id, status: project.status }, data: { status: 'REMOVED', removedAt: new Date() } });
    if (count === 0) throw new HttpError(409, 'CONFLICT', 'The project changed while you were deciding. Please reload.');
    await audit({ action: 'PROJECT_REMOVED', actorId: admin.id, targetType: 'Project', targetId: id, reason: input.reason, oldValue: project.status, newValue: 'REMOVED' }, tx);
    await notify({ recipientId: project.ownerId, eventType: 'PROJECT_REMOVED', message: `"${project.title}" was removed by an Admin: ${input.reason}`, targetType: 'ProjectWorkspace', targetId: id }, tx);
  }, TX_OPTIONS);
}

/** The only way back: REMOVED to SUBMITTED, so it passes review again before it is public. */
export async function reReviewProject(admin: AuthUser, id: string, why: string) {
  await prisma.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id }, select: { ownerId: true, title: true } });
    const { count } = await tx.project.updateMany({ where: { id, status: 'REMOVED' }, data: { status: 'SUBMITTED', removedAt: null, submittedAt: new Date() } });
    if (!project || count === 0) throw new HttpError(404, 'NOT_FOUND', 'No removed project with that id.');
    await audit({ action: 'PROJECT_RE_REVIEW', actorId: admin.id, targetType: 'Project', targetId: id, reason: why, oldValue: 'REMOVED', newValue: 'SUBMITTED' }, tx);
    await notify({ recipientId: project.ownerId, eventType: 'PROJECT_RE_REVIEW', message: `"${project.title}" is back in review.`, targetType: 'ProjectWorkspace', targetId: id }, tx);
  }, TX_OPTIONS);
}

export async function listRemovedProjects() {
  const rows = await prisma.project.findMany({ where: { status: 'REMOVED' }, orderBy: { removedAt: 'desc' }, select: { id: true, title: true, removedAt: true, owner: { select: { name: true } } } });
  return { items: rows.map((p) => ({ id: p.id, title: p.title, removedAt: p.removedAt?.toISOString() ?? null, owner: { name: p.owner.name } })) };
}

// ---------------------------------------------------------------- FR15, FR16: users, roles and access

const USER_PAGE = 20;
export const userListQuery = z.object({
  q: z.string().trim().max(100).default(''),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

/** Names, roles and statuses. No emails: an Admin acts on an account, not on an address. */
export async function listUsers({ q, page }: z.infer<typeof userListQuery>) {
  const rows = await prisma.user.findMany({
    where: q ? { name: { contains: q, mode: 'insensitive' } } : {},
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * USER_PAGE,
    take: USER_PAGE + 1,
    select: { id: true, name: true, role: true, status: true, createdAt: true },
  });
  return { page, items: rows.slice(0, USER_PAGE).map((u) => ({ ...u, createdAt: u.createdAt.toISOString() })), hasMore: rows.length > USER_PAGE };
}

/** What was done to or by this account, newest first. */
export async function userAudit(id: string) {
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, name: true, role: true, status: true } });
  if (!user) throw new HttpError(404, 'NOT_FOUND', 'User not found.');
  const rows = await prisma.auditLog.findMany({
    where: { OR: [{ actorId: id }, { targetType: 'User', targetId: id }] },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 50,
  });
  return {
    user,
    items: rows.map((r) => ({ id: r.id, action: r.action, byThisUser: r.actorId === id, targetType: r.targetType, reason: r.reason, oldValue: r.oldValue, newValue: r.newValue, createdAt: r.createdAt.toISOString() })),
  };
}

/** Uploader to Professional only. Projects and memberships are untouched, so ownership is kept. */
async function promote(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], admin: AuthUser, userId: string, why: string) {
  if (userId === admin.id) throw new HttpError(403, 'FORBIDDEN', 'You cannot change your own role.');
  const { count } = await tx.user.updateMany({ where: { id: userId, role: 'UPLOADER', status: 'ACTIVE' }, data: { role: 'PROFESSIONAL' } });
  if (count === 0) throw new HttpError(409, 'INVALID_TRANSITION', 'Only an active Uploader can be made a Professional.');
  await audit({ action: 'ROLE_CHANGED', actorId: admin.id, targetType: 'User', targetId: userId, reason: why, oldValue: 'UPLOADER', newValue: 'PROFESSIONAL' }, tx);
  await notify({ recipientId: userId, eventType: 'ROLE_CHANGED', message: 'You are now a Professional. You can like, comment and post offers.' }, tx);
}

export async function listRoleRequests() {
  const rows = await prisma.roleRequest.findMany({ where: { status: 'PENDING' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { user: { select: { id: true, name: true, role: true, status: true } } } });
  return { items: rows.map((r) => ({ id: r.id, reason: r.reason, createdAt: r.createdAt.toISOString(), user: r.user })) };
}

export async function decideRoleRequest(admin: AuthUser, id: string, decision: 'APPROVED' | 'REJECTED', why: string) {
  await prisma.$transaction(async (tx) => {
    const request = await tx.roleRequest.findUnique({ where: { id }, select: { userId: true } });
    const { count } = await tx.roleRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: decision, pendingKey: null, decisionNote: why, reviewedById: admin.id, reviewedAt: new Date() },
    });
    if (!request || count === 0) throw new HttpError(404, 'NOT_FOUND', 'No role request waiting for review.');
    if (decision === 'APPROVED') {
      await promote(tx, admin, request.userId, why);
    } else {
      await audit({ action: 'ROLE_REQUEST_REJECTED', actorId: admin.id, targetType: 'User', targetId: request.userId, reason: why }, tx);
      await notify({ recipientId: request.userId, eventType: 'ROLE_REQUEST_REJECTED', message: `Your request for the Professional role was not approved: ${why}` }, tx);
    }
  }, TX_OPTIONS);
}

/** The only status changes an Admin may make (FR16). */
const TRANSITIONS: Record<string, readonly string[]> = {
  ACTIVE: ['RESTRICTED', 'SUSPENDED', 'BANNED'],
  RESTRICTED: ['ACTIVE'],
  SUSPENDED: ['ACTIVE', 'BANNED'],
  BANNED: ['ACTIVE'],
};
export const statusSchema = z.object({ status: z.enum(['ACTIVE', 'RESTRICTED', 'SUSPENDED', 'BANNED']), reason });

const STATUS_NOTICE: Record<string, string> = {
  ACTIVE: 'Your account has full access again.',
  RESTRICTED: 'Your account was restricted. You can still sign in, read and report.',
  SUSPENDED: 'Your account was suspended.',
  BANNED: 'Your account was banned.',
};

/**
 * Professional accounts only, and never the Admin's own. Status, ending live sessions, audit row
 * and notice commit together. Projects the account owns are never deleted.
 */
export async function setAccess(admin: AuthUser, userId: string, input: z.infer<typeof statusSchema>) {
  if (userId === admin.id) throw new HttpError(403, 'FORBIDDEN', 'You cannot change your own access.');
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true, status: true } });
    if (!user) throw new HttpError(404, 'NOT_FOUND', 'User not found.');
    if (user.role !== 'PROFESSIONAL') throw new HttpError(409, 'INVALID_TARGET', 'Access control applies to Professional accounts only.');
    if (!TRANSITIONS[user.status]?.includes(input.status)) {
      throw new HttpError(409, 'INVALID_TRANSITION', `An account cannot go from ${user.status} to ${input.status}.`);
    }
    const { count } = await tx.user.updateMany({ where: { id: userId, status: user.status, role: 'PROFESSIONAL' }, data: { status: input.status } });
    if (count === 0) throw new HttpError(409, 'CONFLICT', 'The account changed while you were deciding. Please reload.');
    if (input.status === 'SUSPENDED' || input.status === 'BANNED') await tx.session.deleteMany({ where: { userId } });
    await audit({ action: 'ACCESS_CHANGED', actorId: admin.id, targetType: 'User', targetId: userId, reason: input.reason, oldValue: user.status, newValue: input.status }, tx);
    await notify({ recipientId: userId, eventType: 'ACCESS_CHANGED', message: `${STATUS_NOTICE[input.status]} Reason: ${input.reason}` }, tx);
  }, TX_OPTIONS);
}

// ---------------------------------------------------------------- Reports: confirm, and message evidence

/** Marks a report as upheld. On its own this changes nothing about the target; removal is a separate decision. */
export async function confirmReport(admin: AuthUser, id: string, note: string) {
  await prisma.$transaction(async (tx) => {
    const report = await tx.report.findUnique({ where: { id }, select: { reporterId: true } });
    const { count } = await tx.report.updateMany({ where: { id, status: 'OPEN' }, data: { status: 'CONFIRMED', decisionNote: note, reviewedById: admin.id, reviewedAt: new Date() } });
    if (!report || count === 0) throw new HttpError(404, 'NOT_FOUND', 'No open report with that id.');
    await audit({ action: 'REPORT_CONFIRMED', actorId: admin.id, targetType: 'Report', targetId: id, reason: note, oldValue: 'OPEN', newValue: 'CONFIRMED' }, tx);
    await notify({ recipientId: report.reporterId, eventType: 'REPORT_CLOSED', message: 'Your report was reviewed and confirmed. Thank you.', targetType: 'Report', targetId: id }, tx);
  }, TX_OPTIONS);
}

/**
 * The one way an Admin reads private messages: through an OPEN report that names the conversation.
 * Every read is written to the audit log first.
 */
export async function reportedConversation(admin: AuthUser, reportId: string) {
  const report = await prisma.report.findFirst({ where: { id: reportId, status: 'OPEN', targetType: 'CONVERSATION' }, select: { targetId: true } });
  if (!report) throw new HttpError(404, 'NOT_FOUND', 'No open report about a conversation with that id.');
  await audit({ action: 'CONVERSATION_READ', actorId: admin.id, targetType: 'Conversation', targetId: report.targetId, reason: `Report ${reportId}` });
  const messages = await prisma.message.findMany({
    where: { conversationId: report.targetId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 200,
    include: { sender: { select: { id: true, name: true } } },
  });
  return { conversationId: report.targetId, items: messages.map((m) => ({ id: m.id, body: readBody(m.body), sender: m.sender, createdAt: m.createdAt.toISOString() })) };
}
