/**
 * Step 13: the final security check. Walks every route on every router, so a new route is covered
 * the moment it is mounted. The table of routes is in docs/route-security.md.
 */
import type { Router } from 'express';
import { beforeAll, describe, expect, it } from 'vitest';
import { accountsRouter } from '../src/modules/accounts/routes.js';
import { adminRouter } from '../src/modules/admin/routes.js';
import { discoveryRouter } from '../src/modules/discovery/routes.js';
import { engagementRouter } from '../src/modules/engagement/routes.js';
import { messagingRouter } from '../src/modules/messaging/routes.js';
import { notificationsRouter } from '../src/modules/notifications/routes.js';
import { offersRouter } from '../src/modules/offers/routes.js';
import { projectsRouter } from '../src/modules/projects/routes.js';
import { reportsRouter } from '../src/modules/reports/routes.js';
import { rolesRouter } from '../src/modules/roles/routes.js';
import { shareRouter } from '../src/modules/sharing/routes.js';
import { encrypt } from '../src/lib/crypto.js';
import { app, COMPLETE_PROJECT, createProject, createUser, PASSWORD, prisma, request, resetDb, signedInAgent } from './helpers.js';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
}
const MOUNTS: [string, Router][] = [
  ['/api/auth', accountsRouter],
  ['/api/projects', projectsRouter],
  ['/api/projects', discoveryRouter],
  ['/api/projects', engagementRouter],
  ['/api/messaging', messagingRouter],
  ['/api/offers', offersRouter],
  ['/api/notifications', notificationsRouter],
  ['/api/reports', reportsRouter],
  ['/api/role-requests', rolesRouter],
  ['/api/admin', adminRouter],
  ['/p', shareRouter],
];
const ROUTES = MOUNTS.flatMap(([prefix, router]) =>
  (router as unknown as { stack: Layer[] }).stack.flatMap((layer) =>
    layer.route ? Object.keys(layer.route.methods).map((method) => ({ method: method as Method, path: `${prefix}${layer.route!.path === '/' ? '' : layer.route!.path}` })) : [],
  ),
);

/** Everything a visitor who is not signed in may call. Any other route must answer 401. */
const PUBLIC = new Set([
  'get /api/auth/config',
  'post /api/auth/register',
  'post /api/auth/login',
  'post /api/auth/google',
  'post /api/auth/logout',
  'post /api/auth/forgot-password',
  'post /api/auth/reset-password',
  'get /api/projects/feed',
  'get /api/projects/search',
  'get /api/projects/tags',
  'get /api/projects/:id',
  'get /api/projects/:id/share',
  'get /p/:id',
]);
const key = (r: { method: string; path: string }) => `${r.method} ${r.path}`;
const PROTECTED = ROUTES.filter((r) => !PUBLIC.has(key(r)));

describe('Guests and protected routes', () => {
  it('the public list names only routes that exist', () => {
    const all = new Set(ROUTES.map(key));
    expect([...PUBLIC].filter((k) => !all.has(k))).toEqual([]);
    expect(PROTECTED.length).toBeGreaterThan(60);
  });

  it.each(PROTECTED)('$method $path: a Guest gets 401', async ({ method, path }) => {
    const res = await request(app)[method](path.replace(/:\w+/g, 'some-id')).send({});
    expect({ status: res.status, code: res.body.error?.code }).toEqual({ status: 401, code: 'UNAUTHENTICATED' });
  });
});

describe('Signed-in users and other people’s records', () => {
  let mallory: Awaited<ReturnType<typeof signedInAgent>>;
  let ids: Record<string, string>;
  let before: string;

  const snapshot = async () =>
    JSON.stringify([
      await prisma.project.findMany({ orderBy: { id: 'asc' } }),
      await prisma.comment.findMany(),
      await prisma.notification.findMany({ orderBy: { id: 'asc' } }),
      await prisma.contactRequest.findMany(),
      await prisma.paidOffer.findMany(),
      await prisma.message.count(),
    ]);

  beforeAll(async () => {
    await resetDb();
    const alice = await createUser({ role: 'PROFESSIONAL' });
    const bob = await createUser({ role: 'PROFESSIONAL' });
    const project = await createProject(alice.id);
    const draft = await createProject(alice.id, { status: 'DRAFT', publishedAt: null });
    const comment = await prisma.comment.create({ data: { projectId: project.id, authorId: alice.id, body: 'My own comment.' } });
    const notification = await prisma.notification.create({ data: { recipientId: alice.id, eventType: 'TEST', message: 'For Alice only.' } });
    const contact = await prisma.contactRequest.create({ data: { senderId: bob.id, recipientId: alice.id, introduction: encrypt('Hello Alice, shall we talk?', 'ContactRequest.introduction'), pendingKey: 'k1' } });
    const conversation = await prisma.conversation.create({ data: { participants: { create: [{ userId: alice.id }, { userId: bob.id }] } } });
    const offer = await prisma.paidOffer.create({ data: { projectId: project.id, authorId: alice.id, title: 'Tester', skills: ['qa'], type: 'HOURLY', compensation: '500', currency: 'BDT', applicationRoute: 'Write to me through the platform.', reviewStatus: 'APPROVED' } });
    ids = { project: project.id, draft: draft.id, comment: comment.id, notification: notification.id, contact: contact.id, conversation: conversation.id, offer: offer.id };
    // The same role as the owner, so only the record-level check can stop her.
    mallory = await signedInAgent((await createUser({ role: 'PROFESSIONAL' })).email);
    before = await snapshot();
  });

  it.each([
    ['get', (i: Record<string, string>) => `/api/projects/${i.draft}`, undefined],
    ['get', (i) => `/api/projects/${i.draft}/workspace`, undefined],
    ['get', (i) => `/api/projects/${i.project}/workspace`, undefined],
    ['patch', (i) => `/api/projects/${i.project}`, { title: 'Taken over' }],
    ['post', (i) => `/api/projects/${i.project}/hide`, undefined],
    ['delete', (i) => `/api/projects/${i.project}`, { confirmTitle: 'x' }],
    ['post', (i) => `/api/projects/${i.project}/members`, { email: 'friend@example.com' }],
    ['post', (i) => `/api/notifications/${i.notification}/read`, undefined],
    ['post', (i) => `/api/messaging/requests/${i.contact}/accept`, undefined],
    ['post', (i) => `/api/messaging/requests/${i.contact}/withdraw`, undefined],
    ['get', (i) => `/api/messaging/conversations/${i.conversation}/messages`, undefined],
    ['post', (i) => `/api/messaging/conversations/${i.conversation}/messages`, { body: 'Hello from outside.' }],
    ['post', (i) => `/api/offers/${i.offer}/close`, undefined],
    ['post', () => '/api/offers', { projectId: '__project__', title: 'My offer on your project', skills: ['x'], type: 'FIXED', compensation: '1', currency: 'BDT', applicationRoute: 'Contact me directly please.' }],
  ] as [Method, (i: Record<string, string>) => string, object | undefined][])('%s on someone else’s record is 404 and changes nothing', async (method, url, body) => {
    const payload = body && JSON.parse(JSON.stringify(body).replace('__project__', ids.project));
    const res = await mallory[method](url(ids)).send(payload);
    expect({ url: url(ids), status: res.status }).toEqual({ url: url(ids), status: 404 });
    expect(await snapshot()).toBe(before);
  });

  it('editing or deleting someone else’s comment is refused', async () => {
    const url = `/api/projects/${ids.project}/comments/${ids.comment}`;
    expect((await mallory.patch(url).send({ body: 'Rewritten.' })).status).toBe(403);
    expect((await mallory.delete(url)).status).toBe(403);
    expect(await snapshot()).toBe(before);
  });
});

describe('Role and status fields sent in a request body are ignored', () => {
  it('registration always creates an active Uploader', async () => {
    await resetDb();
    const res = await request(app).post('/api/auth/register').send({ name: 'Eve Example', email: 'eve@example.com', password: PASSWORD, role: 'ADMIN', status: 'ACTIVE', isAdmin: true });
    expect(res.status).toBe(201);
    expect(await prisma.user.findUniqueOrThrow({ where: { email: 'eve@example.com' } })).toMatchObject({ role: 'UPLOADER', status: 'ACTIVE' });
  });

  it('a project cannot be published, re-owned or un-removed through its edit route', async () => {
    const owner = await createUser();
    const other = await createUser();
    const agent = await signedInAgent(owner.email);
    const created = await agent.post('/api/projects').send({ ...COMPLETE_PROJECT, status: 'PUBLISHED', ownerId: other.id, publishedAt: new Date().toISOString(), isSynthetic: true });
    expect(created.status).toBe(201);
    const id = created.body.project?.id ?? created.body.id;
    await agent.patch(`/api/projects/${id}`).send({ title: 'A changed title', status: 'PUBLISHED', ownerId: other.id });
    expect(await prisma.project.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'DRAFT', ownerId: owner.id, publishedAt: null, isSynthetic: false });
  });
});
