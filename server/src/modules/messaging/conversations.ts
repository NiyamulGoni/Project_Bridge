import { z } from 'zod';
import type { AuthUser } from '../../domain.js';
import { BLOCKED_STATUSES } from '../../domain.js';
import { decrypt, encrypt } from '../../lib/crypto.js';
import { HttpError } from '../../lib/errors.js';
import { prisma, TX_OPTIONS } from '../../lib/prisma.js';
import { notify } from '../notifications/service.js';

/** The context binds the stored value to this column. */
export const MESSAGE_CONTEXT = 'Message.body';
const PAGE_SIZE = 30;

export const messageSchema = z.object({
  body: z.string({ required_error: 'Write a message.' }).trim().min(1, 'Write a message.').max(2000, 'Messages can be at most 2000 characters.'),
});
export const messagesQuery = z.object({ cursor: z.string().trim().min(1).max(100).optional() });

const notFound = () => new HttpError(404, 'NOT_FOUND', 'Conversation not found.');

export function readBody(stored: string): string | null {
  try {
    return decrypt(stored, MESSAGE_CONTEXT);
  } catch {
    return null;
  }
}

/** A conversation someone is not part of is a 404, the same as one that does not exist. Admins included. */
async function participantIn(user: AuthUser, conversationId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, participants: { some: { userId: user.id } } },
    include: { participants: { include: { user: { select: { id: true, name: true, status: true } } } } },
  });
  if (!conversation) throw notFound();
  const other = conversation.participants.find((p) => p.userId !== user.id)?.user ?? null;
  return { conversation, other };
}

/** Your own conversations, newest activity first. The other person is shown by name only. */
export async function listConversations(user: AuthUser) {
  const rows = await prisma.conversation.findMany({
    where: { participants: { some: { userId: user.id } } },
    include: {
      participants: { include: { user: { select: { id: true, name: true } } } },
      messages: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 },
      // Kept even if the project is later hidden or deleted; the title is shown only while published.
      contactRequest: { select: { project: { select: { id: true, title: true, status: true } } } },
    },
  });
  const items = rows.map((c) => {
    const other = c.participants.find((p) => p.userId !== user.id)?.user;
    const last = c.messages[0];
    const project = c.contactRequest?.project;
    return {
      id: c.id,
      with: other ? { id: other.id, name: other.name } : null,
      project: project?.status === 'PUBLISHED' ? { id: project.id, title: project.title } : null,
      lastMessage: last ? { preview: (readBody(last.body) ?? '').slice(0, 80), mine: last.senderId === user.id, createdAt: last.createdAt.toISOString() } : null,
      updatedAt: (last?.createdAt ?? c.createdAt).toISOString(),
    };
  });
  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { items };
}

/** Newest first, a page at a time. Pass the returned nextCursor to read older messages. */
export async function listMessages(user: AuthUser, conversationId: string, cursor?: string) {
  const { other } = await participantIn(user, conversationId);
  if (cursor) {
    const anchor = await prisma.message.findFirst({ where: { id: cursor, conversationId }, select: { id: true } });
    if (!anchor) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid cursor.');
  }
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, PAGE_SIZE);
  return {
    with: other ? { id: other.id, name: other.name } : null,
    items: page.map((m) => ({ id: m.id, body: readBody(m.body), mine: m.senderId === user.id, createdAt: m.createdAt.toISOString() })),
    nextCursor: rows.length > PAGE_SIZE ? page[page.length - 1].id : null,
  };
}

/** The body is stored encrypted. The other person gets one notice until they have read it. */
export async function sendMessage(user: AuthUser, conversationId: string, body: string) {
  const { other } = await participantIn(user, conversationId);
  if (!other || BLOCKED_STATUSES.includes(other.status)) {
    throw new HttpError(409, 'NOT_CONTACTABLE', 'This person can no longer receive messages.');
  }
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({ data: { conversationId, senderId: user.id, body: encrypt(body, MESSAGE_CONTEXT) } });
    const pending = await tx.notification.findFirst({
      where: { recipientId: other.id, eventType: 'NEW_MESSAGE', targetId: conversationId, isRead: false },
      select: { id: true },
    });
    if (!pending) {
      await notify({ recipientId: other.id, eventType: 'NEW_MESSAGE', message: `${user.name} sent you a message.`, targetType: 'Conversation', targetId: conversationId }, tx);
    }
    return created;
  }, TX_OPTIONS);
  return { message: { id: message.id, body, mine: true, createdAt: message.createdAt.toISOString() } };
}
