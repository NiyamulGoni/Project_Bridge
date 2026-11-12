/**
 * Step 5 / FR13: reports, the Admin report queue, and review decisions that commit whole or not at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decrypt, encrypt } from '../src/lib/crypto.js';
import { app, COMPLETE_PROJECT, createProject, createUser, prisma, request, resetDb, signedInAgent } from './helpers.js';
import { expectCleanResponse } from './responseScan.js';

const REASON = 'This project copies our semester project word for word.';

// Lets a test make the last write of a decision fail, after its status change and audit row.
const failure = vi.hoisted(() => ({ notify: false }));
vi.mock('../src/modules/notifications/service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/notifications/service.js')>();
  return {
    ...actual,
    notify: (...args: Parameters<typeof actual.notify>) => {
      if (failure.notify) throw new Error('Forced notification failure');
      return actual.notify(...args);
    },
  };
});

beforeEach(resetDb);
afterEach(() => {
  failure.notify = false;
  vi.restoreAllMocks();
});

const agentFor = async (role: string, status = 'ACTIVE') => {
  const user = await createUser({ role, status });
  return { user, agent: await signedInAgent(user.email) };
};
const report = (targetType: string, targetId: string, reason = REASON) => ({ targetType, targetId, reason });
/** Approved offers on a published project, which a Professional can see and so can report. */
async function offers(count: number) {
  const author = await createUser({ role: 'PROFESSIONAL' });
  const project = await createProject(author.id);
  const terms = { projectId: project.id, authorId: author.id, skills: ['qa'], type: 'FIXED', compensation: '100', currency: 'BDT', applicationRoute: 'Write to me through the platform.', reviewStatus: 'APPROVED' };
  return Promise.all(Array.from({ length: count }, (_, i) => prisma.paidOffer.create({ data: { ...terms, title: `Offer ${i}` } })));
}

describe('Filing a report', () => {
  it('stores the reason encrypted, and changes nothing about the target', async () => {
    const { user: owner } = await agentFor('UPLOADER');
    const project = await createProject(owner.id);
    const { user, agent } = await agentFor('UPLOADER');

    const res = await agent.post('/api/reports').send(report('PROJECT', project.id));
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(['id', 'status']);
    expectCleanResponse(res.body, { values: [user.email, REASON] });

    const stored = await prisma.report.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.reason).not.toContain(REASON);
    expect(decrypt(stored.reason, 'Report.reason')).toBe(REASON);
    expect(await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).toEqual(project);
  });

  it('accepts every target type', async () => {
    const { user: other } = await agentFor('UPLOADER');
    const project = await createProject(other.id);
    const { user, agent } = await agentFor('PROFESSIONAL');
    const comment = await prisma.comment.create({ data: { projectId: project.id, authorId: other.id, body: 'Nice work.' } });
    const conversation = await prisma.conversation.create({ data: { participants: { create: [{ userId: user.id }, { userId: other.id }] } } });
    const [offer] = await offers(1);
    const targets = [['PROJECT', project.id], ['USER', other.id], ['COMMENT', comment.id], ['OFFER', offer.id], ['CONVERSATION', conversation.id]];
    for (const [type, id] of targets) expect((await agent.post('/api/reports').send(report(type, id))).status).toBe(201);
  });

  it('is denied to Guests and Admins, and allowed to a RESTRICTED account', async () => {
    const { user: owner } = await agentFor('UPLOADER');
    const project = await createProject(owner.id);
    const body = report('PROJECT', project.id);
    expect((await request(app).post('/api/reports').send(body)).status).toBe(401);
    expect((await (await agentFor('ADMIN')).agent.post('/api/reports').send(body)).status).toBe(403);
    expect((await (await agentFor('UPLOADER', 'RESTRICTED')).agent.post('/api/reports').send(body)).status).toBe(201);
  });

  it('refuses invalid input, unpublished projects, unknown users and yourself', async () => {
    const { user: owner } = await agentFor('UPLOADER');
    const draft = await createProject(owner.id, { status: 'DRAFT' });
    const { user, agent } = await agentFor('UPLOADER');
    expect((await agent.post('/api/reports').send(report('PROJECT', 'x', 'short'))).status).toBe(400);
    expect((await agent.post('/api/reports').send(report('SOMETHING', 'x'))).status).toBe(400);
    expect((await agent.post('/api/reports').send(report('PROJECT', draft.id))).status).toBe(404);
    expect((await agent.post('/api/reports').send(report('USER', 'no-such-user'))).status).toBe(404);
    expect((await agent.post('/api/reports').send(report('USER', user.id))).status).toBe(400);
    expect((await agent.post('/api/reports').send(report('COMMENT', 'no-such-comment'))).status).toBe(404);
    // Offers are shown to Professionals only, so an Uploader cannot report one, real or not.
    expect((await agent.post('/api/reports').send(report('OFFER', (await offers(1))[0].id))).status).toBe(404);
    const theirs = await prisma.conversation.create({ data: { participants: { create: [{ userId: owner.id }] } } });
    expect((await agent.post('/api/reports').send(report('CONVERSATION', theirs.id))).status).toBe(404);
    expect(await prisma.report.count()).toBe(0);
  });

  it('refuses a second open report on the same target', async () => {
    const { user: owner } = await agentFor('UPLOADER');
    const project = await createProject(owner.id);
    const { agent } = await agentFor('UPLOADER');
    await agent.post('/api/reports').send(report('PROJECT', project.id));
    const again = await agent.post('/api/reports').send(report('PROJECT', project.id));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_REPORTED');
  });

  it('is rate limited per user', async () => {
    const { agent } = await agentFor('PROFESSIONAL');
    const targets = await offers(11);
    for (let i = 0; i < 10; i++) expect((await agent.post('/api/reports').send(report('OFFER', targets[i].id))).status).toBe(201);
    const blocked = await agent.post('/api/reports').send(report('OFFER', targets[10].id));
    expect(blocked.status).toBe(429);
    expect((await (await agentFor('PROFESSIONAL')).agent.post('/api/reports').send(report('OFFER', targets[10].id))).status).toBe(201);
  });
});

describe('Admin report queue', () => {
  async function filed() {
    const { user: reporter, agent: reporterAgent } = await agentFor('UPLOADER');
    const { user: owner } = await agentFor('UPLOADER');
    const project = await createProject(owner.id);
    const { body } = await reporterAgent.post('/api/reports').send(report('PROJECT', project.id));
    const { user: admin, agent: adminAgent } = await agentFor('ADMIN');
    return { reporter, reporterAgent, project, id: body.id as string, admin, adminAgent };
  }

  it.each([
    ['get', '/reports'],
    ['get', '/reports/x'],
    ['post', '/reports/x/dismiss'],
  ] as const)('%s %s is denied to non-Admins', async (method, path) => {
    const url = `/api/admin${path}`;
    const note = { note: 'Nothing wrong here.' };
    expect((await request(app)[method](url).send(note)).status).toBe(401);
    expect((await (await agentFor('UPLOADER')).agent[method](url).send(note)).status).toBe(403);
    expect((await (await agentFor('PROFESSIONAL')).agent[method](url).send(note)).status).toBe(403);
    expect((await (await agentFor('ADMIN', 'RESTRICTED')).agent[method](url).send(note)).status).toBe(403);
  });

  it('lists and opens reports with the reason decrypted and no email', async () => {
    const { reporter, id, adminAgent } = await filed();
    const list = await adminAgent.get('/api/admin/reports');
    expect(list.body.items.map((r: { id: string }) => r.id)).toEqual([id]);
    expect(list.body.items[0].reason).toBe(REASON);
    expect(list.body.items[0].reporter).toEqual({ name: reporter.name });
    expectCleanResponse(list.body, { values: [reporter.email] });

    const open = await adminAgent.get(`/api/admin/reports/${id}`);
    expect(open.body.report.reason).toBe(REASON);
    expect((await adminAgent.get('/api/admin/reports/no-such-id')).status).toBe(404);
    expect((await adminAgent.get('/api/admin/reports?status=NOPE')).status).toBe(400);
    expect((await adminAgent.get('/api/admin/reports?status=DISMISSED')).body.items).toHaveLength(0);
  });

  it('still lists a report whose reason cannot be decrypted', async () => {
    const { id, adminAgent } = await filed();
    await prisma.report.update({ where: { id }, data: { reason: encrypt(REASON, 'Another.column') } });
    const list = await adminAgent.get('/api/admin/reports');
    expect(list.status).toBe(200);
    expect(list.body.items[0].reason).toBeNull();
  });

  it('dismisses a report with an audit row and a notice, and leaves the target alone', async () => {
    const { reporter, project, id, admin, adminAgent } = await filed();
    const res = await adminAgent.post(`/api/admin/reports/${id}/dismiss`).send({ note: 'This is original work.' });
    expect(res.status).toBe(200);

    const stored = await prisma.report.findUniqueOrThrow({ where: { id } });
    expect(stored).toMatchObject({ status: 'DISMISSED', decisionNote: 'This is original work.', reviewedById: admin.id });
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: 'REPORT_DISMISSED', targetId: id } })).toMatchObject({ actorId: admin.id, oldValue: 'OPEN', newValue: 'DISMISSED' });
    expect(await prisma.notification.count({ where: { recipientId: reporter.id, eventType: 'REPORT_CLOSED' } })).toBe(1);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).status).toBe('PUBLISHED');
    expect((await adminAgent.post(`/api/admin/reports/${id}/dismiss`).send({ note: 'Again please.' })).status).toBe(404);
  });

  it('a forced failure leaves the report open, with no audit row', async () => {
    const { id, adminAgent } = await filed();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    failure.notify = true;
    expect((await adminAgent.post(`/api/admin/reports/${id}/dismiss`).send({ note: 'This is original work.' })).status).toBe(500);
    expect((await prisma.report.findUniqueOrThrow({ where: { id } })).status).toBe('OPEN');
    expect(await prisma.auditLog.count({ where: { action: 'REPORT_DISMISSED' } })).toBe(0);
  });
});

describe('Review decisions commit whole', () => {
  async function setup() {
    const { user: owner, agent: ownerAgent } = await agentFor('UPLOADER');
    const { user: admin, agent: adminAgent } = await agentFor('ADMIN');
    const submitted = await createProject(owner.id, { status: 'SUBMITTED', publishedAt: null });
    const live = await createProject(owner.id);
    const { stage: _stage, ...content } = COMPLETE_PROJECT;
    const revision = await prisma.projectRevision.create({
      data: { ...content, title: 'Proposed title', projectId: live.id, authorId: owner.id },
    });
    return { owner, ownerAgent, admin, adminAgent, submitted, live, revision };
  }
  type Setup = Awaited<ReturnType<typeof setup>>;

  const DECISIONS: Array<{ name: string; url: (s: Setup) => string; body?: object; action: string; event: string; oldValue: string; newValue: string }> = [
    { name: 'approve project', url: (s) => `/api/admin/reviews/projects/${s.submitted.id}/approve`, action: 'PROJECT_APPROVED', event: 'PROJECT_APPROVED', oldValue: 'SUBMITTED', newValue: 'PUBLISHED' },
    { name: 'request changes', url: (s) => `/api/admin/reviews/projects/${s.submitted.id}/request-changes`, body: { note: 'Please add a demo.' }, action: 'PROJECT_CHANGES_REQUESTED', event: 'PROJECT_CHANGES_REQUESTED', oldValue: 'SUBMITTED', newValue: 'CHANGES_REQUESTED' },
    { name: 'approve revision', url: (s) => `/api/admin/reviews/revisions/${s.revision.id}/approve`, action: 'REVISION_APPROVED', event: 'REVISION_APPROVED', oldValue: 'PENDING', newValue: 'APPROVED' },
    { name: 'reject revision', url: (s) => `/api/admin/reviews/revisions/${s.revision.id}/reject`, body: { note: 'The demo link is broken.' }, action: 'REVISION_REJECTED', event: 'REVISION_REJECTED', oldValue: 'PENDING', newValue: 'REJECTED' },
  ];

  it.each(DECISIONS)('$name records old and new values and notifies the owner', async (d) => {
    const s = await setup();
    expect((await s.adminAgent.post(d.url(s)).send(d.body)).status).toBe(200);
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: d.action } })).toMatchObject({ actorId: s.admin.id, oldValue: d.oldValue, newValue: d.newValue });
    const notices = await s.ownerAgent.get('/api/notifications');
    expect(notices.body.items.map((n: { eventType: string }) => n.eventType)).toEqual([d.event]);
  });

  it.each(DECISIONS)('$name: a forced failure leaves no partial change', async (d) => {
    const s = await setup();
    const before = await Promise.all([
      prisma.project.findUniqueOrThrow({ where: { id: s.submitted.id } }),
      prisma.project.findUniqueOrThrow({ where: { id: s.live.id } }),
      prisma.projectRevision.findUniqueOrThrow({ where: { id: s.revision.id } }),
    ]);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    failure.notify = true;

    const res = await s.adminAgent.post(d.url(s)).send(d.body);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('SERVER_ERROR');

    expect(await prisma.project.findUniqueOrThrow({ where: { id: s.submitted.id } })).toEqual(before[0]);
    expect(await prisma.project.findUniqueOrThrow({ where: { id: s.live.id } })).toEqual(before[1]);
    expect(await prisma.projectRevision.findUniqueOrThrow({ where: { id: s.revision.id } })).toEqual(before[2]);
    expect(await prisma.auditLog.count({ where: { action: d.action } })).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('a forced failure on a team invitation leaves no membership row', async () => {
    const s = await setup();
    const { user: invitee } = await agentFor('UPLOADER');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    failure.notify = true;
    expect((await s.ownerAgent.post(`/api/projects/${s.live.id}/members`).send({ email: invitee.email })).status).toBe(500);
    expect(await prisma.projectMember.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'MEMBER_INVITED' } })).toBe(0);
  });
});
