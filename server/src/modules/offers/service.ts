import type { PaidOffer } from '@prisma/client';
import { z } from 'zod';
import { OFFER_TYPES, type AuthUser } from '../../domain.js';
import { audit } from '../../lib/audit.js';
import { HttpError } from '../../lib/errors.js';
import { prisma, TX_OPTIONS } from '../../lib/prisma.js';
import { notify } from '../notifications/service.js';
import { loadProjectFor } from '../projects/access.js';

/** Sent with every offer, so no one takes the platform for a payment service (FR11). */
export const PAYMENT_NOTICE = 'ProjectBridge does not process payments. Any payment is arranged directly between the people involved.';

const text = (min: number, max: number, what: string) => z.string({ required_error: `${what} is required.` }).trim().min(min, `${what} is required.`).max(max);

/** Every term is required: an offer without them cannot be judged by an Admin or a candidate. */
export const createOfferSchema = z.object({
  projectId: text(1, 100, 'The project'),
  title: text(3, 120, 'A title'),
  skills: z.array(z.string().trim().toLowerCase().min(1).max(30)).min(1, 'List at least one skill.').max(10),
  type: z.enum(OFFER_TYPES, { message: 'Choose an offer type.' }),
  compensation: text(1, 100, 'The compensation'),
  currency: z.string({ required_error: 'The currency is required.' }).trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code, for example BDT.'),
  applicationRoute: text(10, 500, 'How to apply'),
});

/** Only approved, open offers on published projects are public, and only to the Professional and Admin tiers. */
export const VISIBLE_OFFER = { reviewStatus: 'APPROVED', status: 'OPEN' } as const;

export const toOfferView = (o: PaidOffer) => ({
  id: o.id,
  title: o.title,
  skills: o.skills,
  type: o.type,
  compensation: o.compensation,
  currency: o.currency,
  applicationRoute: o.applicationRoute,
  status: o.status,
  createdAt: o.createdAt.toISOString(),
  paymentNotice: PAYMENT_NOTICE,
});

const notFound = () => new HttpError(404, 'NOT_FOUND', 'Offer not found.');

/** The author must own or edit the project. The offer waits for Admin review before anyone else sees it. */
export async function createOffer(user: AuthUser, input: z.infer<typeof createOfferSchema>) {
  const { projectId, ...terms } = input;
  const { project } = await loadProjectFor(user, projectId, 'edit');
  if (project.status !== 'PUBLISHED') throw new HttpError(409, 'NOT_PUBLISHED', 'Offers can only be posted on a published project.');
  return prisma.$transaction(async (tx) => {
    const offer = await tx.paidOffer.create({ data: { ...terms, projectId, authorId: user.id } });
    await audit({ action: 'OFFER_SUBMITTED', actorId: user.id, targetType: 'PaidOffer', targetId: offer.id }, tx);
    return { offer: { ...toOfferView(offer), reviewStatus: offer.reviewStatus, reviewNote: offer.reviewNote } };
  }, TX_OPTIONS);
}

/** The author's own offers, whatever their review state. */
export async function listMyOffers(user: AuthUser) {
  const rows = await prisma.paidOffer.findMany({
    where: { authorId: user.id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { project: { select: { id: true, title: true } } },
  });
  return { items: rows.map((o) => ({ ...toOfferView(o), reviewStatus: o.reviewStatus, reviewNote: o.reviewNote, project: o.project })) };
}

/** Only the author closes an offer. A closed offer accepts no new contact requests. */
export async function closeOffer(user: AuthUser, id: string) {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.paidOffer.updateMany({ where: { id, authorId: user.id, status: 'OPEN' }, data: { status: 'CLOSED' } });
    if (count === 0) throw notFound();
    await audit({ action: 'OFFER_CLOSED', actorId: user.id, targetType: 'PaidOffer', targetId: id, oldValue: 'OPEN', newValue: 'CLOSED' }, tx);
  }, TX_OPTIONS);
}

// ---------------------------------------------------------------- Admin review

export async function listPendingOffers() {
  const rows = await prisma.paidOffer.findMany({
    where: { reviewStatus: 'PENDING' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { project: { select: { id: true, title: true } }, author: { select: { name: true } } },
  });
  return { items: rows.map((o) => ({ ...toOfferView(o), project: o.project, author: { name: o.author.name } })) };
}

/** The status change, audit row and author notice commit together, or not at all. */
export async function reviewOffer(admin: AuthUser, id: string, decision: 'APPROVED' | 'REJECTED', note?: string) {
  await prisma.$transaction(async (tx) => {
    const offer = await tx.paidOffer.findUnique({ where: { id }, select: { authorId: true, title: true, projectId: true } });
    const { count } = await tx.paidOffer.updateMany({ where: { id, reviewStatus: 'PENDING' }, data: { reviewStatus: decision, reviewNote: note ?? null } });
    if (!offer || count === 0) throw new HttpError(404, 'NOT_FOUND', 'No offer waiting for review.');
    await audit({ action: `OFFER_${decision}`, actorId: admin.id, targetType: 'PaidOffer', targetId: id, reason: note, oldValue: 'PENDING', newValue: decision }, tx);
    await notify(
      {
        recipientId: offer.authorId,
        eventType: `OFFER_${decision}`,
        message: decision === 'APPROVED' ? `Your offer "${offer.title}" was approved and is now visible.` : `Your offer "${offer.title}" was not approved: ${note}`,
        targetType: 'Project',
        targetId: offer.projectId,
      },
      tx,
    );
  }, TX_OPTIONS);
}
