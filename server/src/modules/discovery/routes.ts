import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config.js';
import { HttpError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { param } from '../../lib/params.js';
import { requireAuth } from '../../middleware/auth.js';
import { signScreenshots } from '../projects/media.js';
import { admitGuestToProject, getGuestSession, guestCardLimit, guestFeedPage, guestLimitReached } from './guestLimit.js';
import { ELIGIBLE, NEWEST_FIRST, showsDemo, toCard, toDetail, viewerTier } from './visibility.js';

/** FR05–FR07: the public, role-aware side of projects. */
export const discoveryRouter = Router();

const pageParam = z.coerce.number().int().min(1).max(1000).default(1);
const feedQuery = z.object({ page: pageParam });

discoveryRouter.get('/feed', async (req, res) => {
  const parsed = feedQuery.safeParse(req.query);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid page number.');
  const { page } = parsed.data;
  const pageSize = config.feedPageSize;
  const offset = (page - 1) * pageSize;
  const tier = viewerTier(req.user);

  if (tier === 'GUEST') {
    // No page starts at or beyond the limit, whatever the session has seen so far.
    const limit = guestCardLimit();
    if (offset >= limit) throw guestLimitReached();
    const guest = await getGuestSession(req, res);
    const { rows, hasMore, cardsServed, capReached } = await guestFeedPage(guest.id, offset, pageSize);
    res.json({ tier, page, pageSize, items: rows.map((p) => toCard(p, tier)), hasMore, guest: { limit, cardsServed, capReached } });
    return;
  }

  const rows = await prisma.project.findMany({
    where: ELIGIBLE,
    orderBy: NEWEST_FIRST,
    include: { owner: { select: { name: true } } },
    skip: offset,
    take: pageSize + 1,
  });
  res.json({ tier, page, pageSize, items: rows.slice(0, pageSize).map((p) => toCard(p, tier)), hasMore: rows.length > pageSize });
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
  const where: Prisma.ProjectWhereInput = { ...ELIGIBLE, id: param(req, 'id') };

  // A guest's view is the card, so nothing else about the project is loaded, let alone signed.
  // The budget is charged only after the 404 check, so a project they may not know of costs nothing.
  if (tier === 'GUEST') {
    const project = await prisma.project.findFirst({ where, include: { owner: { select: { name: true } } } });
    if (!project) throw new HttpError(404, 'NOT_FOUND', 'Project not found.');
    await admitGuestToProject(await getGuestSession(req, res), project.id);
    res.json({ tier, project: toCard(project, tier) });
    return;
  }

  const project = await prisma.project.findFirst({
    where,
    include: {
      owner: { select: { name: true } },
      members: { where: { status: 'ACCEPTED' }, include: { user: { select: { name: true } } } },
      milestones: true,
      progress: { orderBy: { createdAt: 'desc' }, take: 20 },
      media: true,
    },
  });
  if (!project) throw new HttpError(404, 'NOT_FOUND', 'Project not found.');

  const screenshots = showsDemo(project, tier) ? await signScreenshots(project.media) : [];
  res.json({ tier, project: toDetail(project, tier, screenshots) });
});
