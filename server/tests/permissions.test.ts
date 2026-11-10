/**
 * I1 / FR16: the central permission table and the routes it gates. Ownership and membership are
 * covered by publish, maintain and hideDelete; here an unknown id reaching 404 proves the gate let
 * the request through. The database is remote, so one reset and one set of users serve the matrix.
 */
import type { Project, ProjectMedia, Milestone, ProgressEntry, User } from '@prisma/client';
import type { Router } from 'express';
import { beforeAll, describe, expect, it } from 'vitest';
import { ROLES, type Role } from '../src/domain.js';
import { HttpError } from '../src/lib/errors.js';
import { PERMISSIONS, type PermissionAction } from '../src/lib/permissions.js';
import { requirePermission } from '../src/middleware/auth.js';
import { adminRouter } from '../src/modules/admin/routes.js';
import { projectsRouter } from '../src/modules/projects/routes.js';
import { app, coverStorage, createProject, createUser, PASSWORD, PNG_BYTES, prisma, request, resetDb, signedInAgent, storage } from './helpers.js';

type Agent = ReturnType<typeof request.agent>;
type Method = 'get' | 'post' | 'patch' | 'delete';
/** auth: plain requireAuth. adminRole: only the router-wide requireRole('ADMIN'). selfOrEdit: requireSelfOrEdit. */
type Gate = 'auth' | 'adminRole' | 'selfOrEdit' | PermissionAction;

interface Call {
  method: Method;
  body?: object;
  /** Multipart field name; the request then carries one PNG. */
  file?: string;
}
interface ListedRoute extends Call {
  path: string;
  gate: Gate;
}

/** Every route on projectsRouter. Bodies are valid, so a 404 proves more than a 400 would. */
const PROJECT_ROUTES: ListedRoute[] = [
  { method: 'get', path: '/mine', gate: 'auth' },
  { method: 'get', path: '/invites', gate: 'auth' },
  { method: 'post', path: '/invites/:projectId/accept', gate: 'publish' },
  { method: 'post', path: '/invites/:projectId/decline', gate: 'auth' },
  { method: 'post', path: '/', gate: 'publish', body: { title: 'A new project' } },
  { method: 'get', path: '/:id/workspace', gate: 'auth' },
  { method: 'get', path: '/:id/preview', gate: 'auth' },
  { method: 'patch', path: '/:id', gate: 'edit', body: { title: 'A changed title' } },
  { method: 'post', path: '/:id/submit', gate: 'publish', body: { ownershipDeclared: true } },
  { method: 'post', path: '/:id/media', gate: 'edit', file: 'screenshots' },
  { method: 'delete', path: '/:id/media/:mediaId', gate: 'edit' },
  { method: 'post', path: '/:id/cover', gate: 'edit', file: 'cover' },
  { method: 'delete', path: '/:id/cover', gate: 'edit' },
  { method: 'post', path: '/:id/progress', gate: 'edit', body: { body: 'An update.' } },
  { method: 'delete', path: '/:id/progress/:entryId', gate: 'edit' },
  { method: 'post', path: '/:id/milestones', gate: 'edit', body: { title: 'A milestone' } },
  { method: 'patch', path: '/:id/milestones/:milestoneId', gate: 'edit', body: { status: 'DONE' } },
  { method: 'delete', path: '/:id/milestones/:milestoneId', gate: 'edit' },
  { method: 'post', path: '/:id/members', gate: 'edit', body: { email: 'someone@example.com' } },
  { method: 'delete', path: '/:id/members/:userId', gate: 'selfOrEdit' },
  { method: 'post', path: '/:id/hide', gate: 'auth' },
  { method: 'post', path: '/:id/unhide', gate: 'edit' },
  { method: 'delete', path: '/:id', gate: 'auth', body: { confirmTitle: 'A title' } },
];

/** Every route on adminRouter. */
const ADMIN_ROUTES: ListedRoute[] = [
  { method: 'get', path: '/ping', gate: 'adminRole' },
  { method: 'get', path: '/reviews', gate: 'review' },
  { method: 'post', path: '/reviews/projects/:id/approve', gate: 'review' },
  { method: 'post', path: '/reviews/projects/:id/request-changes', gate: 'review', body: { note: 'Please add a demo.' } },
  { method: 'post', path: '/reviews/revisions/:id/approve', gate: 'review' },
  { method: 'post', path: '/reviews/revisions/:id/reject', gate: 'review', body: { note: 'The demo link is broken.' } },
  { method: 'get', path: '/reports', gate: 'review' },
  { method: 'get', path: '/reports/:id', gate: 'review' },
  { method: 'post', path: '/reports/:id/dismiss', gate: 'review', body: { note: 'Nothing wrong was found.' } },
  { method: 'post', path: '/reports/:id/confirm', gate: 'review', body: { note: 'The report is correct.' } },
  { method: 'get', path: '/reports/:id/conversation', gate: 'review' },
  { method: 'get', path: '/offers', gate: 'review' },
  { method: 'post', path: '/offers/:id/approve', gate: 'review' },
  { method: 'post', path: '/offers/:id/reject', gate: 'review', body: { note: 'The terms are unclear.' } },
  { method: 'get', path: '/projects/removed', gate: 'removeProject' },
  { method: 'post', path: '/projects/:id/remove', gate: 'removeProject', body: { reason: 'Copied work.', reportId: 'no-such-report' } },
  { method: 'post', path: '/projects/:id/re-review', gate: 'removeProject', body: { reason: 'The owner fixed it.' } },
  { method: 'get', path: '/users', gate: 'controlAccess' },
  { method: 'get', path: '/users/:id/audit', gate: 'controlAccess' },
  { method: 'post', path: '/users/:id/status', gate: 'controlAccess', body: { status: 'RESTRICTED', reason: 'Spam comments.' } },
  { method: 'get', path: '/role-requests', gate: 'changeRole' },
  { method: 'post', path: '/role-requests/:id/approve', gate: 'changeRole', body: { reason: 'Verified employer.' } },
  { method: 'post', path: '/role-requests/:id/reject', gate: 'changeRole', body: { reason: 'Not enough detail.' } },
];

const projectUrl = (route: ListedRoute) => `/api/projects${route.path === '/' ? '' : route.path.replace(/:\w+/g, 'no-such-id')}`;
const adminUrl = (route: ListedRoute) => `/api/admin${route.path.replace(/:\w+/g, 'no-such-id')}`;

function send(agent: Agent, call: Call, url: string) {
  const req = agent[call.method](url);
  if (call.file) return req.attach(call.file, PNG_BYTES, { filename: 'a.png', contentType: 'image/png' });
  return call.body ? req.send(call.body) : req;
}

function expectError(res: { status: number; body: { error?: { code?: string } } }, status: number, code: string) {
  expect({ status: res.status, code: res.body.error?.code }).toEqual({ status, code });
}

const expectRestricted = (res: Parameters<typeof expectError>[0]) => expectError(res, 403, 'ACCOUNT_RESTRICTED');

/** The app's fallback for an unrouted path is also 404 NOT_FOUND, so the message is what proves the handler ran. */
function expectNotFound(res: { status: number; body: { error?: { code?: string; message?: string } } }, message: string) {
  expect({ status: res.status, code: res.body.error?.code, message: res.body.error?.message }).toEqual({ status: 404, code: 'NOT_FOUND', message });
}

const projectNotFound = (route: ListedRoute) => (route.path.startsWith('/invites/') ? 'Invitation not found.' : 'Project not found.');
const reviewNotFound = (route: ListedRoute) => {
  if (route.path.startsWith('/reports/')) return 'No open report with that id.';
  if (route.path.startsWith('/offers/')) return 'No offer waiting for review.';
  if (route.path === '/projects/:id/remove') return 'No live project with that id.';
  if (route.path === '/projects/:id/re-review') return 'No removed project with that id.';
  if (route.path.startsWith('/users/')) return 'User not found.';
  if (route.path.startsWith('/role-requests/')) return 'No role request waiting for review.';
  return route.path.startsWith('/reviews/projects/') ? 'No submission waiting for review.' : 'No revision waiting for review.';
};

const PERSONAS = {
  uploader: { role: 'UPLOADER', status: 'ACTIVE' },
  professional: { role: 'PROFESSIONAL', status: 'ACTIVE' },
  admin: { role: 'ADMIN', status: 'ACTIVE' },
  restrictedUploader: { role: 'UPLOADER', status: 'RESTRICTED' },
  restrictedProfessional: { role: 'PROFESSIONAL', status: 'RESTRICTED' },
  restrictedAdmin: { role: 'ADMIN', status: 'RESTRICTED' },
};
type Persona = keyof typeof PERSONAS;

const users = {} as Record<Persona, User>;
const agents = {} as Record<Persona, Agent>;
let guest: Agent;

beforeAll(async () => {
  await resetDb();
  guest = request.agent(app);
  for (const [name, attributes] of Object.entries(PERSONAS) as [Persona, (typeof PERSONAS)[Persona]][]) {
    users[name] = await createUser(attributes);
    agents[name] = await signedInAgent(users[name].email);
  }
});

// ---------------------------------------------------------------- The table and the middleware

describe('Permission table', () => {
  it('has exactly the agreed actions, roles and RESTRICTED flags', () => {
    const summary = Object.fromEntries(Object.entries(PERMISSIONS).map(([action, p]) => [action, [[...p.roles].sort().join(' '), p.allowedWhenRestricted]]));
    expect(summary).toEqual({
      publish: ['PROFESSIONAL UPLOADER', false],
      edit: ['ADMIN PROFESSIONAL UPLOADER', false],
      like: ['PROFESSIONAL', false],
      comment: ['PROFESSIONAL', false],
      contact: ['PROFESSIONAL UPLOADER', false],
      message: ['PROFESSIONAL UPLOADER', false],
      postOffer: ['PROFESSIONAL', false],
      report: ['PROFESSIONAL UPLOADER', true],
      review: ['ADMIN', false],
      removeProject: ['ADMIN', false],
      changeRole: ['ADMIN', false],
      controlAccess: ['ADMIN', false],
    });
  });
});

type Handler = (req: unknown, res: unknown, next: () => void) => unknown;
interface FakeUser {
  role: Role;
  status: string;
}

/**
 * Runs one middleware against a fake request and reports what it decided. A fake user has no id,
 * so to requireSelfOrEdit it is always removing someone else; leaving is proved over HTTP below.
 */
function outcome(handle: Handler, user: FakeUser | undefined): string {
  let passed = false;
  try {
    handle({ user, params: { userId: 'someone-else' } }, {}, () => {
      passed = true;
    });
  } catch (err) {
    if (err instanceof HttpError) return `${err.status} ${err.code}`;
    throw err;
  }
  return passed ? 'pass' : 'no decision';
}

/** What a gate must do for this account, in the order the middleware checks it. */
function expectedOutcome(gate: Gate, user: FakeUser | undefined): string {
  if (gate === 'selfOrEdit') return expectedOutcome('edit', user);
  if (!user) return '401 UNAUTHENTICATED';
  if (gate === 'auth') return 'pass';
  if (gate === 'adminRole') return user.role === 'ADMIN' ? 'pass' : '403 FORBIDDEN';
  const permission = PERMISSIONS[gate];
  if (!(permission.roles as readonly Role[]).includes(user.role)) return '403 FORBIDDEN';
  return user.status === 'RESTRICTED' && !permission.allowedWhenRestricted ? '403 ACCOUNT_RESTRICTED' : 'pass';
}

const PROBES: (FakeUser | undefined)[] = [undefined, ...ROLES.flatMap((role) => ['ACTIVE', 'RESTRICTED'].map((status) => ({ role, status })))];

describe('requirePermission', () => {
  it.each(Object.keys(PERMISSIONS) as PermissionAction[])('decides %s for every role and status', (action) => {
    const handle = requirePermission(action) as unknown as Handler;
    for (const user of PROBES) {
      expect({ user, outcome: outcome(handle, user) }).toEqual({ user, outcome: expectedOutcome(action, user) });
    }
  });

  it('checks the role before the RESTRICTED status', () => {
    const handle = requirePermission('publish') as unknown as Handler;
    expect(outcome(handle, { role: 'ADMIN', status: 'RESTRICTED' })).toBe('403 FORBIDDEN');
  });

  it('lets a RESTRICTED account do what the table allows it', () => {
    const handle = requirePermission('report') as unknown as Handler;
    expect(outcome(handle, { role: 'UPLOADER', status: 'RESTRICTED' })).toBe('pass');
  });

  it('uses the shared messages and tells a RESTRICTED account what to do', async () => {
    const res = await guest.post('/api/projects').send({ title: 'A new project' });
    expect(res.body.error.message).toBe('Please sign in to continue.');

    const forbidden = await agents.admin.post('/api/projects').send({ title: 'A new project' });
    expect(forbidden.body.error.message).toBe('You do not have permission to perform this action.');

    const restricted = await agents.restrictedUploader.post('/api/projects').send({ title: 'A new project' });
    expect(restricted.body.error.message).toMatch(/restricted/i);
    expect(restricted.body.error.message).toMatch(/contact an administrator/i);
  });
});

// ---------------------------------------------------------------- Route inventory guard

interface RouterLayer {
  handle: Handler;
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: Handler }[] };
}

const layersOf = (router: Router) => (router as unknown as { stack: RouterLayer[] }).stack;
const routeKey = (method: string, path: string) => `${method.toUpperCase()} ${path}`;

function liveRoutes(router: Router): string[] {
  return layersOf(router).flatMap((layer) => (layer.route ? Object.keys(layer.route.methods).map((m) => routeKey(m, layer.route!.path)) : []));
}

function firstHandler(router: Router, listed: ListedRoute): Handler {
  const layer = layersOf(router).find((l) => l.route?.path === listed.path && l.route.methods[listed.method]);
  return layer!.route!.stack[0].handle;
}

function gateName(gate: Gate): string {
  if (gate === 'auth') return 'requireAuth';
  return gate === 'selfOrEdit' ? 'requireSelfOrEdit' : `requirePermission(${gate})`;
}

describe('Route inventory', () => {
  const listed = (routes: ListedRoute[]) => routes.map((r) => routeKey(r.method, r.path)).sort();

  it('lists every project route, so a new route has to choose a gate', () => {
    expect(liveRoutes(projectsRouter).sort()).toEqual(listed(PROJECT_ROUTES));
  });

  // A mounted sub-router or router-wide middleware has no route to list, and would run ahead of the gates.
  it('has only route layers on projectsRouter, so nothing escapes the list', () => {
    expect(layersOf(projectsRouter).every((layer) => layer.route)).toBe(true);
  });

  it('lists every admin route, so a new route has to choose a gate', () => {
    expect(liveRoutes(adminRouter).sort()).toEqual(listed(ADMIN_ROUTES));
  });

  // The first handler in the chain is what is probed, so these also prove the gate runs before
  // validateBody and the upload handlers. The name pins the action, as some share a table entry.
  it.each(PROJECT_ROUTES)('$method $path starts with its $gate gate', (route) => {
    const handle = firstHandler(projectsRouter, route);
    expect(handle.name).toBe(gateName(route.gate));
    for (const user of PROBES) {
      expect({ user, outcome: outcome(handle, user) }).toEqual({ user, outcome: expectedOutcome(route.gate, user) });
    }
  });

  it.each(ADMIN_ROUTES.filter((r) => r.gate !== 'adminRole'))('admin $method $path starts with its $gate gate', (route) => {
    const handle = firstHandler(adminRouter, route);
    expect(handle.name).toBe(gateName(route.gate));
    for (const user of PROBES) {
      expect({ user, outcome: outcome(handle, user) }).toEqual({ user, outcome: expectedOutcome(route.gate, user) });
    }
  });

  it('puts requireRole(ADMIN) in front of every admin route', () => {
    const [first, ...rest] = layersOf(adminRouter);
    expect(first.route).toBeUndefined();
    expect(rest.every((layer) => layer.route)).toBe(true);
    for (const user of PROBES) {
      expect({ user, outcome: outcome(first.handle, user) }).toEqual({ user, outcome: expectedOutcome('adminRole', user) });
    }
  });
});

// ---------------------------------------------------------------- Gated project routes

const GATED_ROUTES = PROJECT_ROUTES.filter((r) => r.gate === 'publish' || r.gate === 'edit' || r.gate === 'selfOrEdit');
const ID_ROUTES = GATED_ROUTES.filter((r) => r.path !== '/');

describe('Gated project routes', () => {
  it.each(GATED_ROUTES)('$method $path: Guest gets 401', async (route) => {
    expectError(await send(guest, route, projectUrl(route)), 401, 'UNAUTHENTICATED');
  });

  it.each(GATED_ROUTES)('$method $path: RESTRICTED Uploader gets 403 ACCOUNT_RESTRICTED', async (route) => {
    expectRestricted(await send(agents.restrictedUploader, route, projectUrl(route)));
  });

  it.each(GATED_ROUTES)('$method $path: RESTRICTED Professional gets 403 ACCOUNT_RESTRICTED', async (route) => {
    expectRestricted(await send(agents.restrictedProfessional, route, projectUrl(route)));
  });

  it.each(GATED_ROUTES.filter((r) => r.gate === 'publish'))('$method $path: Admin gets 403 FORBIDDEN', async (route) => {
    expectError(await send(agents.admin, route, projectUrl(route)), 403, 'FORBIDDEN');
  });

  it.each(ID_ROUTES)('$method $path: active Uploader passes the gate and gets 404', async (route) => {
    expectNotFound(await send(agents.uploader, route, projectUrl(route)), projectNotFound(route));
  });

  it.each(ID_ROUTES)('$method $path: active Professional passes the gate and gets 404', async (route) => {
    expectNotFound(await send(agents.professional, route, projectUrl(route)), projectNotFound(route));
  });

  it.each(ID_ROUTES.filter((r) => r.gate !== 'publish'))('$method $path: active Admin passes the gate and gets 404', async (route) => {
    expectNotFound(await send(agents.admin, route, projectUrl(route)), projectNotFound(route));
  });

  it.each(['uploader', 'professional'] as const)('post /: active %s creates a project', async (persona) => {
    const route = PROJECT_ROUTES.find((r) => r.path === '/')!;
    expect((await send(agents[persona], route, projectUrl(route))).status).toBe(201);
  });
});

describe('Project routes that stay on plain requireAuth', () => {
  const OPEN_ROUTES = PROJECT_ROUTES.filter((r) => r.gate === 'auth' && r.method !== 'get');

  it('are exactly hide, delete and decline', () => {
    expect(OPEN_ROUTES.map((r) => r.path).sort()).toEqual(['/:id', '/:id/hide', '/invites/:projectId/decline']);
  });

  it.each(OPEN_ROUTES)('$method $path: Guest gets 401', async (route) => {
    expectError(await send(guest, route, projectUrl(route)), 401, 'UNAUTHENTICATED');
  });

  it.each(OPEN_ROUTES)('$method $path: every signed-in account, RESTRICTED or not, reaches the ownership check', async (route) => {
    const personas: Persona[] = ['uploader', 'professional', 'admin', 'restrictedUploader', 'restrictedProfessional'];
    for (const persona of personas) {
      expectNotFound(await send(agents[persona], route, projectUrl(route)), projectNotFound(route));
    }
  });
});

describe('A denied request is refused before its body is processed', () => {
  const INVALID: (Call & { path: string; body: object })[] = [
    { method: 'post', path: '/api/projects', body: {} },
    { method: 'patch', path: '/api/projects/no-such-id', body: { demoUrl: 'http://not-https.example.com' } },
    { method: 'post', path: '/api/projects/no-such-id/submit', body: {} },
    { method: 'post', path: '/api/projects/no-such-id/progress', body: {} },
    { method: 'post', path: '/api/projects/no-such-id/milestones', body: {} },
    { method: 'patch', path: '/api/projects/no-such-id/milestones/no-such-id', body: { status: 'NOT_A_STATUS' } },
    { method: 'post', path: '/api/projects/no-such-id/members', body: { email: 'not-an-email' } },
  ];

  it.each(INVALID)('$method $path: an invalid body is 403 when RESTRICTED, and 400 otherwise', async (call) => {
    expectRestricted(await send(agents.restrictedUploader, call, call.path));
    expectRestricted(await send(agents.restrictedProfessional, call, call.path));
    expectError(await send(agents.professional, call, call.path), 400, 'VALIDATION_ERROR');
  });

  describe('uploads', () => {
    let own: Project;

    beforeAll(async () => {
      own = await createProject(users.restrictedUploader.id, { status: 'DRAFT', publishedAt: null });
    });

    it.each([
      ['media', 'screenshots'],
      ['cover', 'cover'],
    ])('stores nothing for a denied %s upload on the user’s own draft', async (segment, field) => {
      const objects = storage.objects.size + coverStorage.objects.size;
      const res = await agents.restrictedUploader
        .post(`/api/projects/${own.id}/${segment}`)
        .attach(field, PNG_BYTES, { filename: 'a.png', contentType: 'image/png' });

      expectRestricted(res);
      expect(storage.objects.size + coverStorage.objects.size).toBe(objects);
      expect(await prisma.projectMedia.count({ where: { projectId: own.id } })).toBe(0);
      expect((await prisma.project.findUniqueOrThrow({ where: { id: own.id } })).thumbnailUrl).toBeNull();
    });

    it.each([
      ['media', 'screenshots'],
      ['cover', 'cover'],
    ])('refuses a %s upload before multer rejects the file type', async (segment, field) => {
      const pdf = { filename: 'a.pdf', contentType: 'application/pdf' };
      const url = `/api/projects/${own.id}/${segment}`;
      expectRestricted(await agents.restrictedUploader.post(url).attach(field, Buffer.from('%PDF-1.4'), pdf));
      expectError(await agents.professional.post(`/api/projects/no-such-id/${segment}`).attach(field, Buffer.from('%PDF-1.4'), pdf), 400, 'INVALID_FILE');
    });
  });
});

// ---------------------------------------------------------------- RESTRICTED owner

describe('A RESTRICTED owner on their own project', () => {
  /** A real account not yet on the team, so an ungated invite would insert a member row. */
  const INVITEE_EMAIL = 'invitee@example.com';

  let owner: User;
  let agent: Agent;
  let teammate: User;
  let draft: Project;
  let hidden: Project;
  let entry: ProgressEntry;
  let milestone: Milestone;
  let media: ProjectMedia;
  let before: unknown;

  /** Every row and stored file a denied request could touch. updatedAt catches silent writes. */
  async function state() {
    const projects = await prisma.project.findMany({
      where: { id: { in: [draft.id, hidden.id] } },
      include: { members: true, progress: true, milestones: true, media: true, revisions: true },
      orderBy: { id: 'asc' },
    });
    return { projects, objects: [...storage.objects.keys()].sort(), covers: [...coverStorage.objects.keys()].sort() };
  }

  beforeAll(async () => {
    owner = await createUser({ status: 'RESTRICTED' });
    agent = await signedInAgent(owner.email);
    teammate = await createUser({ role: 'PROFESSIONAL' });
    await createUser({ email: INVITEE_EMAIL });

    draft =await createProject(owner.id, { status: 'DRAFT', publishedAt: null });
    hidden = await createProject(owner.id, { status: 'HIDDEN', hiddenAt: new Date() });
    await prisma.projectMember.create({ data: { projectId: draft.id, userId: teammate.id, status: 'ACCEPTED', invitedById: owner.id } });
    entry = await prisma.progressEntry.create({ data: { projectId: draft.id, authorId: owner.id, body: 'First update.' } });
    milestone = await prisma.milestone.create({ data: { projectId: draft.id, title: 'First milestone' } });
    media = await prisma.projectMedia.create({
      data: { projectId: draft.id, storagePath: `projects/${draft.id}/a.png`, mimeType: 'image/png', sizeBytes: PNG_BYTES.length },
    });
    await storage.upload(media.storagePath, PNG_BYTES, 'image/png');
    before = await state();
  });

  // Each of these would succeed for an active owner, so a 403 here is the gate and nothing else.
  const DENIED: (Call & { name: string; url: () => string })[] = [
    { name: 'edit', method: 'patch', url: () => `/api/projects/${draft.id}`, body: { title: 'A changed title' } },
    { name: 'submit', method: 'post', url: () => `/api/projects/${draft.id}/submit`, body: { ownershipDeclared: true } },
    { name: 'unhide', method: 'post', url: () => `/api/projects/${hidden.id}/unhide` },
    { name: 'add progress', method: 'post', url: () => `/api/projects/${draft.id}/progress`, body: { body: 'Another update.' } },
    { name: 'delete progress', method: 'delete', url: () => `/api/projects/${draft.id}/progress/${entry.id}` },
    { name: 'add milestone', method: 'post', url: () => `/api/projects/${draft.id}/milestones`, body: { title: 'Another milestone' } },
    { name: 'update milestone', method: 'patch', url: () => `/api/projects/${draft.id}/milestones/${milestone.id}`, body: { status: 'DONE' } },
    { name: 'delete milestone', method: 'delete', url: () => `/api/projects/${draft.id}/milestones/${milestone.id}` },
    { name: 'add media', method: 'post', url: () => `/api/projects/${draft.id}/media`, file: 'screenshots' },
    { name: 'delete media', method: 'delete', url: () => `/api/projects/${draft.id}/media/${media.id}` },
    { name: 'set cover', method: 'post', url: () => `/api/projects/${draft.id}/cover`, file: 'cover' },
    { name: 'remove cover', method: 'delete', url: () => `/api/projects/${draft.id}/cover` },
    { name: 'invite member', method: 'post', url: () => `/api/projects/${draft.id}/members`, body: { email: INVITEE_EMAIL } },
    { name: 'remove member', method: 'delete', url: () => `/api/projects/${draft.id}/members/${teammate.id}` },
  ];

  it.each(DENIED)('cannot $name, and nothing changes', async (call) => {
    expectRestricted(await send(agent, call, call.url()));
    expect(await state()).toEqual(before);
  });

  it('can still hide a published project', async () => {
    const project = await createProject(owner.id);
    expect((await agent.post(`/api/projects/${project.id}/hide`)).status).toBe(200);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).status).toBe('HIDDEN');
  });

  it('can still delete a project', async () => {
    const project = await createProject(owner.id);
    expect((await agent.delete(`/api/projects/${project.id}`).send({ confirmTitle: project.title })).status).toBe(200);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).status).toBe('DELETED');
  });

  it('can still read', async () => {
    const mine = await agent.get('/api/projects/mine');
    expect(mine.status).toBe(200);
    expect(mine.body.items.map((p: { id: string }) => p.id)).toContain(draft.id);

    expect((await agent.get('/api/projects/invites')).status).toBe(200);
    expect((await agent.get(`/api/projects/${draft.id}/workspace`)).status).toBe(200);
    expect((await agent.get(`/api/projects/${draft.id}/preview`)).status).toBe(200);
    expect((await agent.get('/api/projects/search?q=solar')).status).toBe(200);

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ id: owner.id, status: 'RESTRICTED' });
  });

  it('can still sign in', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: owner.email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe('RESTRICTED');
  });

  async function inviteToSomeoneElsesProject() {
    const project = await createProject(teammate.id);
    const member = await prisma.projectMember.create({ data: { projectId: project.id, userId: owner.id, invitedById: teammate.id } });
    return { project, member };
  }

  it('can decline an invite', async () => {
    const { project, member } = await inviteToSomeoneElsesProject();
    expect((await agent.post(`/api/projects/invites/${project.id}/decline`)).status).toBe(200);
    expect((await prisma.projectMember.findUniqueOrThrow({ where: { id: member.id } })).status).toBe('DECLINED');
  });

  it('cannot accept an invite, which stays open', async () => {
    const { project, member } = await inviteToSomeoneElsesProject();
    expectRestricted(await agent.post(`/api/projects/invites/${project.id}/accept`));
    expect((await prisma.projectMember.findUniqueOrThrow({ where: { id: member.id } })).status).toBe('INVITED');

    const invites = await agent.get('/api/projects/invites');
    expect(invites.body.items.map((i: { projectId: string }) => i.projectId)).toContain(project.id);
  });
});

// ---------------------------------------------------------------- Leaving a team

describe('Removing a team member', () => {
  async function team(statuses: { owner?: string; editor?: string } = {}) {
    const owner = await createUser({ status: statuses.owner });
    const editor = await createUser({ status: statuses.editor });
    const colleague = await createUser();
    const project = await createProject(owner.id);
    for (const user of [editor, colleague]) {
      await prisma.projectMember.create({ data: { projectId: project.id, userId: user.id, status: 'ACCEPTED', invitedById: owner.id } });
    }
    return { owner, editor, colleague, project };
  }

  const isMember = async (projectId: string, userId: string) => (await prisma.projectMember.count({ where: { projectId, userId } })) === 1;

  it('a RESTRICTED editor can leave', async () => {
    const { editor, colleague, project } = await team({ editor: 'RESTRICTED' });
    const agent = await signedInAgent(editor.email);

    expect((await agent.delete(`/api/projects/${project.id}/members/${editor.id}`)).status).toBe(204);

    expect(await isMember(project.id, editor.id)).toBe(false);
    expect(await isMember(project.id, colleague.id)).toBe(true);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'MEMBER_REMOVED', targetId: project.id } });
    expect(entry).toMatchObject({ actorId: editor.id, reason: editor.id });
  });

  it('a RESTRICTED owner naming themselves gets 404, and the team stays', async () => {
    const { owner, project } = await team({ owner: 'RESTRICTED' });
    const agent = await signedInAgent(owner.email);

    expectNotFound(await agent.delete(`/api/projects/${project.id}/members/${owner.id}`), 'Team member not found.');
    expect(await prisma.projectMember.count({ where: { projectId: project.id } })).toBe(2);
  });

  it('a RESTRICTED invitee naming themselves gets 404, and the invite stays', async () => {
    const { owner, project } = await team();
    const invitee = await createUser({ status: 'RESTRICTED' });
    const member = await prisma.projectMember.create({ data: { projectId: project.id, userId: invitee.id, invitedById: owner.id } });
    const agent = await signedInAgent(invitee.email);

    expectNotFound(await agent.delete(`/api/projects/${project.id}/members/${invitee.id}`), 'Project not found.');
    expect((await prisma.projectMember.findUniqueOrThrow({ where: { id: member.id } })).status).toBe('INVITED');
  });

  it('a RESTRICTED owner cannot remove another member', async () => {
    const { owner, editor, project } = await team({ owner: 'RESTRICTED' });
    const agent = await signedInAgent(owner.email);

    expectRestricted(await agent.delete(`/api/projects/${project.id}/members/${editor.id}`));
    expect(await isMember(project.id, editor.id)).toBe(true);
  });

  it('a RESTRICTED editor cannot remove someone else', async () => {
    const { editor, colleague, project } = await team({ editor: 'RESTRICTED' });
    const agent = await signedInAgent(editor.email);

    expectRestricted(await agent.delete(`/api/projects/${project.id}/members/${colleague.id}`));
    expect(await isMember(project.id, colleague.id)).toBe(true);
  });

  it('a Guest gets 401, whoever they name', async () => {
    const { editor, project } = await team();

    expectError(await guest.delete(`/api/projects/${project.id}/members/${editor.id}`), 401, 'UNAUTHENTICATED');
    expect(await isMember(project.id, editor.id)).toBe(true);
  });

  it.each(['ACTIVE', 'RESTRICTED'])('a non-member who is %s and removes themselves gets 404, not 204', async (status) => {
    const { project } = await team();
    const outsider = await createUser({ status });
    const agent = await signedInAgent(outsider.email);

    expectNotFound(await agent.delete(`/api/projects/${project.id}/members/${outsider.id}`), 'Project not found.');
  });

  it.each(['SUSPENDED', 'BANNED'])('a %s editor is signed out, so cannot leave', async (status) => {
    const { editor, project } = await team();
    const agent = await signedInAgent(editor.email);
    await prisma.user.update({ where: { id: editor.id }, data: { status } });

    expectError(await agent.delete(`/api/projects/${project.id}/members/${editor.id}`), 401, 'UNAUTHENTICATED');
    expect(await isMember(project.id, editor.id)).toBe(true);
  });
});

// ---------------------------------------------------------------- Admin review queue

describe('Admin review routes', () => {
  // Every Admin decision route, whichever Admin permission gates it.
  const REVIEW_ROUTES = ADMIN_ROUTES.filter((r) => r.gate !== 'adminRole');

  it.each(REVIEW_ROUTES)('$method $path: Guest gets 401', async (route) => {
    expectError(await send(guest, route, adminUrl(route)), 401, 'UNAUTHENTICATED');
  });

  it.each(REVIEW_ROUTES)('$method $path: Uploader gets 403', async (route) => {
    expectError(await send(agents.uploader, route, adminUrl(route)), 403, 'FORBIDDEN');
  });

  it.each(REVIEW_ROUTES)('$method $path: Professional gets 403', async (route) => {
    expectError(await send(agents.professional, route, adminUrl(route)), 403, 'FORBIDDEN');
  });

  it.each(REVIEW_ROUTES)('$method $path: RESTRICTED Admin gets 403 ACCOUNT_RESTRICTED', async (route) => {
    expectRestricted(await send(agents.restrictedAdmin, route, adminUrl(route)));
  });

  it('GET /reviews: active Admin gets the queue', async () => {
    const res = await agents.admin.get('/api/admin/reviews');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('submissions');
  });

  it.each(REVIEW_ROUTES.filter((r) => r.method === 'post'))('$method $path: active Admin passes the gate and gets 404', async (route) => {
    expectNotFound(await send(agents.admin, route, adminUrl(route)), reviewNotFound(route));
  });

  it.each(REVIEW_ROUTES.filter((r) => r.body))('$method $path: an invalid note is 403 when RESTRICTED, and 400 for an active Admin', async (route) => {
    expectRestricted(await agents.restrictedAdmin.post(adminUrl(route)).send({}));
    expectError(await agents.admin.post(adminUrl(route)).send({}), 400, 'VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------- Changes of status on a live session

describe('Status changes on a live session', () => {
  it.each(['SUSPENDED', 'BANNED'])('%s ends every session on the next request and refuses sign-in', async (status) => {
    const user = await createUser({ role: 'PROFESSIONAL' });
    const agent = await signedInAgent(user.email);
    const otherDevice = await signedInAgent(user.email);
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(2);

    await prisma.user.update({ where: { id: user.id }, data: { status } });

    expectError(await agent.post('/api/projects').send({ title: 'A new project' }), 401, 'UNAUTHENTICATED');
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    expectError(await otherDevice.get('/api/auth/me'), 401, 'UNAUTHENTICATED');

    const login = await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    expectError(login, 403, 'ACCOUNT_DISABLED');
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it('applies RESTRICTED and its removal immediately, on the same session', async () => {
    const user = await createUser();
    const agent = await signedInAgent(user.email);
    const create = () => agent.post('/api/projects').send({ title: 'A new project' });
    expect((await create()).status).toBe(201);

    await prisma.user.update({ where: { id: user.id }, data: { status: 'RESTRICTED' } });
    expectRestricted(await create());
    expect(await prisma.project.count({ where: { ownerId: user.id } })).toBe(1);

    await prisma.user.update({ where: { id: user.id }, data: { status: 'ACTIVE' } });
    expect((await create()).status).toBe(201);
    expect(await prisma.project.count({ where: { ownerId: user.id } })).toBe(2);
  });
});
