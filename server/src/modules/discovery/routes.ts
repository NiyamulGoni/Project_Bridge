import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config.js';
import { HttpError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { param } from '../../lib/params.js';
import { requireAuth } from '../../middleware/auth.js';
import { signScreenshots } from '../projects/media.js';
import { admitGuestToProject, getGuestSession, guestCardLimit, recordGuestExposure } from './guestLimit.js';
import { showsDemo, toCard, toDetail, viewerTier } from './visibility.js';

/** FR05–FR07: the public, role-aware side of projects. */
export const discoveryRouter = Router();

/** Only published projects are eligible for feeds, search and direct views. */
const ELIGIBLE: Prisma.ProjectWhereInput = { status: 'PUBLISHED' };
const NEWEST_FIRST: Prisma.ProjectOrderByWithRelationInput[] = [{ publishedAt: 'desc' }, { id: 'desc' }];

const pageParam = z.coerce.number().int().min(1).max(1000).default(1);
const feedQuery = z.object({ page: pageParam });

discoveryRouter.get('/feed', async (req, res) => {
  const parsed = feedQuery.safeParse(req.query);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid page number.');
  const { page } = parsed.data;
  const pageSize = config.feedPageSize;
  const offset = (page - 1) * pageSize;
  const tier = viewerTier(req.user);

  // Guests can see only the first `limit` feed positions per anonymous session.
  let take = pageSize;
  let guest: Awaited<ReturnType<typeof getGuestSession>> | undefined;
  if (tier === 'GUEST') {
    guest = await getGuestSession(req, res);
    const limit = guestCardLimit();
    if (offset >= limit) {
      throw new HttpError(403, 'GUEST_LIMIT', `Guests can browse ${limit} projects. Sign in or register to keep exploring.`);
    }
    take = Math.min(pageSize, limit - offset);
  }

  const rows = await prisma.project.findMany({
    where: ELIGIBLE,
    orderBy: NEWEST_FIRST,
    include: { owner: { select: { name: true } } },
    skip: offset,
    take: take + 1,
  });
  const items = rows.slice(0, take).map((p) => toCard(p, tier));
  let hasMore = rows.length > take;
  let guestInfo: { limit: number; cardsServed: number; capReached: boolean } | undefined;

  if (guest) {
    const limit = guestCardLimit();
    const cardsServed = await recordGuestExposure(guest.id, offset + items.length, items.map((c) => c.id));
    // More projects exist, but this guest has used up the allowed positions.
    const capReached = offset + items.length >= limit && hasMore;
    if (capReached) hasMore = false;
    guestInfo = { limit, cardsServed, capReached };
  }

  res.json({ tier, page, pageSize, items, hasMore, guest: guestInfo });
});

const searchQuery = z.object({
  q: z.string().trim().max(100, 'Search text is too long.').default(''),
  tags: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((raw) => {
      const list = (Array.isArray(raw) ? raw : (raw ?? '').split(','))
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      return [...new Set(list)];
    })
    .pipe(z.array(z.string().max(30)).max(8, 'Select at most 8 tags.')),
  page: pageParam,
});

/** FR06: case-insensitive name match combined with ALL selected tags, keeping the viewer's limits. */
discoveryRouter.get('/search', requireAuth, async (req, res) => {
  const parsed = searchQuery.safeParse(req.query);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid search.');
  const { q, tags, page } = parsed.data;
  const pageSize = config.feedPageSize;
  const tier = viewerTier(req.user);

  const where: Prisma.ProjectWhereInput = {
    ...ELIGIBLE,
    ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}),
    ...(tags.length ? { tags: { hasEvery: tags } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.project.findMany({
      where,
      orderBy: NEWEST_FIRST,
      include: { owner: { select: { name: true } } },
      skip: (page - 1) * pageSize,
      take: pageSize + 1,
    }),
    prisma.project.count({ where }),
  ]);

  res.json({
    tier,
    page,
    pageSize,
    total,
    query: { q, tags },
    items: rows.slice(0, pageSize).map((p) => toCard(p, tier)),
    hasMore: rows.length > pageSize,
  });
});

/** Tag chips for the search bar: tags in use on published projects, most common first. */
discoveryRouter.get('/tags', requireAuth, async (_req, res) => {
  const rows = await prisma.project.findMany({ where: ELIGIBLE, select: { tags: true } });
  const counts = new Map<string, number>();
  for (const { tags } of rows) for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  const items = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 40)
    .map(([tag, count]) => ({ tag, count }));
  res.json({ items });
});

/**
 * FR07: the role-specific project view. Direct requests get exactly the same rules as
 * clicking a card: unpublished, hidden or deleted projects are 404 and fields follow the tier.
 */
discoveryRouter.get('/:id', async (req, res) => {
  const tier = viewerTier(req.user);
  const project = await prisma.project.findFirst({
    where: { ...ELIGIBLE, id: param(req, 'id') },
    include: {
      owner: { select: { name: true } },
      members: { where: { status: 'ACCEPTED' }, include: { user: { select: { name: true } } } },
      milestones: true,
      progress: { orderBy: { createdAt: 'desc' }, take: 20 },
      media: true,
    },
  });
  if (!project) throw new HttpError(404, 'NOT_FOUND', 'Project not found.');

  if (tier === 'GUEST') await admitGuestToProject(await getGuestSession(req, res), project.id);

  const screenshots = showsDemo(project, tier) ? await signScreenshots(project.media) : [];
  res.json({ tier, project: toDetail(project, tier, screenshots) });
});
