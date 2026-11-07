import type { Prisma } from '@prisma/client';
import type { AuthUser } from '../../domain.js';
import { HttpError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

const PAGE_SIZE = 20;

export interface NotificationInput {
  recipientId: string;
  eventType: string;
  message: string;
  targetType?: string;
  targetId?: string;
}

/** Pass the transaction client to commit the notice with the change it announces. */
export async function notify(input: NotificationInput, client: Prisma.TransactionClient = prisma): Promise<void> {
  await client.notification.create({ data: input });
}

export async function listNotifications(user: AuthUser, page: number) {
  const rows = await prisma.notification.findMany({
    where: { recipientId: user.id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE + 1,
  });
  return {
    page,
    items: rows.slice(0, PAGE_SIZE).map((n) => ({
      id: n.id,
      eventType: n.eventType,
      message: n.message,
      targetType: n.targetType,
      targetId: n.targetId,
      isRead: n.isRead,
      createdAt: n.createdAt.toISOString(),
    })),
    hasMore: rows.length > PAGE_SIZE,
  };
}

export function unreadCount(user: AuthUser): Promise<number> {
  return prisma.notification.count({ where: { recipientId: user.id, isRead: false } });
}

/** Someone else's notification is a 404, the same as one that does not exist. */
export async function markRead(user: AuthUser, id: string): Promise<void> {
  const { count } = await prisma.notification.updateMany({ where: { id, recipientId: user.id }, data: { isRead: true } });
  if (count === 0) throw new HttpError(404, 'NOT_FOUND', 'Notification not found.');
}

export async function markAllRead(user: AuthUser): Promise<void> {
  await prisma.notification.updateMany({ where: { recipientId: user.id, isRead: false }, data: { isRead: true } });
}
