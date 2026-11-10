import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import type { AuthUser } from '../../domain.js';
import { decrypt, encrypt } from '../../lib/crypto.js';
import { HttpError } from '../../lib/errors.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { prisma, TX_OPTIONS } from '../../lib/prisma.js';
import { ELIGIBLE } from '../discovery/visibility.js';
import { notify } from '../notifications/service.js';
import type { createRequestSchema, listRequestsQuery } from './schemas.js';

/** The context binds the stored value to this column. */
export const INTRO_CONTEXT = 'ContactRequest.introduction';
const PAGE_SIZE = 20;

/** Only active accounts whose role may take part in conversations can be contacted. */
const CONTACTABLE: Prisma.UserWhereInput = { status: 'ACTIVE', role: { in: [...PERMISSIONS.contact.roles] } };

const notFound = (what: string) => new HttpError(404, 'NOT_FOUND', `${what} not found.`);
const notPending = () => new HttpError(409, 'NOT_PENDING', 'This request is no longer pending.');

/** The recipient is resolved here, so the sender never sees an email or even needs one. */
async function resolveRecipient(sender: AuthUser, input: z.infer<typeof createRequestSchema>) {
  if (input.offerId) {
    // Offers are shown to Professionals only, so to anyone else this one does not exist.
    const offer = sender.role === 'PROFESSIONAL'
      ? await prisma.paidOffer.findFirst({
          where: { id: input.offerId, reviewStatus: 'APPROVED', project: ELIGIBLE },
          select: { id: true, title: true, status: true, authorId: true, projectId: true, author: { select: { status: true } } },
        })
      : null;
    if (!offer) throw notFound('Offer');
    if (offer.authorId === sender.id) throw new HttpError(400, 'VALIDATION_ERROR', 'You cannot contact yourself.');
    if (offer.status !== 'OPEN') throw new HttpError(409, 'OFFER_CLOSED', 'This offer is closed and takes no new requests.');
    if (offer.author.status !== 'ACTIVE') throw new HttpError(409, 'NOT_CONTACTABLE', "The offer's author can't be contacted right now.");
    return { recipientId: offer.authorId, projectId: offer.projectId, offerId: offer.id, about: ` about the offer "${offer.title}"` };
  }
  if (input.projectId) {
    const project = await prisma.project.findFirst({
      where: { ...ELIGIBLE, id: input.projectId },
      select: { id: true, title: true, ownerId: true, owner: { select: { status: true, role: true } } },
    });
    if (!project) throw notFound('Project');
    if (project.ownerId === sender.id) throw new HttpError(400, 'VALIDATION_ERROR', 'You cannot contact yourself.');
    const reachable = project.owner.status === 'ACTIVE' && (PERMISSIONS.contact.roles as readonly string[]).includes(project.owner.role);
    if (!reachable) throw new HttpError(409, 'NOT_CONTACTABLE', "This project's team can't be contacted right now.");
    return { recipientId: project.ownerId, projectId: project.id, offerId: null, about: ` about "${project.title}"` };
  }
  if (input.userId === sender.id) throw new HttpError(400, 'VALIDATION_ERROR', 'You cannot contact yourself.');
  // An account that cannot be contacted looks the same as one that does not exist.
  const recipient = await prisma.user.findFirst({ where: { ...CONTACTABLE, id: input.userId }, select: { id: true } });
  if (!recipient) throw notFound('User');
  return { recipientId: recipient.id, projectId: null, offerId: null, about: '' };
}

/** The introduction is stored encrypted. A unique pendingKey blocks a second pending request. */
export async function createRequest(sender: AuthUser, input: z.infer<typeof createRequestSchema>) {
  const { recipientId, projectId, offerId, about } = await resolveRecipient(sender, input);
  const pendingKey = `${sender.id}:${recipientId}:${projectId ?? ''}${offerId ? `:${offerId}` : ''}`;
  try {
    return await prisma.$transaction(async (tx) => {
      const request = await tx.contactRequest.create({
        data: { senderId: sender.id, recipientId, projectId, offerId, introduction: encrypt(input.introduction, INTRO_CONTEXT), pendingKey },
      });
      await notify(
        { recipientId, eventType: 'CONTACT_REQUEST', message: `${sender.name} wants to get in touch${about}.`, targetType: 'ContactRequest', targetId: request.id },
        tx,
      );
      return { id: request.id, status: request.status };
    }, TX_OPTIONS);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new HttpError(409, 'ALREADY_REQUESTED', 'You already have a pending request to them.');
    }
    throw err;
  }
}

function readIntroduction(stored: string): string | null {
  try {
    return decrypt(stored, INTRO_CONTEXT);
  } catch {
    return null;
  }
}

/** Your own requests only, incoming or outgoing. The other side is shown by name, never by email. */
export async function listRequests(user: AuthUser, { box, page }: z.infer<typeof listRequestsQuery>) {
  const incoming = box === 'incoming';
  const rows = await prisma.contactRequest.findMany({
    where: incoming ? { recipientId: user.id } : { senderId: user.id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: {
      sender: { select: { id: true, name: true } },
      recipient: { select: { id: true, name: true } },
      project: { select: { id: true, title: true, status: true } },
      conversation: { select: { id: true } },
    },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE + 1,
  });
  return {
    box,
    page,
    items: rows.slice(0, PAGE_SIZE).map((r) => {
      const other = incoming ? r.sender : r.recipient;
      return {
        id: r.id,
        status: r.status,
        introduction: readIntroduction(r.introduction),
        from: incoming ? { id: other.id, name: other.name } : null,
        to: incoming ? null : { id: other.id, name: other.name },
        // A project that has since been hidden or removed is not named.
        project: r.project?.status === 'PUBLISHED' ? { id: r.project.id, title: r.project.title } : null,
        conversationId: r.conversation?.id ?? null,
        createdAt: r.createdAt.toISOString(),
        respondedAt: r.respondedAt?.toISOString() ?? null,
      };
    }),
    hasMore: rows.length > PAGE_SIZE,
  };
}

const leavePending = (status: string) => ({ status, pendingKey: null, respondedAt: new Date() });

/**
 * Only the recipient accepts. The conditional update lets exactly one accept through, and the
 * conversation, its two participants and the sender's notice commit with it or not at all.
 */
export async function acceptRequest(user: AuthUser, id: string) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.contactRequest.findFirst({
      where: { id, recipientId: user.id },
      select: { senderId: true, status: true, sender: { select: { status: true } } },
    });
    if (!request) throw notFound('Request');
    if (request.status !== 'PENDING') throw notPending();
    if (request.sender.status !== 'ACTIVE') throw new HttpError(409, 'NOT_CONTACTABLE', "The sender can't be contacted right now.");

    const { count } = await tx.contactRequest.updateMany({ where: { id, recipientId: user.id, status: 'PENDING' }, data: leavePending('ACCEPTED') });
    if (count === 0) throw notPending();
    const conversation = await tx.conversation.create({
      data: { contactRequestId: id, participants: { create: [{ userId: request.senderId }, { userId: user.id }] } },
    });
    await notify(
      { recipientId: request.senderId, eventType: 'CONTACT_ACCEPTED', message: `${user.name} accepted your contact request.`, targetType: 'Conversation', targetId: conversation.id },
      tx,
    );
    return { status: 'ACCEPTED', conversationId: conversation.id };
  }, TX_OPTIONS);
}

/** Decline (recipient) or withdraw (sender). Neither creates a conversation. */
async function closeRequest(user: AuthUser, id: string, side: 'recipientId' | 'senderId', status: 'DECLINED' | 'WITHDRAWN') {
  return prisma.$transaction(async (tx) => {
    const request = await tx.contactRequest.findFirst({ where: { id, [side]: user.id }, select: { senderId: true, status: true } });
    if (!request) throw notFound('Request');
    const { count } = await tx.contactRequest.updateMany({ where: { id, [side]: user.id, status: 'PENDING' }, data: leavePending(status) });
    if (count === 0) throw notPending();
    if (status === 'DECLINED') {
      await notify(
        { recipientId: request.senderId, eventType: 'CONTACT_DECLINED', message: `${user.name} declined your contact request.`, targetType: 'ContactRequest', targetId: id },
        tx,
      );
    }
    return { status };
  }, TX_OPTIONS);
}

export const declineRequest = (user: AuthUser, id: string) => closeRequest(user, id, 'recipientId', 'DECLINED');
export const withdrawRequest = (user: AuthUser, id: string) => closeRequest(user, id, 'senderId', 'WITHDRAWN');
