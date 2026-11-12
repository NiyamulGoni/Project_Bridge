/**
 * Steps 11 and 12 / FR14–FR16: removing a project, role requests, account access, and message evidence.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { encrypt } from '../src/lib/crypto.js';
import { createProject, createUser, PASSWORD, prisma, resetDb, signedInAgent } from './helpers.js';
import { expectCleanResponse } from './responseScan.js';

beforeEach(resetDb);

const agentFor = async (role: string, status = 'ACTIVE') => {
  const user = await createUser({ role, status });
  return { user, agent: await signedInAgent(user.email) };
};
const reportOn = (reporterId: string, targetType: string, targetId: string, status = 'OPEN') =>
  prisma.report.create({ data: { reporterId, targetType, targetId, status, reason: encrypt('This breaks the rules.', 'Report.reason') } });

describe('Removing a project (FR14)', () => {
  async function setup() {
    const owner = await agentFor('UPLOADER');
    const project = await createProject(owner.user.id);
    const reporter = await agentFor('PROFESSIONAL');
    const admin = await agentFor('ADMIN');
    const remove = (reportId: string, id = project.id) => admin.agent.post(`/api/admin/projects/${id}/remove`).send({ reason: 'Copied from another team.', reportId });
    return { owner, project, reporter, admin, remove };
  }

  it('an unconfirmed report cannot trigger removal', async () => {
    const { owner, project, reporter, remove } = await setup();
    const open = await reportOn(reporter.user.id, 'PROJECT', project.id);
    const dismissed = await reportOn(reporter.user.id, 'PROJECT', project.id, 'DISMISSED');
    const other = await createProject(owner.user.id);
    const elsewhere = await reportOn(reporter.user.id, 'PROJECT', other.id, 'CONFIRMED');
    for (const report of [open, dismissed, elsewhere]) {
      const res = await remove(report.id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('NO_CONFIRMED_REPORT');
    }
    expect((await remove('no-such-report')).status).toBe(409);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).status).toBe('PUBLISHED');
    expect(await prisma.auditLog.count({ where: { action: 'PROJECT_REMOVED' } })).toBe(0);
  });

  it('a confirmed report lets an Admin remove it from feed, search and direct links, leaving the owner alone', async () => {
    const { owner, project, reporter, admin, remove } = await setup();
    const report = await reportOn(reporter.user.id, 'PROJECT', project.id);
    expect((await admin.agent.post(`/api/admin/reports/${report.id}/confirm`).send({ note: 'Checked against the original.' })).status).toBe(200);
    // Confirming alone changes nothing about the project.
    expect((await reporter.agent.get(`/api/projects/${project.id}`)).status).toBe(200);

    expect((await remove(report.id)).status).toBe(200);
    expect((await reporter.agent.get(`/api/projects/${project.id}`)).status).toBe(404);
    const ids = (res: { body: { items: Array<{ id: string }> } }) => res.body.items.map((p) => p.id);
    expect(ids(await reporter.agent.get('/api/projects/feed'))).not.toContain(project.id);
    expect(ids(await reporter.agent.get('/api/projects/search?q=solar'))).not.toContain(project.id);

    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: 'PROJECT_REMOVED' } })).toMatchObject({ actorId: admin.user.id, targetId: project.id, oldValue: 'PUBLISHED', newValue: 'REMOVED', reason: 'Copied from another team.' });
    expect(await prisma.notification.count({ where: { recipientId: owner.user.id, eventType: 'PROJECT_REMOVED' } })).toBe(1);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: owner.user.id } })).toMatchObject({ status: 'ACTIVE', role: 'UPLOADER' });
    expect((await owner.agent.get('/api/auth/me')).status).toBe(200);
    expect((await remove(report.id)).status).toBe(404);
  });

  it('re-review is the only way back, and puts it in the review queue', async () => {
    const { owner, project, reporter, admin, remove } = await setup();
    const report = await reportOn(reporter.user.id, 'PROJECT', project.id, 'CONFIRMED');
    await remove(report.id);
    expect((await owner.agent.post(`/api/projects/${project.id}/unhide`)).status).not.toBe(200);
    expect((await owner.agent.post(`/api/projects/${project.id}/submit`).send({ ownershipDeclared: true })).status).not.toBe(200);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).status).toBe('REMOVED');

    expect((await admin.agent.post(`/api/admin/projects/${project.id}/re-review`).send({})).status).toBe(400);
    expect((await admin.agent.post(`/api/admin/projects/${project.id}/re-review`).send({ reason: 'The owner replaced the copied parts.' })).status).toBe(200);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).status).toBe('SUBMITTED');
    expect((await reporter.agent.get(`/api/projects/${project.id}`)).status).toBe(404);
    expect((await admin.agent.get('/api/admin/reviews')).body.submissions.map((s: { id: string }) => s.id)).toContain(project.id);
  });
});

describe('Role requests (FR15)', () => {
  it('an Uploader asks, an Admin approves with a reason, and ownership is kept', async () => {
    const uploader = await agentFor('UPLOADER');
    const project = await createProject(uploader.user.id);
    const admin = await agentFor('ADMIN');
    const asked = await uploader.agent.post('/api/role-requests').send({ reason: 'I am a senior engineer at a local firmware company.' });
    expect(asked.status).toBe(201);
    expect((await uploader.agent.post('/api/role-requests').send({ reason: 'Asking again while the first is pending.' })).status).toBe(409);

    const queue = await admin.agent.get('/api/admin/role-requests');
    expect(queue.body.items).toHaveLength(1);
    expectCleanResponse(queue.body, { values: [uploader.user.email] });
    const url = `/api/admin/role-requests/${asked.body.request.id}/approve`;
    expect((await admin.agent.post(url).send({})).status).toBe(400);
    expect((await admin.agent.post(url).send({ reason: 'Employment verified.' })).status).toBe(200);

    expect((await uploader.agent.get('/api/auth/me')).body.user.role).toBe('PROFESSIONAL');
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).ownerId).toBe(uploader.user.id);
    expect((await uploader.agent.get(`/api/projects/${project.id}/workspace`)).status).toBe(200);
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: 'ROLE_CHANGED' } })).toMatchObject({ actorId: admin.user.id, targetId: uploader.user.id, oldValue: 'UPLOADER', newValue: 'PROFESSIONAL' });
    expect((await admin.agent.post(url).send({ reason: 'Again.' })).status).toBe(404);
  });

  it('only active Uploaders can ask, a rejection changes nothing, and a role sent in the body is ignored', async () => {
    const reason = 'I mentor student teams at my company.';
    expect((await (await agentFor('PROFESSIONAL')).agent.post('/api/role-requests').send({ reason })).status).toBe(403);
    expect((await (await agentFor('ADMIN')).agent.post('/api/role-requests').send({ reason })).status).toBe(403);
    expect((await (await agentFor('UPLOADER', 'RESTRICTED')).agent.post('/api/role-requests').send({ reason })).status).toBe(403);

    const uploader = await agentFor('UPLOADER');
    const admin = await agentFor('ADMIN');
    const asked = await uploader.agent.post('/api/role-requests').send({ reason, role: 'ADMIN', status: 'APPROVED' });
    expect(asked.body.request.status).toBe('PENDING');
    expect((await admin.agent.post(`/api/admin/role-requests/${asked.body.request.id}/reject`).send({ reason: 'Please add where you work.' })).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: uploader.user.id } })).role).toBe('UPLOADER');
    expect((await uploader.agent.get('/api/role-requests/mine')).body.items[0]).toMatchObject({ status: 'REJECTED', decisionNote: 'Please add where you work.' });
    // A new request is possible once the first is decided.
    expect((await uploader.agent.post('/api/role-requests').send({ reason })).status).toBe(201);
  });
});

describe('Account access (FR16)', () => {
  const setStatus = (admin: Awaited<ReturnType<typeof agentFor>>, id: string, status: string, reason: string | undefined = 'Repeated abusive comments.') =>
    admin.agent.post(`/api/admin/users/${id}/status`).send({ status, reason });

  it('a ban ends live sessions, keeps the projects, and is recorded with old and new values', async () => {
    const pro = await agentFor('PROFESSIONAL');
    const project = await createProject(pro.user.id);
    const admin = await agentFor('ADMIN');
    expect((await pro.agent.get('/api/auth/me')).status).toBe(200);

    expect((await setStatus(admin, pro.user.id, 'BANNED')).status).toBe(200);
    expect(await prisma.session.count({ where: { userId: pro.user.id } })).toBe(0);
    expect((await pro.agent.get('/api/auth/me')).status).toBe(401);
    expect((await pro.agent.post('/api/auth/login').send({ email: pro.user.email, password: PASSWORD })).status).toBe(403);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).status).toBe('PUBLISHED');
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: 'ACCESS_CHANGED' } })).toMatchObject({ actorId: admin.user.id, targetId: pro.user.id, oldValue: 'ACTIVE', newValue: 'BANNED', reason: 'Repeated abusive comments.' });

    expect((await setStatus(admin, pro.user.id, 'ACTIVE', 'Appeal accepted.')).status).toBe(200);
    expect((await pro.agent.post('/api/auth/login').send({ email: pro.user.email, password: PASSWORD })).status).toBe(200);
  });

  it('refuses invalid transitions, other roles, the Admin themself and a missing reason', async () => {
    const admin = await agentFor('ADMIN');
    const restricted = await createUser({ role: 'PROFESSIONAL', status: 'RESTRICTED' });
    const banned = await createUser({ role: 'PROFESSIONAL', status: 'BANNED' });
    const active = await createUser({ role: 'PROFESSIONAL' });
    const uploader = await createUser({ role: 'UPLOADER' });
    const invalid = async (id: string, status: string) => {
      const res = await setStatus(admin, id, status);
      expect({ status, http: res.status, code: res.body.error?.code }).toEqual({ status, http: 409, code: 'INVALID_TRANSITION' });
    };
    await invalid(restricted.id, 'SUSPENDED');
    await invalid(restricted.id, 'BANNED');
    await invalid(banned.id, 'SUSPENDED');
    await invalid(banned.id, 'RESTRICTED');
    await invalid(active.id, 'ACTIVE');
    expect((await setStatus(admin, uploader.id, 'RESTRICTED')).body.error.code).toBe('INVALID_TARGET');
    expect((await setStatus(admin, admin.user.id, 'RESTRICTED')).status).toBe(403);
    expect((await admin.agent.post(`/api/admin/users/${active.id}/status`).send({ status: 'RESTRICTED' })).status).toBe(400);
    expect((await admin.agent.post(`/api/admin/users/${active.id}/status`).send({ status: 'DELETED', reason: 'Nope.' })).status).toBe(400);
    expect(await prisma.auditLog.count({ where: { action: 'ACCESS_CHANGED' } })).toBe(0);

    for (const [id, status] of [[active.id, 'RESTRICTED'], [active.id, 'ACTIVE'], [active.id, 'SUSPENDED'], [active.id, 'BANNED'], [restricted.id, 'ACTIVE']]) {
      expect({ status, http: (await setStatus(admin, id, status)).status }).toEqual({ status, http: 200 });
    }
  });

  it('lists users and their audit history without emails', async () => {
    const admin = await agentFor('ADMIN');
    const pro = await agentFor('PROFESSIONAL');
    const list = await admin.agent.get('/api/admin/users');
    expect(Object.keys(list.body.items[0]).sort()).toEqual(['createdAt', 'id', 'name', 'role', 'status']);
    expectCleanResponse(list.body, { values: [pro.user.email, admin.user.email] });
    const history = await admin.agent.get(`/api/admin/users/${pro.user.id}/audit`);
    expect(history.body.items.map((i: { action: string }) => i.action)).toContain('LOGIN_SUCCEEDED');
    expectCleanResponse(history.body, { values: [pro.user.email] });
    expect((await admin.agent.get('/api/admin/users/no-such-user/audit')).status).toBe(404);
  });
});

describe('Message evidence (FR16)', () => {
  it('an Admin reads a conversation only through an open report about it, and each read is audited', async () => {
    const a = await agentFor('UPLOADER');
    const b = await agentFor('PROFESSIONAL');
    const admin = await agentFor('ADMIN');
    const conversation = await prisma.conversation.create({
      data: {
        participants: { create: [{ userId: a.user.id }, { userId: b.user.id }] },
        messages: { create: [{ senderId: b.user.id, body: encrypt('Pay me or I will report your project.', 'Message.body') }] },
      },
    });

    expect((await admin.agent.get(`/api/messaging/conversations/${conversation.id}/messages`)).status).toBe(404);
    const projectReport = await reportOn(a.user.id, 'PROJECT', 'some-project');
    expect((await admin.agent.get(`/api/admin/reports/${projectReport.id}/conversation`)).status).toBe(404);
    expect(await prisma.auditLog.count({ where: { action: 'CONVERSATION_READ' } })).toBe(0);

    const filed = await a.agent.post('/api/reports').send({ targetType: 'CONVERSATION', targetId: conversation.id, reason: 'He is threatening me in private messages.' });
    const url = `/api/admin/reports/${filed.body.id}/conversation`;
    const read = await admin.agent.get(url);
    expect(read.status).toBe(200);
    expect(read.body.items[0]).toMatchObject({ body: 'Pay me or I will report your project.', sender: { id: b.user.id, name: b.user.name } });
    expectCleanResponse(read.body, { values: [a.user.email, b.user.email] });
    await admin.agent.get(url);
    expect(await prisma.auditLog.count({ where: { action: 'CONVERSATION_READ', actorId: admin.user.id, targetId: conversation.id } })).toBe(2);

    await admin.agent.post(`/api/admin/reports/${filed.body.id}/dismiss`).send({ note: 'Handled.' });
    expect((await admin.agent.get(url)).status).toBe(404);
  });
});
