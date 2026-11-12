/**
 * Step 2 / Section 4.2: every response in accounts, projects, discovery and admin is held to the
 * FIELDS_BY_TIER table, and a guest has one budget of distinct projects. The database is remote, so
 * one reset and one rich fixture serve the whole file. Each guest budget test uses its own session.
 */
import { randomUUID } from 'node:crypto';
import type { Project, User } from '@prisma/client';
import { Router } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import { hashToken, randomToken } from '../src/lib/tokens.js';
import { SESSION_COOKIE } from '../src/middleware/session.js';
import { accountsRouter } from '../src/modules/accounts/routes.js';
import { adminRouter } from '../src/modules/admin/routes.js';
import { engagementRouter } from '../src/modules/engagement/routes.js';
import { messagingRouter } from '../src/modules/messaging/routes.js';
import { notificationsRouter } from '../src/modules/notifications/routes.js';
import { offersRouter } from '../src/modules/offers/routes.js';
import { rolesRouter } from '../src/modules/roles/routes.js';
import { shareRouter } from '../src/modules/sharing/routes.js';
import { reportsRouter } from '../src/modules/reports/routes.js';
import { encrypt } from '../src/lib/crypto.js';
import { GUEST_COOKIE } from '../src/modules/discovery/guestLimit.js';
import { discoveryRouter } from '../src/modules/discovery/routes.js';
import { projectsRouter } from '../src/modules/projects/routes.js';
import {
  app,
  COMPLETE_PROJECT,
  coverStorage,
  createProject,
  createUser,
  googleAccounts,
  PASSWORD,
  PNG_BYTES,
  prisma,
  request,
  resetDb,
  storage,
  tokenFromLastResetMail,
} from './helpers.js';
import { expectCleanResponse, scanResponse } from './responseScan.js';

type Agent = ReturnType<typeof request.agent>;
type Res = Awaited<ReturnType<Agent['get']>>;

const VIEWERS = ['guest', 'uploader', 'professional', 'admin', 'owner', 'editor', 'invitee'] as const;
type Viewer = (typeof VIEWERS)[number];
type SignedIn = Exclude<Viewer, 'guest'>;

const ROLE_OF: Record<SignedIn, string> = {
  uploader: 'UPLOADER',
  professional: 'PROFESSIONAL',
  admin: 'ADMIN',
  owner: 'UPLOADER',
  editor: 'PROFESSIONAL',
  invitee: 'UPLOADER',
};

const UNPUBLISHED_STATUSES = ['DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'HIDDEN', 'REMOVED', 'DELETED'] as const;
type UnpublishedStatus = (typeof UNPUBLISHED_STATUSES)[number];

/** Long enough to prove every text limit is applied. */
const LONG_SUMMARY = 'S'.repeat(190);
const LONG_OVERVIEW = 'O'.repeat(1200);
/** In the title and tags of every unpublished project, so it can be searched for in any response. */
const UNPUBLISHED_MARKER = 'unpublished-material-marker';
const REVISION_MARKER = 'pending-revision-marker';
const INVITEE_NAME = 'Invited Not Accepted';
const DECLINER_NAME = 'Invited And Declined';
const SLOW = 180_000;

const users = {} as Record<SignedIn, User>;
const agents = {} as Record<Viewer, Agent>;
let decliner: User;
let live: Project;
let liveDemo: Project;
/** Stays a draft until the submit test, so the mutating routes have something to work on. */
let editable: Project;
const unpublished = {} as Record<UnpublishedStatus, Project>;
/** Never allowed in a response: emails, hashes, Google ids, raw tokens, storage paths. */
let secrets: string[];
/** Those, plus what must stay off every public response even for the people who may see it elsewhere. */
let publicSecrets: string[];
let fixtureReport: { id: string };
let fixtureConversation: { id: string };
let fixtureConversationReport: { id: string };

// Signed URLs here are recorded, so a URL in a response can be traced to this call. They are also opaque,
// which the real ones are not: Supabase's URL includes the object path. So these tests show the path is
// never returned as its own field, and say nothing about the path inside a real signed URL.
const issued = new Map<string, string>();
const signedUrl = vi.spyOn(storage, 'signedUrl');
const publicUrl = vi.spyOn(storage, 'publicUrl');
afterAll(() => {
  vi.restoreAllMocks();
});

function cookieValue(res: Res, name: string): string {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = header?.find((c) => c.startsWith(`${name}=`));
  if (!cookie) throw new Error(`No ${name} cookie in the response.`);
  return cookie.slice(name.length + 1).split(';')[0];
}

const fields = (value: object) => Object.keys(value).sort();
const sorted = (list: readonly string[]) => [...list].sort();
const paths = async (projectId: string) =>
  (await prisma.projectMedia.findMany({ where: { projectId }, select: { storagePath: true } })).map((m) => m.storagePath).sort();

/** A project with the whole team, a roadmap, screenshots and a cover. The id comes first because the paths hold it. */
async function richProject(status: string, overrides: Record<string, unknown> = {}) {
  const id = `fixture-${randomUUID()}`;
  const cover = `projects/${id}/cover-${randomUUID()}.png`;
  const screenshots = [`projects/${id}/${randomUUID()}.png`, `projects/${id}/${randomUUID()}.png`];
  await coverStorage.upload(cover, PNG_BYTES, 'image/png');
  for (const path of screenshots) await storage.upload(path, PNG_BYTES, 'image/png');
  const invitedById = users.owner.id;
  return createProject(users.owner.id, {
    id,
    status,
    summary: LONG_SUMMARY,
    overview: LONG_OVERVIEW,
    thumbnailUrl: coverStorage.publicUrl(cover),
    members: {
      create: [
        { userId: users.editor.id, status: 'ACCEPTED', invitedById },
        { userId: users.invitee.id, status: 'INVITED', invitedById },
        { userId: decliner.id, status: 'DECLINED', invitedById },
      ],
    },
    milestones: { create: [{ title: 'Pilot', status: 'IN_PROGRESS', dueDate: new Date('2027-01-01') }] },
    progress: { create: [{ authorId: users.owner.id, body: 'Week 3 update' }] },
    media: {
      create: screenshots.map((storagePath, position) => ({ storagePath, mimeType: 'image/png', sizeBytes: PNG_BYTES.length, position })),
    },
    ...overrides,
  });
}

beforeAll(async () => {
  signedUrl.mockImplementation(async (path) => {
    const url = `https://signed.test/${randomUUID()}?token=${randomUUID()}`;
    issued.set(url, path);
    return url;
  });
  await resetDb();

  const rawTokens: string[] = [];
  agents.guest = request.agent(app);
  for (const viewer of Object.keys(ROLE_OF) as SignedIn[]) {
    users[viewer] = await createUser({ role: ROLE_OF[viewer] });
    agents[viewer] = request.agent(app);
    const res = await agents[viewer].post('/api/auth/login').send({ email: users[viewer].email, password: PASSWORD });
    expect(res.status).toBe(200);
    rawTokens.push(cookieValue(res, SESSION_COOKIE));
  }
  await prisma.user.update({ where: { id: users.invitee.id }, data: { name: INVITEE_NAME } });
  await prisma.user.update({ where: { id: users.uploader.id }, data: { googleId: 'google-sub-never-returned' } });
  decliner = await prisma.user.update({ where: { id: (await createUser()).id }, data: { name: DECLINER_NAME } });

  // The future date keeps these two at the top of the feed however many projects are added below them.
  const dayAhead = Date.now() + 24 * 60 * 60 * 1000;
  live = await richProject('PUBLISHED', { title: 'Visible Pump Monitor', publishedAt: new Date(dayAhead), publicDemo: false });
  liveDemo = await richProject('PUBLISHED', { title: 'Visible Demo Monitor', publishedAt: new Date(dayAhead - 1000), publicDemo: true });
  editable = await richProject('DRAFT', { title: 'Editable Draft', publishedAt: null });
  for (const status of UNPUBLISHED_STATUSES) {
    unpublished[status] = await richProject(status, {
      title: `${status} ${UNPUBLISHED_MARKER}`,
      tags: [UNPUBLISHED_MARKER],
      publishedAt: null,
      submittedAt: status === 'SUBMITTED' ? new Date() : null,
      ownershipDeclaredAt: status === 'SUBMITTED' ? new Date() : null,
    });
  }
  const { stage: _stage, ...content } = COMPLETE_PROJECT;
  await prisma.projectRevision.create({
    data: { ...content, overview: `${content.overview} ${REVISION_MARKER}`, projectId: live.id, authorId: users.owner.id },
  });

  // One unused reset link, so the table holds a token hash and the mail a raw token.
  expect((await request(app).post('/api/auth/forgot-password').send({ email: users.professional.email })).status).toBe(200);
  rawTokens.push(tokenFromLastResetMail());

  const [allUsers, sessions, emailTokens, media] = await Promise.all([
    prisma.user.findMany(),
    prisma.session.findMany(),
    prisma.emailToken.findMany(),
    prisma.projectMedia.findMany(),
  ]);
  secrets = [
    ...allUsers.flatMap((u) => [u.email, u.passwordHash ?? '', u.googleId ?? '']),
    ...sessions.map((s) => s.tokenHash),
    ...emailTokens.map((t) => t.tokenHash),
    ...media.map((m) => m.storagePath),
    ...rawTokens,
  ].filter(Boolean);
  fixtureReport = await prisma.report.create({
    data: { reporterId: users.uploader.id, targetType: 'PROJECT', targetId: live.id, reason: encrypt('This copies another team\'s work.', 'Report.reason') },
  });
  fixtureConversation = await prisma.conversation.create({
    data: {
      participants: { create: [{ userId: users.uploader.id }, { userId: users.professional.id }] },
      messages: { create: [{ senderId: users.uploader.id, body: encrypt('Hello there.', 'Message.body') }] },
    },
  });
  fixtureConversationReport = await prisma.report.create({
    data: { reporterId: users.uploader.id, targetType: 'CONVERSATION', targetId: fixtureConversation.id, reason: encrypt('Abusive messages in this chat.', 'Report.reason') },
  });
  await prisma.paidOffer.create({
    data: { projectId: live.id, authorId: users.editor.id, title: 'Firmware developer', skills: ['c'], type: 'FIXED', compensation: '20000', currency: 'BDT', applicationRoute: 'Send a short note about your experience.', reviewStatus: 'APPROVED' },
  });

  publicSecrets = [
    ...secrets,
    UNPUBLISHED_MARKER,
    REVISION_MARKER,
    INVITEE_NAME,
    DECLINER_NAME,
    editable.title,
    ...Object.values(unpublished).map((p) => p.thumbnailUrl ?? ''),
    editable.thumbnailUrl ?? '',
  ];
});

// ---------------------------------------------------------------- The helper itself

describe('responseScan', () => {
  it('finds a forbidden key at any depth, under any spelling', () => {
    const body = { items: [{ owner: { Email: 'x' } }], tokenHash: 'x', meta: { sessionId: 'x', ownerEmail: 'x' } };
    expect(scanResponse(body).sort()).toEqual([
      'forbidden key at items[].owner.Email',
      'forbidden key at meta.ownerEmail',
      'forbidden key at meta.sessionId',
      'forbidden key at tokenHash',
    ]);
  });

  it('finds a forbidden value as a substring anywhere, and an address it was not told about', () => {
    const body = { note: 'hash is abc123def inside', url: 'https://x.test/projects/p1/a.png', text: 'write to someone@example.org today' };
    expect(scanResponse(body, { values: ['abc123', 'projects/p1/a.png'] })).toEqual([
      'forbidden value: abc123',
      'forbidden value: projects/p1/a.png',
      'email address: someone@example.org',
    ]);
  });

  it('lets an allowed path through, and nowhere else', () => {
    const body = { user: { email: 'me@example.com' }, other: { email: 'me@example.com' } };
    expect(scanResponse({ user: body.user }, { allow: ['user.email'], values: ['me@example.com'] })).toEqual([]);
    expect(scanResponse(body, { allow: ['user.email'] })).toEqual(['forbidden key at other.email', 'email address: me@example.com']);
  });

  it('passes a clean body', () => {
    expect(scanResponse({ items: [{ id: 'a', tags: ['x'] }], ok: true, nothing: null })).toEqual([]);
  });
});

// ---------------------------------------------------------------- Every GET route, as every viewer

type RouterName = 'app' | 'accounts' | 'projects' | 'discovery' | 'engagement' | 'messaging' | 'offers' | 'notifications' | 'reports' | 'roles' | 'admin' | 'share';

interface GetRoute {
  router: RouterName;
  path: string;
  urls: () => string[];
  statuses: Record<Viewer, number>;
  allow?: string[];
  /** Served to the public, so nothing unpublished may appear, even for the team. */
  isPublic?: boolean;
}

const everyone = (status: number, exceptions: Partial<Record<Viewer, number>> = {}) =>
  ({ ...Object.fromEntries(VIEWERS.map((viewer) => [viewer, status])), ...exceptions }) as Record<Viewer, number>;
const signedIn = everyone(200, { guest: 401 });
const teamOnly = everyone(404, { guest: 401, owner: 200, editor: 200 });
const adminOnly = everyone(403, { guest: 401, admin: 200 });

const GET_ROUTES: GetRoute[] = [
  { router: 'app', path: '/api/health', urls: () => ['/api/health'], statuses: everyone(200) },
  { router: 'accounts', path: '/config', urls: () => ['/api/auth/config'], statuses: everyone(200) },
  { router: 'accounts', path: '/me', urls: () => ['/api/auth/me'], statuses: signedIn, allow: ['user.email'] },
  { router: 'accounts', path: '/me/profile', urls: () => ['/api/auth/me/profile'], statuses: signedIn },
  { router: 'projects', path: '/mine', urls: () => ['/api/projects/mine'], statuses: signedIn },
  { router: 'projects', path: '/invites', urls: () => ['/api/projects/invites'], statuses: signedIn },
  { router: 'projects', path: '/:id/workspace', urls: () => [`/api/projects/${live.id}/workspace`], statuses: teamOnly },
  { router: 'projects', path: '/:id/preview', urls: () => [`/api/projects/${live.id}/preview`], statuses: teamOnly },
  { router: 'discovery', path: '/feed', urls: () => ['/api/projects/feed', '/api/projects/feed?page=2'], statuses: everyone(200), isPublic: true },
  { router: 'discovery', path: '/search', urls: () => ['/api/projects/search', '/api/projects/search?q=monitor&tags=iot'], statuses: everyone(200), isPublic: true },
  { router: 'discovery', path: '/tags', urls: () => ['/api/projects/tags'], statuses: everyone(200), isPublic: true },
  { router: 'discovery', path: '/suggest', urls: () => ['/api/projects/suggest', '/api/projects/suggest?q=pump'], statuses: signedIn },
  { router: 'discovery', path: '/:id', urls: () => [`/api/projects/${live.id}`, `/api/projects/${liveDemo.id}`], statuses: everyone(200), isPublic: true },
  { router: 'discovery', path: '/:id/share', urls: () => [`/api/projects/${live.id}/share`], statuses: everyone(200), isPublic: true },
  { router: 'discovery', path: '/:id/share-links', urls: () => [`/api/projects/${live.id}/share-links`], statuses: everyone(403, { guest: 401, professional: 200, owner: 200, editor: 200 }), isPublic: true },
  { router: 'share', path: '/:id', urls: () => [`/p/${live.id}`], statuses: everyone(200), isPublic: true },
  { router: 'messaging', path: '/conversations', urls: () => ['/api/messaging/conversations'], statuses: signedIn },
  { router: 'messaging', path: '/conversations/:id/messages', urls: () => [`/api/messaging/conversations/${fixtureConversation.id}/messages`], statuses: everyone(404, { guest: 401, uploader: 200, professional: 200 }) },
  { router: 'offers', path: '/mine', urls: () => ['/api/offers/mine'], statuses: everyone(403, { guest: 401, professional: 200, editor: 200 }) },
  { router: 'roles', path: '/mine', urls: () => ['/api/role-requests/mine'], statuses: signedIn },
  { router: 'admin', path: '/reports/:id/conversation', urls: () => [`/api/admin/reports/${fixtureConversationReport.id}/conversation`], statuses: adminOnly },
  { router: 'admin', path: '/offers', urls: () => ['/api/admin/offers'], statuses: adminOnly },
  { router: 'admin', path: '/projects/removed', urls: () => ['/api/admin/projects/removed'], statuses: adminOnly },
  { router: 'admin', path: '/users', urls: () => ['/api/admin/users', '/api/admin/users?q=test'], statuses: adminOnly },
  { router: 'admin', path: '/users/:id/audit', urls: () => [`/api/admin/users/${users.uploader.id}/audit`], statuses: adminOnly },
  { router: 'admin', path: '/role-requests', urls: () => ['/api/admin/role-requests'], statuses: adminOnly },
  { router: 'messaging', path: '/requests', urls: () => ['/api/messaging/requests', '/api/messaging/requests?box=outgoing'], statuses: signedIn },
  { router: 'notifications', path: '/', urls: () => ['/api/notifications'], statuses: signedIn },
  { router: 'notifications', path: '/unread-count', urls: () => ['/api/notifications/unread-count'], statuses: signedIn },
  { router: 'admin', path: '/ping', urls: () => ['/api/admin/ping'], statuses: adminOnly },
  { router: 'admin', path: '/reports', urls: () => ['/api/admin/reports'], statuses: adminOnly },
  { router: 'admin', path: '/reports/:id', urls: () => [`/api/admin/reports/${fixtureReport.id}`], statuses: adminOnly },
  { router: 'admin', path: '/reviews', urls: () => ['/api/admin/reviews'], statuses: adminOnly, allow: ['submissions[].owner.email', 'revisions[].owner.email'] },
];

const STRANGERS: readonly Viewer[] = ['guest', 'uploader', 'professional'];

describe('Every GET route', () => {
  const cases = GET_ROUTES.flatMap((route) => VIEWERS.map((viewer) => ({ ...route, viewer })));

  it.each(cases)('$router $path as $viewer: right status, nothing forbidden', async ({ urls, viewer, statuses, allow, isPublic }) => {
    const values = isPublic || STRANGERS.includes(viewer) ? publicSecrets : secrets;
    for (const url of urls()) {
      const res = await agents[viewer].get(url);
      expect({ url, status: res.status }).toEqual({ url, status: statuses[viewer] });
      expectCleanResponse(res.body, { values, allow });
    }
  });

  it('/me returns only the signed-in user’s own email', async () => {
    for (const viewer of Object.keys(ROLE_OF) as SignedIn[]) {
      const me = await agents[viewer].get('/api/auth/me');
      expect(me.body.user.email).toBe(users[viewer].email);
      expect(fields(me.body.user)).toEqual(['email', 'googleLinked', 'hasPassword', 'id', 'name', 'role', 'status']);
    }
  });
});

// ---------------------------------------------------------------- Route inventory guard

interface RouterLayer {
  name: string;
  handle: unknown;
  route?: { path: string; methods: Record<string, boolean> };
}

const ROUTERS: [RouterName, Router][] = [
  ['accounts', accountsRouter],
  ['projects', projectsRouter],
  ['discovery', discoveryRouter],
  ['engagement', engagementRouter],
  ['messaging', messagingRouter],
  ['offers', offersRouter],
  ['notifications', notificationsRouter],
  ['reports', reportsRouter],
  ['roles', rolesRouter],
  ['admin', adminRouter],
  ['share', shareRouter],
];
const layersOf = (router: Router) => (router as unknown as { stack: RouterLayer[] }).stack;
const appLayers = () => (app as unknown as { router: { stack: RouterLayer[] } }).router.stack;
/** router.all() answers GET too, but Express records it as _all. */
const getPathsIn = (layers: RouterLayer[]) =>
  layers.flatMap((layer) => (layer.route?.methods.get || layer.route?.methods._all ? [layer.route.path] : []));
const scannedPaths = (name: RouterName) => sorted(GET_ROUTES.filter((r) => r.router === name).map((r) => r.path));

describe('Route inventory', () => {
  it.each(ROUTERS)('every GET route on %s is scanned above, so a new one fails until it is', (name, router) => {
    expect(sorted(getPathsIn(layersOf(router)))).toEqual(scannedPaths(name));
  });

  it('every GET route declared on the app itself is scanned above', () => {
    expect(sorted(getPathsIn(appLayers()))).toEqual(scannedPaths('app'));
  });

  it('counts a router.all route as a GET', () => {
    const router = Router();
    router.all('/anything', () => undefined);
    expect(getPathsIn(layersOf(router))).toEqual(['/anything']);
  });

  // Anything else mounted on the app could hold routes that no check above would walk.
  it('the app mounts the known routers and otherwise only known middleware', () => {
    const mounted = appLayers()
      .filter((layer) => !layer.route)
      .map((layer) => ROUTERS.find(([, router]) => router === layer.handle)?.[0] ?? layer.name);
    expect(mounted).toEqual([
      'requireHttps', 'helmetMiddleware', 'checkOrigin', 'jsonParser', 'cookieParser', 'loadSession',
      'accounts', 'projects', 'discovery', 'engagement', 'messaging', 'offers', 'notifications', 'reports', 'roles', 'admin', 'share',
      '<anonymous>', 'errorHandler',
    ]);
  });

  // A mounted sub-router has no routes to list, so its GET routes would escape the check above.
  it.each(ROUTERS)('%s has no mounted sub-router', (name, router) => {
    const others = layersOf(router).filter((layer) => !layer.route);
    expect(others).toHaveLength(name === 'admin' ? 1 : 0); // Admin's one is requireRole('ADMIN'), pinned in permissions.test.ts.
  });
});

// ---------------------------------------------------------------- Exact field lists

const CARD = ['id', 'isSynthetic', 'stage', 'summary', 'tags', 'thumbnailUrl', 'title'];
const UPLOADER_CARD = [...CARD, 'overview'];
/** The Uploader detail view adds the roadmap, for the project bulletin. */
const ROADMAP = ['completion', 'milestones', 'progress'];
const FULL_CARD = [...UPLOADER_CARD, 'owner', 'likeCount', 'commentCount'];
const DEMO = ['demoUrl', 'screenshots'];
const FULL_DETAIL = [...FULL_CARD, ...DEMO, 'comments', 'completion', 'likedByMe', 'milestones', 'offers', 'problem', 'progress', 'team'];
/** The team's preview shows the content a Professional will see, without likes and comments. */
const PREVIEW_DETAIL = FULL_DETAIL.filter((f) => !['likeCount', 'commentCount', 'comments', 'likedByMe', 'offers'].includes(f));

describe('Exact field lists', () => {
  const cardOf = (res: Res, id: string) => {
    const card = res.body.items.find((item: { id: string }) => item.id === id);
    if (!card) throw new Error(`Project ${id} is not in this response.`);
    return card;
  };

  it.each([
    ['guest', CARD],
    ['uploader', UPLOADER_CARD],
    ['professional', FULL_CARD],
    ['admin', FULL_CARD],
  ] as [Viewer, string[]][])('feed card and page for %s', async (viewer, expected) => {
    const res = await agents[viewer].get('/api/projects/feed');
    expect(fields(cardOf(res, live.id))).toEqual(sorted(expected));
    const envelope = ['hasMore', 'items', 'page', 'pageSize', 'tier'];
    expect(fields(res.body)).toEqual(sorted(viewer === 'guest' ? [...envelope, 'guest'] : envelope));
    if (viewer === 'guest') expect(fields(res.body.guest)).toEqual(['capReached', 'cardsServed', 'limit']);
  });

  it.each([
    ['guest', CARD],
    ['uploader', UPLOADER_CARD],
    ['professional', FULL_CARD],
    ['admin', FULL_CARD],
  ] as [Viewer, string[]][])('search card and page for %s', async (viewer, expected) => {
    const res = await agents[viewer].get('/api/projects/search?q=pump');
    expect(fields(cardOf(res, live.id))).toEqual(sorted(expected));
    const envelope = ['hasMore', 'items', 'page', 'pageSize', 'query', 'tier', 'total'];
    expect(fields(res.body)).toEqual(sorted(viewer === 'guest' ? [...envelope, 'guest'] : envelope));
  });

  it.each([
    ['guest', 'live', CARD],
    ['guest', 'liveDemo', CARD],
    ['uploader', 'live', [...UPLOADER_CARD, ...ROADMAP]],
    ['uploader', 'liveDemo', [...UPLOADER_CARD, ...DEMO, ...ROADMAP]],
    ['professional', 'live', FULL_DETAIL],
    ['professional', 'liveDemo', FULL_DETAIL],
    ['admin', 'live', FULL_DETAIL],
    ['admin', 'liveDemo', FULL_DETAIL],
    // The team reads the public view as any other viewer of their tier.
    ['owner', 'live', [...UPLOADER_CARD, ...ROADMAP]],
    ['editor', 'live', FULL_DETAIL],
  ] as [Viewer, 'live' | 'liveDemo', string[]][])('detail view for %s on %s', async (viewer, which, expected) => {
    const project = which === 'live' ? live : liveDemo;
    const res = await agents[viewer].get(`/api/projects/${project.id}`);
    expect(fields(res.body)).toEqual(['project', 'tier']);
    expect(fields(res.body.project)).toEqual(sorted(expected));
  });

  it('keeps every text within its tier’s limit', async () => {
    const guest = (await agents.guest.get(`/api/projects/${live.id}`)).body.project;
    expect(guest.summary.length).toBeLessThanOrEqual(150);
    const uploader = (await agents.uploader.get(`/api/projects/${live.id}`)).body.project;
    expect(uploader.summary.length).toBeLessThanOrEqual(150);
    expect(uploader.overview.length).toBeLessThanOrEqual(500);
    const professional = (await agents.professional.get(`/api/projects/${live.id}`)).body.project;
    expect(professional.summary).toBe(LONG_SUMMARY);
    expect(professional.overview).toBe(LONG_OVERVIEW);
  });

  it('builds the nested parts of the detail view from their own lists, crediting accepted members only', async () => {
    const { project } = (await agents.professional.get(`/api/projects/${live.id}`)).body;
    expect(fields(project.owner)).toEqual(['name']);
    expect(fields(project.milestones[0])).toEqual(['dueDate', 'id', 'status', 'title']);
    expect(fields(project.progress[0])).toEqual(['body', 'createdAt', 'id']);
    expect(fields(project.screenshots[0])).toEqual(['id', 'url']);
    expect(project.team).toEqual([
      { name: users.owner.name, role: 'OWNER' },
      { name: users.editor.name, role: 'EDITOR' },
    ]);
  });

  describe('team views', () => {
    const PROJECT = [
      'completion', 'demoUrl', 'id', 'overview', 'owner', 'problem', 'publicDemo', 'publishedAt', 'reviewNote', 'stage', 'status', 'submittedAt', 'summary', 'tags', 'thumbnailUrl', 'title', 'updatedAt',
    ];

    it('workspace: the owner sees the whole team list, naming only those who accepted, and no emails', async () => {
      const { body } = await agents.owner.get(`/api/projects/${live.id}/workspace`);
      expect(fields(body)).toEqual(['media', 'members', 'milestones', 'myRole', 'progress', 'project', 'revision']);
      expect(fields(body.project)).toEqual(sorted(PROJECT));
      expect(fields(body.project.owner)).toEqual(['name']);
      expect(fields(body.revision)).toEqual(['createdAt', 'demoUrl', 'id', 'overview', 'problem', 'reviewNote', 'status', 'summary', 'tags', 'title']);
      expect(fields(body.media[0])).toEqual(['id', 'mimeType', 'sizeBytes', 'url']);
      expect(fields(body.milestones[0])).toEqual(['dueDate', 'id', 'status', 'title']);
      expect(fields(body.progress[0])).toEqual(['authorName', 'body', 'createdAt', 'id']);
      // The fixture's rows share one createdAt, so their order is not fixed.
      expect(body.members).toHaveLength(3);
      expect(body.members).toEqual(
        expect.arrayContaining([
          { id: expect.any(String), userId: users.editor.id, name: users.editor.name, status: 'ACCEPTED' },
          { id: expect.any(String), status: 'INVITED' },
          { id: expect.any(String), status: 'DECLINED' },
        ]),
      );
      expectCleanResponse(body, { values: [...secrets, INVITEE_NAME, DECLINER_NAME, users.invitee.id, decliner.id] });
    });

    it('inviting an address tells the owner nothing about the person, and the row can be withdrawn by its id', async () => {
      const draft = await createProject(users.owner.id, { status: 'DRAFT' });
      const membersUrl = `/api/projects/${draft.id}/members`;
      expect((await agents.owner.post(membersUrl).send({ email: users.uploader.email })).status).toBe(201);

      const { body } = await agents.owner.get(`/api/projects/${draft.id}/workspace`);
      expect(body.members).toEqual([{ id: expect.any(String), status: 'INVITED' }]);
      expectCleanResponse(body, { values: [...secrets, users.uploader.name, users.uploader.id] });

      expect((await agents.owner.delete(`${membersUrl}/${users.uploader.id}`)).status).toBe(404);
      expect((await agents.owner.delete(`${membersUrl}/${body.members[0].id}`)).status).toBe(204);
      expect(await prisma.projectMember.count({ where: { projectId: draft.id } })).toBe(0);
    });

    it('an accepted member can still be removed by user id, or by the row id the workspace gives', async () => {
      const draft = await createProject(users.owner.id, { status: 'DRAFT' });
      const accepted = { userId: users.professional.id, status: 'ACCEPTED', invitedById: users.owner.id };
      const row = await prisma.projectMember.create({ data: { projectId: draft.id, ...accepted } });
      expect((await agents.owner.delete(`/api/projects/${draft.id}/members/${row.id}`)).status).toBe(204);
      await prisma.projectMember.create({ data: { projectId: draft.id, ...accepted } });
      expect((await agents.owner.delete(`/api/projects/${draft.id}/members/${users.professional.id}`)).status).toBe(204);
      expect(await prisma.projectMember.count({ where: { projectId: draft.id } })).toBe(0);
    });

    it('an Admin invited like anyone else cannot accept and is not shown the invite', async () => {
      const draft = await createProject(users.owner.id, { status: 'DRAFT' });
      expect((await agents.owner.post(`/api/projects/${draft.id}/members`).send({ email: users.admin.email })).status).toBe(201);
      expect((await agents.admin.get('/api/projects/invites')).body.items).toEqual([]);
      expect((await agents.admin.post(`/api/projects/invites/${draft.id}/accept`)).status).toBe(403);
      await prisma.projectMember.deleteMany({ where: { projectId: draft.id } });
    });

    it('invites are limited per signed-in user', async () => {
      const inviter = await createUser({ role: 'UPLOADER' });
      const agent = request.agent(app);
      await agent.post('/api/auth/login').send({ email: inviter.email, password: PASSWORD });
      const draft = await createProject(inviter.id, { status: 'DRAFT' });
      const attempt = (who: Agent) => who.post(`/api/projects/${draft.id}/members`).send({ email: 'not-an-email' });
      for (let i = 0; i < config.inviteRateLimit; i += 1) expect((await attempt(agent)).status).toBe(400);
      const limited = await attempt(agent);
      expect(limited.status).toBe(429);
      expect(limited.body.error.code).toBe('RATE_LIMITED');
      // Someone else is not affected, and is refused for their own reasons.
      expect((await attempt(agents.professional)).status).toBe(400);
    }, SLOW);

    it('workspace: an editor sees only who has accepted, not who was invited or declined', async () => {
      const { body } = await agents.editor.get(`/api/projects/${live.id}/workspace`);
      expect(body.myRole).toBe('EDITOR');
      expect(body.members).toEqual([{ id: expect.any(String), userId: users.editor.id, name: users.editor.name, status: 'ACCEPTED' }]);
      expectCleanResponse(body, { values: [...secrets, INVITEE_NAME, DECLINER_NAME] });
    });

    it.each(['owner', 'editor'] as const)('preview for the %s: the full view of the pending revision, no one uninvolved', async (viewer) => {
      const { body } = await agents[viewer].get(`/api/projects/${live.id}/preview`);
      expect(fields(body)).toEqual(['project', 'showsPendingRevision', 'status']);
      expect(fields(body.project)).toEqual(sorted(PREVIEW_DETAIL));
      expect(body.project.overview).toContain(REVISION_MARKER);
      expectCleanResponse(body, { values: [...secrets, INVITEE_NAME, DECLINER_NAME] });
    });

    it('lists: My projects and invitations use their own short lists', async () => {
      const mine = await agents.owner.get('/api/projects/mine');
      expect(fields(mine.body.items[0])).toEqual([
        'hasPendingRevision', 'id', 'myRole', 'publishedAt', 'reviewNote', 'stage', 'status', 'tags', 'title', 'updatedAt',
      ]);
      expect(mine.body.items.map((p: { id: string }) => p.id)).not.toContain(unpublished.DELETED.id);

      const invites = await agents.invitee.get('/api/projects/invites');
      expect(fields(invites.body.items[0])).toEqual(['invitedAt', 'ownerName', 'projectId', 'title']);
      expect(invites.body.items.map((i: { projectId: string }) => i.projectId)).not.toContain(unpublished.DELETED.id);
    });

    it('review queue: the owner’s name and email, and otherwise the content being reviewed', async () => {
      const { body } = await agents.admin.get('/api/admin/reviews');
      const submission = body.submissions.find((s: { id: string }) => s.id === unpublished.SUBMITTED.id);
      expect(fields(submission)).toEqual([
        'demoUrl', 'id', 'overview', 'owner', 'ownershipDeclaredAt', 'problem', 'screenshots', 'stage', 'submittedAt', 'summary', 'tags', 'title',
      ]);
      expect(submission.owner).toEqual({ name: users.owner.name, email: users.owner.email });
      const revision = body.revisions.find((r: { projectId: string }) => r.projectId === live.id);
      expect(fields(revision)).toEqual(['current', 'id', 'owner', 'projectId', 'proposed', 'submittedAt']);
      expect(revision.owner).toEqual({ name: users.owner.name, email: users.owner.email });
      expect(fields(revision.proposed)).toEqual(['demoUrl', 'overview', 'problem', 'summary', 'tags', 'title']);
    });
  });
});

// ---------------------------------------------------------------- Direct requests to anything unpublished

const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Project not found.' } };

describe.each(UNPUBLISHED_STATUSES)('Direct requests to a %s project', (status) => {
  const publicUrlOf = () => `/api/projects/${unpublished[status].id}`;
  const urls = () => [publicUrlOf(), `${publicUrlOf()}/workspace`, `${publicUrlOf()}/preview`];
  const expectNotFound = (url: string, res: Res) => expect({ url, status: res.status, body: res.body }).toEqual({ url, status: 404, body: NOT_FOUND });

  it.each(['uploader', 'professional', 'admin', 'invitee'] as const)('%s gets the same 404 as an unknown id on all three routes', async (viewer) => {
    signedUrl.mockClear();
    for (const url of urls()) expectNotFound(url, await agents[viewer].get(url));
    expect(signedUrl).not.toHaveBeenCalled();
  });

  // requireAuth runs first on workspace and preview, as permissions.test.ts pins, so a Guest gets 401
  // there rather than 404. It is the same 401 for any id, so it says nothing about this project.
  it('a Guest gets 404 on the public view, and on workspace and preview the same 401 as for an unknown id', async () => {
    const guest = request.agent(app);
    expectNotFound(publicUrlOf(), await guest.get(publicUrlOf()));
    for (const suffix of ['workspace', 'preview']) {
      const res = await guest.get(`${publicUrlOf()}/${suffix}`);
      const unknown = await guest.get(`/api/projects/no-such-id/${suffix}`);
      expect(res.status).toBe(401);
      expect({ status: res.status, body: res.body }).toEqual({ status: unknown.status, body: unknown.body });
    }
  });

  it.each(['owner', 'editor'] as const)('the %s gets 404 on the public view too', async (viewer) => {
    expectNotFound(publicUrlOf(), await agents[viewer].get(publicUrlOf()));
  });

  if (status === 'DELETED') {
    it.each(['owner', 'editor'] as const)('the %s gets 404 on workspace and preview as well', async (viewer) => {
      for (const url of urls()) expectNotFound(url, await agents[viewer].get(url));
    });
  } else {
    it.each(['owner', 'editor'] as const)('the %s keeps workspace and preview', async (viewer) => {
      expect((await agents[viewer].get(`${publicUrlOf()}/workspace`)).status).toBe(200);
      expect((await agents[viewer].get(`${publicUrlOf()}/preview`)).status).toBe(200);
    });
  }
});

// ---------------------------------------------------------------- Mutating routes that return data

describe('Mutating routes', () => {
  const SIGN_IN_USER = ['googleLinked', 'hasPassword', 'id', 'name', 'role', 'status'];

  /** A sign-in response: the account without its email, and the session only in the cookie. */
  function expectCleanSignIn(res: Res, email: string) {
    expect(fields(res.body)).toEqual(['user']);
    expect(fields(res.body.user)).toEqual(SIGN_IN_USER);
    expectCleanResponse(res.body, { values: [...secrets, email, cookieValue(res, SESSION_COOKIE)] });
  }

  it('register', async () => {
    const res = await request(app).post('/api/auth/register').send({ name: 'New Person', email: 'new-person@example.com', password: PASSWORD });
    expect(res.status).toBe(201);
    expectCleanSignIn(res, 'new-person@example.com');
  });

  it('login', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: users.uploader.email, password: PASSWORD });
    expect(res.status).toBe(200);
    expectCleanSignIn(res, users.uploader.email);
  });

  it('Google sign-in', async () => {
    googleAccounts.set('views', { sub: 'google-views-sub', email: 'google-views@example.com', emailVerified: true, name: 'Google Person' });
    const res = await request(app).post('/api/auth/google').send({ credential: 'google:views'.padEnd(30, 'x') });
    expect(res.status).toBe(200);
    expectCleanSignIn(res, 'google-views@example.com');
    expect(JSON.stringify(res.body)).not.toContain('google-views-sub');
  });

  it('forgot and reset password say nothing about the account or the token', async () => {
    const forgot = await request(app).post('/api/auth/forgot-password').send({ email: users.editor.email });
    expect(forgot.status).toBe(200);
    expect(fields(forgot.body)).toEqual(['message']);
    expectCleanResponse(forgot.body, { values: [...secrets, tokenFromLastResetMail()] });
    const token = tokenFromLastResetMail();
    const stored = await prisma.emailToken.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } });
    expect(stored.tokenHash).not.toBe(token);
  });

  it.each(['owner', 'editor'] as const)('PATCH project as the %s returns the workspace and nothing more', async (viewer) => {
    const res = await agents[viewer].patch(`/api/projects/${editable.id}`).send({ stage: 'PILOT' });
    expect(res.status).toBe(200);
    expect(fields(res.body)).toEqual(['media', 'members', 'milestones', 'myRole', 'progress', 'project', 'revision']);
    // The fixture's rows share one createdAt, so their order is not fixed.
    const accepted = res.body.members.find((m: { status: string }) => m.status === 'ACCEPTED');
    expect(fields(accepted)).toEqual(['id', 'name', 'status', 'userId']);
    expectCleanResponse(res.body, { values: secrets });
  });

  it('PATCH on a live project echoes the pending revision without its author', async () => {
    const res = await agents.owner.patch(`/api/projects/${live.id}`).send({ summary: 'A changed summary for the review queue.' });
    expect(res.status).toBe(200);
    expect(res.body.revision).not.toHaveProperty('authorId');
    expectCleanResponse(res.body, { values: secrets });
  });

  it('screenshot upload returns signed URLs and no storage path field', async () => {
    const res = await agents.owner.post(`/api/projects/${editable.id}/media`).attach('screenshots', PNG_BYTES, { filename: 'new.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    const stored = await paths(editable.id);
    expect(res.body.media).toHaveLength(stored.length);
    for (const media of res.body.media) expect(stored).toContain(issued.get(media.url));
    expectCleanResponse(res.body, { values: [...secrets, ...stored] });
  });

  it('cover upload returns a public URL whose path cannot be guessed, and removing it clears it', async () => {
    const res = await agents.owner.post(`/api/projects/${editable.id}/cover`).attach('cover', PNG_BYTES, { filename: 'c.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body.project.thumbnailUrl).toMatch(new RegExp(`projects/${editable.id}/cover-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.png$`));
    expectCleanResponse(res.body, { values: [...secrets, ...(await paths(editable.id))] });

    const removed = await agents.owner.delete(`/api/projects/${editable.id}/cover`);
    expect(removed.body.project.thumbnailUrl).toBeNull();
    expectCleanResponse(removed.body, { values: secrets });
  });

  it('creating progress and milestones returns only the new id', async () => {
    const progress = await agents.owner.post(`/api/projects/${editable.id}/progress`).send({ body: 'Another update.' });
    expect(progress.status).toBe(201);
    expect(fields(progress.body)).toEqual(['id']);
    const milestone = await agents.owner.post(`/api/projects/${editable.id}/milestones`).send({ title: 'Field trial' });
    expect(milestone.status).toBe(201);
    expect(fields(milestone.body)).toEqual(['id']);
    const created = await agents.owner.post('/api/projects').send({ title: 'Another draft' });
    expect(created.status).toBe(201);
    expect(fields(created.body)).toEqual(['id']);
  });

  it('submit returns only its state', async () => {
    const res = await agents.owner.post(`/api/projects/${editable.id}/submit`).send({ ownershipDeclared: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, status: 'SUBMITTED' });
  });

  it('errors keep to code, message and fields, and do not echo an address', async () => {
    const taken = await request(app).post('/api/auth/register').send({ name: 'Someone', email: users.owner.email, password: PASSWORD });
    expect(taken.status).toBe(409);
    expect(fields(taken.body.error)).toEqual(['code', 'fields', 'message']);
    expect(taken.body.error.fields.email).not.toContain('@');
    expectCleanResponse(taken.body, { values: secrets, allow: ['error.fields.email'] });

    const unknown = await agents.owner.post(`/api/projects/${live.id}/members`).send({ email: 'never-registered@example.com' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.fields.email).not.toContain('@');
    expectCleanResponse(unknown.body, { values: [...secrets, 'never-registered@example.com'], allow: ['error.fields.email'] });

    const denied = await request(app).post('/api/auth/login').send({ email: users.owner.email, password: 'WrongPassword1' });
    expect(denied.status).toBe(401);
    expect(fields(denied.body.error)).toEqual(['code', 'message']);
    expectCleanResponse(denied.body, { values: secrets });

    const invalid = await agents.owner.post('/api/projects').send({ title: 'x' });
    expect(invalid.status).toBe(400);
    expect(fields(invalid.body.error)).toEqual(['code', 'fields', 'message']);
    expectCleanResponse(invalid.body, { values: secrets });
  });
});

// ---------------------------------------------------------------- Private screenshots

describe('Private screenshots', () => {
  /** Runs one request and returns its response with the storage paths it asked to sign. */
  async function signedDuring(call: () => Promise<Res>) {
    signedUrl.mockClear();
    const res = await call();
    return { res, requested: signedUrl.mock.calls.map(([path]) => path).sort() };
  }

  function expectOnlySignedUrls(screenshots: { url: string }[], projectPaths: string[]) {
    expect(screenshots.map((s) => issued.get(s.url)).sort()).toEqual(projectPaths);
  }

  it('keeps the signed lifetime at 15 minutes or less', () => {
    expect(config.media.signedUrlTtlSeconds).toBeLessThanOrEqual(900);
  });

  it.each(['live', 'liveDemo'] as const)('a Guest never gets one, and none is signed, on %s', async (which) => {
    const project = which === 'live' ? live : liveDemo;
    const { res, requested } = await signedDuring(() => agents.guest.get(`/api/projects/${project.id}`));
    expect(res.status).toBe(200);
    expect(res.body.project.screenshots).toBeUndefined();
    expect(requested).toEqual([]);
  });

  it('no feed or search signs anything', async () => {
    for (const [viewer, url] of [
      ['guest', '/api/projects/feed'],
      ['professional', '/api/projects/feed'],
      ['professional', '/api/projects/search?q=monitor'],
    ] as [Viewer, string][]) {
      const { res, requested } = await signedDuring(() => agents[viewer].get(url));
      expect(res.status).toBe(200);
      expect(requested).toEqual([]);
    }
  });

  it('an Uploader gets them only when the owner made the demo public', async () => {
    const closed = await signedDuring(() => agents.uploader.get(`/api/projects/${live.id}`));
    expect(closed.res.body.project.screenshots).toBeUndefined();
    expect(closed.res.body.project.demoUrl).toBeUndefined();
    expect(closed.requested).toEqual([]);

    const open = await signedDuring(() => agents.uploader.get(`/api/projects/${liveDemo.id}`));
    const expected = await paths(liveDemo.id);
    expect(open.requested).toEqual(expected);
    expectOnlySignedUrls(open.res.body.project.screenshots, expected);
  });

  it.each(['professional', 'admin'] as const)('%s gets them, signed, whether or not the demo is public', async (viewer) => {
    for (const project of [live, liveDemo]) {
      const { res, requested } = await signedDuring(() => agents[viewer].get(`/api/projects/${project.id}`));
      const expected = await paths(project.id);
      expect(requested).toEqual(expected);
      expectOnlySignedUrls(res.body.project.screenshots, expected);
    }
  });

  it('the team gets them through workspace and preview, and no one else causes a signing there', async () => {
    const expected = await paths(live.id);
    for (const viewer of ['owner', 'editor'] as const) {
      const workspace = await signedDuring(() => agents[viewer].get(`/api/projects/${live.id}/workspace`));
      expect(workspace.requested).toEqual(expected);
      expectOnlySignedUrls(workspace.res.body.media, expected);
      const preview = await signedDuring(() => agents[viewer].get(`/api/projects/${live.id}/preview`));
      expect(preview.requested).toEqual(expected);
      expectOnlySignedUrls(preview.res.body.project.screenshots, expected);
    }
    for (const viewer of ['uploader', 'professional', 'admin', 'invitee'] as const) {
      for (const suffix of ['workspace', 'preview']) {
        const { res, requested } = await signedDuring(() => agents[viewer].get(`/api/projects/${live.id}/${suffix}`));
        expect(res.status).toBe(404);
        expect(requested).toEqual([]);
      }
    }
  });

  it('the review queue signs only what is under review', async () => {
    const { res, requested } = await signedDuring(() => agents.admin.get('/api/admin/reviews'));
    const submitted = (await Promise.all(res.body.submissions.map((s: { id: string }) => paths(s.id)))).flat().sort();
    expect(requested).toEqual(submitted);
  });

  it('never asks the private bucket for a public URL', () => {
    expect(publicUrl).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- The guest budget

describe('Guest budget', () => {
  const LIMIT = config.guestCardLimit;
  let feedOrder: string[];

  /** A guest with their own session, optionally already holding some of the budget. */
  async function newGuest(seen: string[] = []) {
    const token = randomToken();
    const { id } = await prisma.guestSession.create({
      data: { tokenHash: hashToken(token), seenProjectIds: seen, cardsServed: Math.min(seen.length, LIMIT) },
    });
    const cookie = `${GUEST_COOKIE}=${token}`;
    const get = (url: string) => request(app).get(url).set('Cookie', cookie);
    return {
      cookie,
      open: (projectId: string) => get(`/api/projects/${projectId}`),
      feed: (page = 1) => get(`/api/projects/feed?page=${page}`),
      row: () => prisma.guestSession.findUniqueOrThrow({ where: { id } }),
    };
  }

  const idsOf = (res: Res): string[] => res.body.items.map((item: { id: string }) => item.id);

  async function openAll(guest: Awaited<ReturnType<typeof newGuest>>, ids: string[]) {
    for (const id of ids) expect((await guest.open(id)).status).toBe(200);
  }

  async function expectBudgetUsed(guest: Awaited<ReturnType<typeof newGuest>>, count: number) {
    const row = await guest.row();
    expect(new Set(row.seenProjectIds).size).toBe(row.seenProjectIds.length);
    expect({ seen: row.seenProjectIds.length, cardsServed: row.cardsServed }).toEqual({ seen: count, cardsServed: count });
  }

  beforeAll(async () => {
    await prisma.project.createMany({
      data: Array.from({ length: 45 }, (_, i) => ({
        ...COMPLETE_PROJECT,
        ownerId: users.owner.id,
        title: `Budget Project ${i}`,
        status: 'PUBLISHED',
        publishedAt: new Date(Date.now() - (i + 1) * 60_000),
      })),
    });
    const all = await prisma.project.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    feedOrder = all.map((p) => p.id);
  });

  it(
    '20 direct links, then the feed shows no new card',
    async () => {
      const guest = await newGuest();
      const opened = feedOrder.slice(-LIMIT);
      await openAll(guest, opened);
      await expectBudgetUsed(guest, LIMIT);

      const page1 = await guest.feed(1);
      const page2 = await guest.feed(2);
      const shown = [...idsOf(page1), ...idsOf(page2)];
      expect(sorted(shown)).toEqual(sorted(opened));
      expect(page1.body.hasMore).toBe(true);
      expect(page1.body.guest).toEqual({ limit: LIMIT, cardsServed: LIMIT, capReached: false });
      expect(page2.body.hasMore).toBe(false);
      expect(page2.body.guest).toEqual({ limit: LIMIT, cardsServed: LIMIT, capReached: true });
      await expectBudgetUsed(guest, LIMIT);
    },
    SLOW,
  );

  it.each([
    ['the oldest projects, which the feed would not have reached', () => feedOrder.slice(-15)],
    ['the newest projects, which the feed starts with', () => feedOrder.slice(0, 15)],
  ])(
    '15 direct links to %s, then the feed shows only 5 new cards',
    async (_name, pick) => {
      const guest = await newGuest();
      const opened = pick();
      await openAll(guest, opened);

      const page1 = await guest.feed(1);
      const page2 = await guest.feed(2);
      const newCards = [...idsOf(page1), ...idsOf(page2)].filter((id) => !opened.includes(id));
      expect(new Set(newCards).size).toBe(5);
      expect(page2.body.hasMore).toBe(false);
      expect(page2.body.guest).toEqual({ limit: LIMIT, cardsServed: LIMIT, capReached: true });
      await expectBudgetUsed(guest, LIMIT);

      expect((await guest.open(feedOrder.find((id) => !opened.includes(id) && !newCards.includes(id))!)).status).toBe(403);
    },
    SLOW,
  );

  it('revisiting pages changes neither the cards nor the count, and cannot reset it', async () => {
    const guest = await newGuest();
    const first = await guest.feed(1);
    expect(first.body.guest.cardsServed).toBe(10);
    expect(idsOf(await guest.feed(1))).toEqual(idsOf(first));
    await expectBudgetUsed(guest, 10);

    const second = await guest.feed(2);
    expect(second.body.guest).toEqual({ limit: LIMIT, cardsServed: LIMIT, capReached: true });
    for (const page of [1, 2, 1, 2]) {
      const res = await guest.feed(page);
      expect(idsOf(res)).toEqual(idsOf(page === 1 ? first : second));
      expect(res.body.guest.cardsServed).toBe(LIMIT);
    }
    await expectBudgetUsed(guest, LIMIT);
  });

  it.each([
    ['a new guest', 0],
    ['a guest part way through', 7],
    ['a guest at the cap', LIMIT],
  ])('refuses a page at or beyond the limit for %s', async (_name, seen) => {
    const guest = await newGuest(feedOrder.slice(0, seen));
    for (const page of [3, 4, 1000]) {
      const res = await guest.feed(page);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('GUEST_LIMIT');
    }
    await expectBudgetUsed(guest, seen);
  });

  it('page 1 after new projects are published never takes the guest past 20 distinct', async () => {
    const guest = await newGuest();
    expect((await guest.feed(1)).body.guest.cardsServed).toBe(10);

    async function publishFive(batch: string) {
      await prisma.project.createMany({
        data: Array.from({ length: 5 }, (_, i) => ({
          ...COMPLETE_PROJECT,
          ownerId: users.owner.id,
          title: `Newly Published ${batch} ${i}`,
          status: 'PUBLISHED',
          publishedAt: new Date(),
        })),
      });
    }

    // Each refresh spends the budget on what is new, until none is left.
    for (const [batch, expected] of [['a', 15], ['b', 20], ['c', 20], ['d', 20]] as [string, number][]) {
      await publishFive(batch);
      const page1 = await guest.feed(1);
      expect(page1.body.items).toHaveLength(10);
      expect(page1.body.guest.cardsServed).toBe(expected);
      await expectBudgetUsed(guest, expected);
      expect((await guest.row()).seenProjectIds).toEqual(expect.arrayContaining(idsOf(page1)));
    }

    // What they have seen stays reachable, though newer projects now fill the first positions.
    const { seenProjectIds } = await guest.row();
    const pages = [...idsOf(await guest.feed(1)), ...idsOf(await guest.feed(2))];
    expect(sorted(pages)).toEqual(sorted(seenProjectIds));
    await expectBudgetUsed(guest, LIMIT);
  });

  it('reopening a seen project is always allowed and free, even at the cap, and a new one is refused', async () => {
    const seen = feedOrder.slice(0, LIMIT);
    const guest = await newGuest(seen);

    for (const id of [seen[0], seen[LIMIT - 1], seen[0]]) {
      const res = await guest.open(id);
      expect(res.status).toBe(200);
      expect(fields(res.body.project)).toEqual(sorted(CARD));
    }
    const refused = await guest.open(feedOrder[LIMIT]);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('GUEST_LIMIT');
    expect(sorted((await guest.row()).seenProjectIds)).toEqual(sorted(seen));
  });

  it('a 404 costs nothing: no budget for a session, no session for a cookieless request, even at the cap', async () => {
    const guest = await newGuest();
    for (const status of UNPUBLISHED_STATUSES) expect((await guest.open(unpublished[status].id)).status).toBe(404);
    expect((await guest.open('no-such-project')).status).toBe(404);
    await expectBudgetUsed(guest, 0);

    const sessions = await prisma.guestSession.count();
    const cookieless = await request(app).get(`/api/projects/${unpublished.HIDDEN.id}`);
    expect(cookieless.status).toBe(404);
    expect(cookieless.headers['set-cookie']).toBeUndefined();
    expect(await prisma.guestSession.count()).toBe(sessions);

    const capped = await newGuest(feedOrder.slice(0, LIMIT));
    expect((await capped.open(unpublished.HIDDEN.id)).status).toBe(404);
    await expectBudgetUsed(capped, LIMIT);
  });

  it('a seen project that is later hidden is 404 and off the feed, and its place in the budget is not refunded', async () => {
    const victim = feedOrder[feedOrder.length - 1];
    const guest = await newGuest();
    expect((await guest.open(victim)).status).toBe(200);
    await prisma.project.update({ where: { id: victim }, data: { status: 'HIDDEN' } });
    try {
      expect((await guest.open(victim)).status).toBe(404);
      expect(idsOf(await guest.feed(1))).not.toContain(victim);
      expect((await guest.row()).seenProjectIds).toContain(victim);
    } finally {
      await prisma.project.update({ where: { id: victim }, data: { status: 'PUBLISHED' } });
    }
  });

  it('never reports more than the limit, even for a session the earlier code let grow past it', async () => {
    const guest = await newGuest(feedOrder.slice(0, LIMIT + 5));
    const res = await guest.feed(1);
    expect(res.body.guest.cardsServed).toBe(LIMIT);
    expect((await guest.row()).seenProjectIds).toHaveLength(LIMIT + 5);
    expect((await guest.open(feedOrder[LIMIT + 5])).status).toBe(403);
  });

  // The cap is per anonymous session, not per person (Section 4.2). A request without the cookie is a
  // new session with a new budget, so clearing cookies starts again. SRS 4.6 accepts that limit; this
  // test records it, and that one session's cap is not lifted by another's.
  it('a guest without the cookie, or with one that matches nothing, gets a new session: the accepted limit', async () => {
    const capped = await newGuest(feedOrder.slice(0, LIMIT));
    const next = feedOrder[LIMIT];
    expect((await capped.open(next)).status).toBe(403);

    const cookieless = await request(app).get(`/api/projects/${next}`);
    expect(cookieless.status).toBe(200);
    const token = cookieValue(cookieless, GUEST_COOKIE);
    const session = await prisma.guestSession.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } });
    expect(session.seenProjectIds).toEqual([next]);

    const forged = await request(app).get(`/api/projects/${next}`).set('Cookie', `${GUEST_COOKIE}=not-a-real-session`);
    expect(forged.status).toBe(200);
    expect(cookieValue(forged, GUEST_COOKIE)).not.toBe('not-a-real-session');

    expect((await capped.open(next)).status).toBe(403);
    await expectBudgetUsed(capped, LIMIT);
  });

  it('a cookie that cookie-parser reads as JSON counts as no cookie, not as a server error', async () => {
    const jsonCookie = (name: string) => `${name}=j:{"a":1}`;
    const guest = await request(app).get(`/api/projects/${feedOrder[0]}`).set('Cookie', jsonCookie(GUEST_COOKIE));
    expect(guest.status).toBe(200);
    expect(cookieValue(guest, GUEST_COOKIE)).not.toContain('j:');

    const session = await request(app).get('/api/auth/me').set('Cookie', jsonCookie(SESSION_COOKIE));
    expect(session.status).toBe(401);
  });

  describe('under parallel requests', () => {
    /**
     * Runs against a second copy of the app with its own connection pool. The remote pooler allows 15
     * connections in session mode, and each request waiting on the row lock holds one, so the
     * default pool would be refused by the pooler before the budget is ever tested.
     *
     * Waiting for a turn is the load under test, so on a slow link it must not end in the P2024 or
     * P2028 that also mark the known database outage. A transaction still expires, so one stuck
     * waiting on its own connection still fails.
     */
    async function withAppOnConnections(limit: number, run: (copy: typeof import('./helpers.js')) => Promise<void>) {
      await prisma.$disconnect();
      const url = new URL(process.env.DATABASE_URL!);
      url.searchParams.set('connection_limit', String(limit));
      url.searchParams.set('pool_timeout', '0');
      vi.stubEnv('DATABASE_URL', url.href);
      vi.resetModules();
      vi.doMock('../src/lib/prisma.js', async (importOriginal) => ({
        ...(await importOriginal<typeof import('../src/lib/prisma.js')>()),
        TX_OPTIONS: { maxWait: SLOW, timeout: 60_000 },
      }));
      const copy = await import('./helpers.js');
      expect(copy.prisma).not.toBe(prisma); // A new client, so it reads the URL above.
      try {
        await run(copy);
      } finally {
        await copy.prisma.$disconnect();
        vi.doUnmock('../src/lib/prisma.js');
        vi.unstubAllEnvs();
        vi.resetModules();
      }
    }

    it(
      'admits exactly 20 of 30 direct links to different projects from one session',
      () =>
        withAppOnConnections(12, async (copy) => {
          const guest = await newGuest();
          const ids = feedOrder.slice(0, 30);
          const responses = await Promise.all(ids.map((id) => copy.request(copy.app).get(`/api/projects/${id}`).set('Cookie', guest.cookie)));

          expect(responses.map((r) => r.status).filter((s) => s !== 200 && s !== 403)).toEqual([]);
          const admitted = ids.filter((_, i) => responses[i].status === 200);
          expect(admitted).toHaveLength(LIMIT);
          for (const res of responses) if (res.status === 403) expect(res.body.error.code).toBe('GUEST_LIMIT');

          await expectBudgetUsed(guest, LIMIT);
          expect(sorted((await guest.row()).seenProjectIds)).toEqual(sorted(admitted));
        }),
      SLOW,
    );

    it(
      'shares one budget between feed pages and direct links arriving together',
      () =>
        withAppOnConnections(8, async (copy) => {
          const guest = await newGuest();
          const get = (path: string) => copy.request(copy.app).get(path).set('Cookie', guest.cookie);
          const direct = feedOrder.slice(-15);
          const [page1, page2, ...opens] = await Promise.all([
            get('/api/projects/feed?page=1'),
            get('/api/projects/feed?page=2'),
            ...direct.map((id) => get(`/api/projects/${id}`)),
          ]);

          expect([page1.status, page2.status]).toEqual([200, 200]);
          for (const res of opens) expect([200, 403]).toContain(res.status);
          const served = new Set([...idsOf(page1), ...idsOf(page2), ...direct.filter((_, i) => opens[i].status === 200)]);
          expect(served.size).toBeLessThanOrEqual(LIMIT);

          const { seenProjectIds, cardsServed } = await guest.row();
          expect(sorted(seenProjectIds)).toEqual(sorted([...served]));
          expect(new Set(seenProjectIds).size).toBe(seenProjectIds.length);
          expect(cardsServed).toBe(seenProjectIds.length);
        }),
      SLOW,
    );

    // Production allows one connection, where a query on the global client inside a transaction
    // callback waits on the connection that same transaction holds, which a larger pool cannot show.
    it(
      'works on a single database connection',
      () =>
        withAppOnConnections(1, async (copy) => {
          const guest = await newGuest();
          const get = (path: string) => copy.request(copy.app).get(path).set('Cookie', guest.cookie);
          const ids = feedOrder.slice(-8);
          const [count, page1, ...opens] = await Promise.all([
            copy.prisma.project.count(),
            get('/api/projects/feed?page=1'),
            ...ids.map((id) => get(`/api/projects/${id}`)),
          ]);
          expect(count).toBeGreaterThan(0);
          expect([page1, ...opens].map((res) => res.status)).toEqual(Array(ids.length + 1).fill(200));
          await expectBudgetUsed(guest, 18);
        }),
      SLOW,
    );
  });
});
