import type { PaidOffer, Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config.js';
import { HttpError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { param } from '../../lib/params.js';
import { requireAuth } from '../../middleware/auth.js';
import { toOfferView, VISIBLE_OFFER } from '../offers/service.js';
import { signScreenshots } from '../projects/media.js';
import { shareInfo, socialShareLinks } from '../sharing/service.js';
import { admitGuestToProject, getGuestSession, guestCardLimit, guestFeedPage, guestLimitReached } from './guestLimit.js';
import { COMMENTS_SHOWN, toCommentView, type CommentSource } from '../engagement/service.js';
import { cardInclude, ELIGIBLE, ENGAGEMENT_COUNTS, FIELDS_BY_TIER, NEWEST_FIRST, showsDemo, toCard, toDetail, viewerTier } from './visibility.js';

/** FR05–FR07: the public, role-aware side of projects. */
export const discoveryRouter = Router();

const pageParam = z.coerce.number().int().min(1).max(1000).default(1);
/** default = newest published; recent = most recently updated; interaction = likes + comments. */
const feedQuery = z.object({ page: pageParam, sort: z.enum(['default', 'recent', 'interaction']).default('default') });

discoveryRouter.get('/feed', async (req, res) => {
  const parsed = feedQuery.safeParse(req.query);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid page number or sort option.');
  const { page, sort } = parsed.data;
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

  // Guests keep the fixed order above because their card budget depends on it.
  if (sort === 'interaction') {
    const ranked = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT p."id"
      FROM "Project" p
      WHERE p."status" = 'PUBLISHED'
      ORDER BY (
        (SELECT COUNT(*) FROM "ProjectLike" l WHERE l."projectId" = p."id") +
        (SELECT COUNT(*) FROM "Comment" c WHERE c."projectId" = p."id")
      ) DESC, p."publishedAt" DESC NULLS LAST, p."id" DESC
      OFFSET ${offset} LIMIT ${pageSize + 1}`;
    const ids = ranked.slice(0, pageSize).map((r) => r.id);
    const found = await prisma.project.findMany({ where: { ...ELIGIBLE, id: { in: ids } }, include: cardInclude(tier) });
    const byId = new Map(found.map((p) => [p.id, p]));
    const items = ids.flatMap((id) => (byId.has(id) ? [toCard(byId.get(id)!, tier)] : []));
    res.json({ tier, page, pageSize, items, hasMore: ranked.length > pageSize });
    return;
  }

  const rows = await prisma.project.findMany({
    where: ELIGIBLE,
    orderBy: sort === 'recent' ? [{ updatedAt: 'desc' }, { id: 'desc' }] : NEWEST_FIRST,
    include: cardInclude(tier),
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

/**
 * FR06: case-insensitive name match combined with ALL selected tags, keeping the viewer's limits.
 * Guests may search too: they see Guest cards and what they find draws on their 20-project budget.
 */
discoveryRouter.get('/search', async (req, res) => {
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
  // Remember what signed-in people look for; failing to log must never fail the search.
  if (req.user && q && page === 1) {
    void prisma.searchLog.create({ data: { userId: req.user.id, term: q.toLowerCase() } }).catch(() => undefined);
  }

  if (tier === 'GUEST') {
    const offset = (page - 1) * pageSize;
    const limit = guestCardLimit();
    if (offset >= limit) throw guestLimitReached();
    const filter: Prisma.ProjectWhereInput = { ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}), ...(tags.length ? { tags: { hasEvery: tags } } : {}) };
    const guest = await getGuestSession(req, res);
    const [found, total] = await Promise.all([guestFeedPage(guest.id, offset, pageSize, filter), prisma.project.count({ where })]);
    res.json({
      tier,
      page,
      pageSize,
      total,
      query: { q, tags },
      items: found.rows.map((p) => toCard(p, tier)),
      hasMore: found.hasMore,
      guest: { limit, cardsServed: found.cardsServed, capReached: found.capReached },
    });
    return;
  }

  const [rows, total] = await Promise.all([
    prisma.project.findMany({
      where,
      orderBy: NEWEST_FIRST,
      include: cardInclude(tier),
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

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const suggestQuery = z.object({ q: z.string().trim().max(100).default('') });

/**
 * Live suggestions for the search box, from the last 7 days only: search terms ranked by how often
 * they were searched, and project names ranked by new likes + comments. With no text it shows what is trending.
 */
discoveryRouter.get('/suggest', requireAuth, async (req, res) => {
  const parsed = suggestQuery.safeParse(req.query);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid search text.');
  const q = parsed.data.q.toLowerCase();
  const since = new Date(Date.now() - WEEK_MS);
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;

  const [terms, projects] = await Promise.all([
    prisma.$queryRaw<Array<{ term: string; n: bigint }>>`
      SELECT "term", COUNT(*) AS n FROM "SearchLog"
      WHERE "createdAt" >= ${since} AND "term" LIKE ${like}
      GROUP BY "term" ORDER BY n DESC, "term" ASC LIMIT 5`,
    prisma.$queryRaw<Array<{ id: string; title: string; n: bigint }>>`
      SELECT p."id", p."title",
        ((SELECT COUNT(*) FROM "ProjectLike" l WHERE l."projectId" = p."id" AND l."createdAt" >= ${since}) +
         (SELECT COUNT(*) FROM "Comment" c WHERE c."projectId" = p."id" AND c."createdAt" >= ${since})) AS n
      FROM "Project" p
      WHERE p."status" = 'PUBLISHED' AND LOWER(p."title") LIKE ${like}
      ORDER BY n DESC, p."publishedAt" DESC NULLS LAST LIMIT 5`,
  ]);

  const items = [
    ...terms.map((t) => ({ kind: 'search' as const, text: t.term, score: Number(t.n) })),
    ...projects.map((p) => ({ kind: 'project' as const, text: p.title, id: p.id, score: Number(p.n) })),
  ]
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  res.json({ items });
});

/** Tag chips for the search filters (tags are part of the Guest card, so guests get them too): tags in use on published projects, most common first. */
discoveryRouter.get('/tags', async (_req, res) => {
  const rows = await prisma.project.findMany({ where: ELIGIBLE, select: { tags: true } });
  const counts = new Map<string, number>();
  for (const { tags } of rows) for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  const items = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 40)
    .map(([tag, count]) => ({ tag, count }));
  res.json({ items });
});

/** FR12: what a share link shows. The same for everyone, and free of the guest card budget. */
discoveryRouter.get('/:id/share', async (req, res) => {
  res.json(await shareInfo(param(req, 'id')));
});

/** FR12: social media share links, for Professionals and the project's own team only. */
discoveryRouter.get('/:id/share-links', requireAuth, async (req, res) => {
  res.json(await socialShareLinks(req.user!, param(req, 'id')));
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
      // Likes and comments come with the project, not as extra round trips to the database.
      ...(FIELDS_BY_TIER[tier].engagement
        ? {
            ...ENGAGEMENT_COUNTS,
            likes: { where: { userId: req.user!.id }, select: { userId: true } },
            comments: { orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }], take: COMMENTS_SHOWN, include: { author: { select: { id: true, name: true } } } },
          }
        : {}),
      ...(FIELDS_BY_TIER[tier].offers ? { offers: { where: VISIBLE_OFFER, orderBy: { createdAt: 'desc' as const } } } : {}),
    },
  });
  if (!project) throw new HttpError(404, 'NOT_FOUND', 'Project not found.');

  const screenshots = showsDemo(project, tier) ? await signScreenshots(project.media) : [];
  // The include above only adds these for the engagement tier, which TypeScript cannot follow.
  const loaded = project as unknown as { likes?: Array<{ userId: string }>; comments?: CommentSource[]; offers?: PaidOffer[] };
  const engagement =
    loaded.comments && loaded.likes
      ? { likedByMe: loaded.likes.length > 0, comments: loaded.comments.map((c) => toCommentView(c, req.user!.id)) }
      : undefined;
  res.json({ tier, project: toDetail(project, tier, screenshots, engagement, loaded.offers?.map(toOfferView)) });
});
